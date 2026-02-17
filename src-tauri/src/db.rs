use sqlx::SqlitePool;

/// Versioned migrations. Each entry is a (version, statements) pair.
/// Statements within a version are executed in order. Versions are applied
/// only once, tracked via the `schema_version` table.
fn versioned_migrations() -> Vec<(i64, Vec<&'static str>)> {
    vec![
        (1, vec![
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Conversation',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            "CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at)",
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
                content TEXT NOT NULL,
                model TEXT,
                tokens_in INTEGER DEFAULT 0,
                tokens_out INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )",
            // Composite index covers the get_messages query (WHERE conversation_id = ? ORDER BY created_at)
            // and also serves as an index on conversation_id alone (leftmost prefix).
            "CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at)",
        ]),
        // Future migrations go here as (2, vec![...]), (3, vec![...]), etc.
    ]
}

/// Run all pending migrations inside a transaction per version.
/// The schema_version table tracks which versions have been applied.
pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Bootstrap the version-tracking table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )"
    )
    .execute(pool)
    .await?;

    for (version, statements) in versioned_migrations() {
        // Check if this version has already been applied
        let already_applied: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version = ?)"
        )
        .bind(version)
        .fetch_one(pool)
        .await?;

        if already_applied {
            continue;
        }

        // Run all statements for this version in a transaction
        let mut tx = pool.begin().await?;
        for sql in &statements {
            sqlx::query(sql).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
            .bind(version)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }

    Ok(())
}
