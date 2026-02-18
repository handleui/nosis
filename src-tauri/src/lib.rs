mod commands;
mod db;
mod error;
mod exa;
mod placement;
mod supermemory;
mod vault;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use std::path::Path;
use tauri::Manager;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{fmt, EnvFilter};
use zeroize::Zeroize;

fn get_or_create_salt(path: &std::path::Path) -> [u8; 32] {
    use std::fs::OpenOptions;
    use std::io::Write;

    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
    };

    // Windows: no owner-only restriction available via OpenOptions.
    // The file is set to read-only after creation (see below).
    #[cfg(not(unix))]
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path);

    match file {
        Ok(mut file) => {
            let mut salt = [0u8; 32];
            getrandom::getrandom(&mut salt).expect("failed to generate random salt");
            file.write_all(&salt).expect("failed to write salt file");
            file.sync_all().expect("failed to sync salt file to disk");

            #[cfg(not(unix))]
            {
                tracing::warn!(
                    "non-unix platform: salt file lacks owner-only permissions, setting read-only"
                );
                let mut perms = std::fs::metadata(path)
                    .expect("failed to read salt file metadata")
                    .permissions();
                perms.set_readonly(true);
                std::fs::set_permissions(path, perms)
                    .expect("failed to set salt file read-only");
            }

            salt
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let bytes = std::fs::read(path).expect("failed to read salt file");
            assert!(
                bytes.len() == 32,
                "corrupted salt file: expected 32 bytes, got {}",
                bytes.len()
            );
            let mut salt = [0u8; 32];
            salt.copy_from_slice(&bytes);
            salt
        }
        Err(_) => panic!("failed to create salt file"),
    }
}

fn argon2_config() -> argon2::Config<'static> {
    argon2::Config {
        mem_cost: 47_104, // 46 MiB
        time_cost: 3,
        lanes: 1,
        variant: argon2::Variant::Argon2id,
        version: argon2::Version::Version13,
        ..Default::default()
    }
}

fn ensure_app_data_dir(app_data_dir: &std::path::Path) {
    std::fs::create_dir_all(app_data_dir).expect("failed to create app data directory");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(app_data_dir, std::fs::Permissions::from_mode(0o700))
            .expect("failed to set app data directory permissions");
    }
}

fn init_stronghold_plugin(
    app: &tauri::AppHandle,
    salt: [u8; 32],
) -> Result<(), Box<dyn std::error::Error>> {
    app.plugin(
        tauri_plugin_stronghold::Builder::new(move |password| {
            argon2::hash_raw(password.as_bytes(), &salt, &argon2_config())
                .expect("failed to hash password")
        })
        .build(),
    )?;
    Ok(())
}

fn init_api_key_vault(app_data_dir: &std::path::Path, salt: &[u8; 32]) -> vault::ApiKeyVault {
    let vault_path = app_data_dir.join("api-keys.hold");
    let snapshot_path = iota_stronghold::SnapshotPath::from_path(&vault_path);

    // SECURITY: The hardcoded password means encryption-at-rest relies solely on filesystem
    // permissions (salt file + .hold file), NOT on a user-supplied secret. An attacker with read
    // access to the app data directory can derive the same key and decrypt the vault offline.
    // For stronger protection, gate the root secret behind macOS Keychain / biometrics.
    let vault_key = zeroize::Zeroizing::new(
        argon2::hash_raw(b"muppet-api-keys", salt, &argon2_config())
            .expect("failed to derive vault key"),
    );

    let stronghold = iota_stronghold::Stronghold::default();

    if snapshot_path.exists() {
        let kp = iota_stronghold::KeyProvider::try_from(vault_key.clone())
            .expect("failed to create key provider");
        if let Err(e) = stronghold.load_snapshot(&kp, &snapshot_path) {
            tracing::warn!(error = ?e, "failed to load API key vault, starting fresh");
        }
    }

    if stronghold.get_client(b"api-keys").is_err()
        && stronghold.load_client(b"api-keys").is_err()
    {
        stronghold
            .create_client(b"api-keys")
            .expect("failed to create stronghold client");
    }

    tracing::info!("API key vault initialized");

    vault::ApiKeyVault {
        stronghold,
        snapshot_path,
        vault_key,
    }
}

fn init_tracing() {
    let default_filter = if cfg!(debug_assertions) {
        "muppet_lib=debug,info"
    } else {
        "muppet_lib=info,warn"
    };

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_filter));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(false))
        .init();
}

async fn init_db_pool(app_data_dir: &Path) -> Result<SqlitePool, Box<dyn std::error::Error>> {
    let connect_opts = SqliteConnectOptions::new()
        .filename(app_data_dir.join("muppet.db"))
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .pragma("cache_size", "-64000")
        .pragma("temp_store", "MEMORY")
        .pragma("mmap_size", "268435456")
        .pragma("wal_autocheckpoint", "16000")
        .optimize_on_close(true, Some(400));

    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(connect_opts)
        .await?;

    db::run_migrations(&pool).await?;

    Ok(pool)
}

/// Load the Exa API key from the vault into memory for fast access.
fn load_cached_exa_key_from_vault(vault: &vault::ApiKeyVault) -> Option<String> {
    let client = vault.stronghold.get_client(b"api-keys").ok()?;
    let store_key = b"api_key:exa";
    match client.store().get(store_key) {
        Ok(Some(data)) => match String::from_utf8(data) {
            Ok(s) => Some(s),
            Err(e) => {
                e.into_bytes().zeroize();
                None
            }
        },
        _ => None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    tracing::info!("starting muppet");

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path");

            ensure_app_data_dir(&app_data_dir);

            let pool = tauri::async_runtime::block_on(init_db_pool(&app_data_dir))?;

            app.manage(pool);
            app.manage(
                reqwest::Client::builder()
                    .user_agent("muppet/0.1.0")
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .timeout(std::time::Duration::from_secs(30))
                    .build()
                    .expect("failed to build HTTP client"),
            );

            app.manage(
                std::sync::RwLock::new(Option::<std::sync::Arc<supermemory::SupermemoryClient>>::None),
            );

            let salt = get_or_create_salt(&app_data_dir.join("salt.txt"));
            init_stronghold_plugin(app.handle(), salt)?;

            let api_vault = init_api_key_vault(&app_data_dir, &salt);
            let cached_exa_key = load_cached_exa_key_from_vault(&api_vault);
            app.manage(commands::ExaKeyCache(std::sync::Mutex::new(cached_exa_key)));
            app.manage(commands::SearchRateLimiter(std::sync::Mutex::new(None)));
            app.manage(std::sync::Mutex::new(api_vault));

            let placement_file = app_data_dir.join("placement.json");
            let initial_mode = placement::load_state(&placement_file);
            app.manage(placement::PlacementState {
                mode: std::sync::Mutex::new(initial_mode),
                state_file: placement_file,
            });

            commands::register_hotkey(app)?;

            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = placement::apply_placement(&window, initial_mode) {
                    tracing::warn!(error = %e, "startup placement failed — window may not be positioned correctly");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_conversation,
            commands::list_conversations,
            commands::get_messages,
            commands::save_message,
            commands::delete_conversation,
            commands::update_conversation_title,
            commands::set_supermemory_api_key,
            commands::supermemory_add,
            commands::supermemory_search,
            commands::store_exa_api_key,
            commands::has_exa_api_key,
            commands::delete_exa_api_key,
            commands::search_web,
            commands::get_setting,
            commands::set_setting,
            commands::store_api_key,
            commands::get_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::set_placement_mode,
            commands::get_placement_mode,
            commands::dismiss_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running muppet");
}
