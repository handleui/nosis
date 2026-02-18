use sqlx::SqlitePool;
use tracing::{debug, info};

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
            "CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at)",
        ]),
        (2, vec![
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        ]),
        (3, vec![
            "ALTER TABLE conversations ADD COLUMN letta_agent_id TEXT",
        ]),
    ]
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    ensure_schema_version_table(pool).await?;

    for (version, statements) in versioned_migrations() {
        let already_applied: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM schema_version WHERE version = ?)",
        )
        .bind(version)
        .fetch_one(pool)
        .await?;

        if already_applied {
            debug!(version, "migration already applied, skipping");
            continue;
        }

        apply_migration(pool, version, &statements).await?;
        info!(version, "applied migration");
    }

    Ok(())
}

async fn ensure_schema_version_table(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn apply_migration(
    pool: &SqlitePool,
    version: i64,
    statements: &[&str],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for sql in statements {
        sqlx::query(sql).execute(&mut *tx).await?;
    }
    sqlx::query("INSERT INTO schema_version (version) VALUES (?)")
        .bind(version)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
