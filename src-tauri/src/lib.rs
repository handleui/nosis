mod commands;
mod db;
mod error;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path");

            // Ensure app data directory exists before any file operations
            std::fs::create_dir_all(&app_data_dir)
                .expect("failed to create app data directory");

            // Initialize sqlx connection pool using SqliteConnectOptions (idiomatic sqlx 0.8).
            // PRAGMAs are applied via connect options instead of after_connect callbacks.
            // busy_timeout defaults to 5 seconds in sqlx.
            let db_path = app_data_dir.join("muppet.db");
            let connect_opts = SqliteConnectOptions::new()
                .filename(&db_path)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .synchronous(SqliteSynchronous::Normal)
                .foreign_keys(true)
                .pragma("cache_size", "-64000")
                .pragma("temp_store", "MEMORY")
                .pragma("mmap_size", "268435456")
                // Cap the WAL file at ~64 MB to prevent unbounded growth on desktop
                .pragma("wal_autocheckpoint", "16000")
                .optimize_on_close(true, Some(400));

            let pool = tauri::async_runtime::block_on(async {
                let pool = SqlitePoolOptions::new()
                    // SQLite allows only one writer at a time. Two connections lets
                    // reads proceed concurrently with a write under WAL mode.
                    .max_connections(2)
                    .connect_with(connect_opts)
                    .await
                    .expect("failed to connect to database");

                // Run versioned migrations
                db::run_migrations(&pool)
                    .await
                    .expect("failed to run migrations");

                pool
            });

            // SqlitePool is already Arc-wrapped internally; no need for Arc<SqlitePool>
            app.manage(pool);

            // Stronghold: use the built-in argon2 KDF with auto-managed salt file.
            // Builder::with_argon2 handles salt generation/reading and password hashing
            // internally via the plugin's `kdf` feature (enabled by default).
            let salt_path = app_data_dir.join("salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            // Register global hotkey (Option+Space on macOS)
            commands::register_hotkey(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_conversation,
            commands::list_conversations,
            commands::get_messages,
            commands::save_message,
            commands::delete_conversation,
            commands::update_conversation_title,
        ])
        .run(tauri::generate_context!())
        .expect("error while running muppet");
}
