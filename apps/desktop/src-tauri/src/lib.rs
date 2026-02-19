mod arcade;
mod commands;
mod db;
mod error;
mod fal;
mod oauth_callback;
mod placement;
mod secrets;
mod util;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{fmt, EnvFilter};

fn ensure_app_data_dir(app_data_dir: &std::path::Path) {
    std::fs::create_dir_all(app_data_dir).expect("failed to create app data directory");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(app_data_dir, std::fs::Permissions::from_mode(0o700))
            .expect("failed to set app data directory permissions");
    }
}

fn init_tracing() {
    let default_filter = if cfg!(debug_assertions) {
        "nosis_lib=debug,info"
    } else {
        "nosis_lib=info,warn"
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
        .filename(app_data_dir.join("nosis.db"))
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

/// Read a UTF-8 string secret from the SecretStore, returning None on any error
/// or if the key is absent. Used only at startup to warm the in-memory caches.
fn load_secret_string(store: &secrets::SecretStore, key: &str) -> Option<String> {
    store
        .get(key)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn warn_legacy_vault(app_data_dir: &Path) {
    let old_vault_path = app_data_dir.join("api-keys.hold");
    if old_vault_path.exists() {
        tracing::warn!(
            "legacy vault file api-keys.hold detected — keys stored via the previous \
             store_api_key command are not automatically migrated to the new secret store"
        );
    }
}

fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("nosis/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .expect("failed to build HTTP client")
}

fn open_secret_store(app_data_dir: &Path) -> secrets::SecretStore {
    let salt_path = app_data_dir.join("salt.txt");
    let vault_key = secrets::derive_vault_key(&salt_path);
    let snap_path = secrets::snapshot_path(app_data_dir);
    secrets::SecretStore::open(&snap_path, vault_key).expect("failed to open secret store")
}

fn register_managed_state(
    app: &mut tauri::App,
    pool: SqlitePool,
    secret_store: Arc<secrets::SecretStore>,
    cached_fal_key: Option<String>,
    arcade_client: Option<Arc<arcade::ArcadeClient>>,
) {
    app.manage(pool);
    app.manage(Arc::clone(&secret_store));
    app.manage(build_http_client());
    app.manage(commands::FalKeyCache(std::sync::RwLock::new(cached_fal_key)));
    app.manage(commands::OAuthSessions(std::sync::Mutex::new(
        std::collections::HashMap::new(),
    )));
    app.manage(std::sync::RwLock::new(arcade_client));
}

fn setup_placement(app: &mut tauri::App, app_data_dir: &Path) {
    let placement_file = app_data_dir.join("placement.json");
    let initial_mode = placement::load_state(&placement_file);
    app.manage(placement::PlacementState {
        mode: std::sync::Mutex::new(initial_mode),
        state_file: placement_file,
    });

    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = placement::apply_placement(&window, initial_mode) {
            tracing::warn!(error = %e, "startup placement failed");
        }
    }
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .expect("could not resolve app local data path");

    ensure_app_data_dir(&app_data_dir);

    let pool = tauri::async_runtime::block_on(init_db_pool(&app_data_dir))?;
    let secret_store = open_secret_store(&app_data_dir);
    warn_legacy_vault(&app_data_dir);

    let cached_fal_key = load_secret_string(&secret_store, "fal_api_key");
    let secret_store = Arc::new(secret_store);
    let arcade_client =
        tauri::async_runtime::block_on(load_arcade_client(&pool, &secret_store));

    register_managed_state(app, pool, secret_store, cached_fal_key, arcade_client);

    let salt_path = app_data_dir.join("salt.txt");
    app.handle()
        .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

    setup_placement(app, &app_data_dir);
    commands::register_hotkey(app)?;

    Ok(())
}

async fn load_arcade_client(
    pool: &SqlitePool,
    store: &secrets::SecretStore,
) -> Option<Arc<arcade::ArcadeClient>> {
    let api_key = load_secret_string(store, "arcade_api_key")?;

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM settings WHERE key IN ('arcade_user_id', 'arcade_base_url')",
    )
    .fetch_all(pool)
    .await
    .ok()?;

    let mut user_id = None;
    let mut base_url = None;

    for (key, value) in rows {
        match key.as_str() {
            "arcade_user_id" => user_id = Some(value),
            "arcade_base_url" => base_url = Some(value),
            _ => {}
        }
    }

    if let Some(ref url) = base_url {
        if commands::validate_base_url(url).is_err() {
            eprintln!("Stored arcade_base_url failed validation, ignoring saved config");
            return None;
        }
    }

    user_id.and_then(|uid| {
        arcade::ArcadeClient::new(api_key, uid, base_url)
            .ok()
            .map(Arc::new)
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    tracing::info!("starting nosis");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            commands::get_setting,
            commands::set_setting,
            commands::store_api_key,
            commands::get_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::store_fal_api_key,
            commands::has_fal_api_key,
            commands::delete_fal_api_key,
            commands::generate_image,
            commands::list_generations,
            commands::set_placement_mode,
            commands::get_placement_mode,
            commands::dismiss_window,
            commands::arcade_set_config,
            commands::arcade_get_config,
            commands::arcade_delete_config,
            commands::arcade_list_tools,
            commands::arcade_authorize_tool,
            commands::arcade_check_auth_status,
            commands::arcade_execute_tool,
            commands::add_mcp_server,
            commands::list_mcp_servers,
            commands::delete_mcp_server,
            commands::start_oauth_callback_server,
            commands::shutdown_oauth_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running nosis");
}
