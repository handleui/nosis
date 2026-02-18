mod commands;
mod db;
mod error;
mod exa;
mod vault;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use std::path::Path;
use tauri::Manager;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{fmt, EnvFilter};

fn open_new_salt_file(path: &std::path::Path) -> Result<std::fs::File, std::io::Error> {
    use std::fs::OpenOptions;

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
    }

    #[cfg(not(unix))]
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

fn write_new_salt(mut file: std::fs::File, path: &std::path::Path) -> [u8; 32] {
    use std::io::Write;

    let mut salt = [0u8; 32];
    getrandom::getrandom(&mut salt).expect("failed to generate random salt");
    file.write_all(&salt).expect("failed to write salt file");
    file.sync_all().expect("failed to sync salt file to disk");
    restrict_salt_permissions(path);
    salt
}

#[cfg(not(unix))]
fn restrict_salt_permissions(path: &std::path::Path) {
    tracing::warn!("non-unix platform: salt file lacks owner-only permissions, setting read-only");
    let mut perms = std::fs::metadata(path)
        .expect("failed to read salt file metadata")
        .permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(path, perms).expect("failed to set salt file read-only");
}

#[cfg(unix)]
fn restrict_salt_permissions(_path: &std::path::Path) {}

fn read_existing_salt(path: &std::path::Path) -> [u8; 32] {
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

fn get_or_create_salt(path: &std::path::Path) -> [u8; 32] {
    match open_new_salt_file(path) {
        Ok(file) => write_new_salt(file, path),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => read_existing_salt(path),
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

fn derive_vault_key(salt: &[u8; 32]) -> zeroize::Zeroizing<Vec<u8>> {
    zeroize::Zeroizing::new(
        argon2::hash_raw(b"muppet-api-keys", salt, &argon2_config())
            .expect("failed to derive vault key"),
    )
}

fn load_snapshot_if_exists(
    stronghold: &iota_stronghold::Stronghold,
    snapshot_path: &iota_stronghold::SnapshotPath,
    vault_key: &zeroize::Zeroizing<Vec<u8>>,
) {
    if !snapshot_path.exists() {
        return;
    }
    let kp = iota_stronghold::KeyProvider::try_from(vault_key.clone())
        .expect("failed to create key provider");
    if let Err(e) = stronghold.load_snapshot(&kp, snapshot_path) {
        tracing::warn!(error = ?e, "failed to load API key vault, starting fresh");
    }
}

fn ensure_stronghold_client(stronghold: &iota_stronghold::Stronghold) {
    if stronghold.get_client(b"api-keys").is_err()
        && stronghold.load_client(b"api-keys").is_err()
    {
        stronghold
            .create_client(b"api-keys")
            .expect("failed to create stronghold client");
    }
}

fn init_api_key_vault(app_data_dir: &std::path::Path, salt: &[u8; 32]) -> vault::ApiKeyVault {
    let snapshot_path =
        iota_stronghold::SnapshotPath::from_path(app_data_dir.join("api-keys.hold"));
    let vault_key = derive_vault_key(salt);
    let stronghold = iota_stronghold::Stronghold::default();

    load_snapshot_if_exists(&stronghold, &snapshot_path, &vault_key);
    ensure_stronghold_client(&stronghold);

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

async fn load_cached_exa_key(pool: &SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'exa_api_key'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .expect("could not resolve app local data path");

    ensure_app_data_dir(&app_data_dir);

    let pool = tauri::async_runtime::block_on(init_db_pool(&app_data_dir))?;
    let cached_api_key = tauri::async_runtime::block_on(load_cached_exa_key(&pool));

    app.manage(pool);
    app.manage(reqwest::Client::new());
    app.manage(commands::ExaKeyCache(std::sync::Mutex::new(cached_api_key)));

    let salt = get_or_create_salt(&app_data_dir.join("salt.txt"));
    init_stronghold_plugin(app.handle(), salt)?;

    let api_vault = init_api_key_vault(&app_data_dir, &salt);
    app.manage(std::sync::Mutex::new(api_vault));

    commands::register_hotkey(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    tracing::info!("starting muppet");

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(setup_app)
        .invoke_handler(tauri::generate_handler![
            commands::create_conversation,
            commands::get_conversation,
            commands::list_conversations,
            commands::get_messages,
            commands::save_message,
            commands::delete_conversation,
            commands::update_conversation_title,
            commands::set_conversation_agent_id,
            commands::store_exa_api_key,
            commands::has_exa_api_key,
            commands::delete_exa_api_key,
            commands::search_web,
            commands::get_setting,
            commands::set_setting,
            commands::store_api_key,
            commands::get_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running muppet");
}
