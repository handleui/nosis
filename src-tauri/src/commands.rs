use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::error::AppError;
use crate::supermemory::{AddDocumentRequest, AddDocumentResponse, SearchRequest, SearchResponse, SupermemoryClient};

// ── Types ──

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub model: Option<String>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub created_at: String,
}

// ── Helpers ──

const MAX_TITLE_LENGTH: usize = 500;
const MAX_CONTENT_LENGTH: usize = 100_000; // ~100KB of text
const MAX_MODEL_LENGTH: usize = 100;
const DEFAULT_PAGE_SIZE: i32 = 100;

// Supermemory-specific limits
const MAX_SUPERMEMORY_CONTENT_LENGTH: usize = 1_000_000; // Supermemory API 1MB text limit
const MAX_SUPERMEMORY_TAG_LENGTH: usize = 200;
const MAX_SUPERMEMORY_QUERY_LENGTH: usize = 10_000;
const MAX_SUPERMEMORY_API_KEY_LENGTH: usize = 256;

fn gen_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn validate_uuid(id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidId)?;
    Ok(())
}

fn get_pool(app: &AppHandle) -> Result<&SqlitePool, AppError> {
    app.try_state::<SqlitePool>()
        .ok_or(AppError::DbNotInitialized)
        .map(|state| state.inner())
}

fn validate_not_empty(value: &str, field: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!("{field} must not be empty")));
    }
    Ok(())
}

fn validate_max_length(value: &str, max: usize, field: &str) -> Result<(), AppError> {
    if value.len() > max {
        return Err(AppError::Validation(format!(
            "{field} exceeds maximum length of {max} characters"
        )));
    }
    Ok(())
}

fn validate_optional_tag(tag: &Option<String>, max: usize) -> Result<(), AppError> {
    if let Some(ref t) = tag {
        validate_not_empty(t, "Container tag")?;
        validate_max_length(t, max, "Container tag")?;
    }
    Ok(())
}

// ── Conversation Commands ──

#[tauri::command]
pub async fn create_conversation(
    app: AppHandle,
    title: Option<String>,
) -> Result<Conversation, AppError> {
    if let Some(ref t) = title {
        validate_not_empty(t, "Title")?;
    }
    let title = title.unwrap_or_else(|| "New Conversation".to_string());
    validate_max_length(&title, MAX_TITLE_LENGTH, "Title")?;

    let pool = get_pool(&app)?;
    let id = gen_id();

    Ok(sqlx::query_as::<Sqlite, Conversation>(
        "INSERT INTO conversations (id, title) VALUES (?, ?)
         RETURNING id, title, created_at, updated_at",
    )
    .bind(&id)
    .bind(&title)
    .fetch_one(pool)
    .await?)
}

#[tauri::command]
pub async fn list_conversations(
    app: AppHandle,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Vec<Conversation>, AppError> {
    let pool = get_pool(&app)?;
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);

    Ok(sqlx::query_as::<Sqlite, Conversation>(
        "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?)
}

#[tauri::command]
pub async fn update_conversation_title(
    app: AppHandle,
    id: String,
    title: String,
) -> Result<(), AppError> {
    validate_uuid(&id)?;
    validate_not_empty(&title, "Title")?;
    validate_max_length(&title, MAX_TITLE_LENGTH, "Title")?;

    let pool = get_pool(&app)?;
    let result = sqlx::query("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(&title)
        .bind(&id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Conversation"));
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_conversation(app: AppHandle, id: String) -> Result<(), AppError> {
    validate_uuid(&id)?;
    let pool = get_pool(&app)?;
    let result = sqlx::query("DELETE FROM conversations WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Conversation"));
    }

    Ok(())
}

// ── Message Commands ──

#[tauri::command]
pub async fn get_messages(
    app: AppHandle,
    conversation_id: String,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Vec<Message>, AppError> {
    validate_uuid(&conversation_id)?;
    let pool = get_pool(&app)?;
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);

    Ok(sqlx::query_as::<Sqlite, Message>(
        "SELECT id, conversation_id, role, content, model, tokens_in, tokens_out, created_at
         FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?",
    )
    .bind(&conversation_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?)
}

fn validate_message_inputs(
    conversation_id: &str,
    role: &str,
    content: &str,
    model: &Option<String>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> Result<(), AppError> {
    validate_uuid(conversation_id)?;

    if !matches!(role, "user" | "assistant" | "system") {
        return Err(AppError::Validation(
            "Invalid role: must be 'user', 'assistant', or 'system'".into(),
        ));
    }

    validate_not_empty(content, "Content")?;
    validate_max_length(content, MAX_CONTENT_LENGTH, "Content")?;

    if let Some(ref m) = model {
        validate_max_length(m, MAX_MODEL_LENGTH, "Model name")?;
    }

    fn require_non_negative(value: Option<i64>, field: &str) -> Result<(), AppError> {
        if let Some(v) = value {
            if v < 0 {
                return Err(AppError::Validation(format!("{field} must be non-negative")));
            }
        }
        Ok(())
    }

    require_non_negative(tokens_in, "tokens_in")?;
    require_non_negative(tokens_out, "tokens_out")?;

    Ok(())
}

#[tauri::command]
pub async fn save_message(
    app: AppHandle,
    conversation_id: String,
    role: String,
    content: String,
    model: Option<String>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> Result<Message, AppError> {
    validate_message_inputs(&conversation_id, &role, &content, &model, tokens_in, tokens_out)?;

    let pool = get_pool(&app)?;
    let id = gen_id();
    let mut tx = pool.begin().await?;

    let update_result = sqlx::query("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
        .bind(&conversation_id)
        .execute(&mut *tx)
        .await?;

    if update_result.rows_affected() == 0 {
        return Err(AppError::NotFound("Conversation"));
    }

    let message = sqlx::query_as::<Sqlite, Message>(
        "INSERT INTO messages (id, conversation_id, role, content, model, tokens_in, tokens_out)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, conversation_id, role, content, model, tokens_in, tokens_out, created_at",
    )
    .bind(&id)
    .bind(&conversation_id)
    .bind(&role)
    .bind(&content)
    .bind(&model)
    .bind(tokens_in)
    .bind(tokens_out)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(message)
}

// ── Supermemory Commands ──

fn get_supermemory_client(app: &AppHandle) -> Result<Arc<SupermemoryClient>, AppError> {
    let state = app
        .try_state::<RwLock<Option<Arc<SupermemoryClient>>>>()
        .ok_or(AppError::SupermemoryNotConfigured)?;
    let guard = state.read().map_err(|e| {
        eprintln!("Supermemory RwLock poisoned (read): {e}");
        AppError::SupermemoryNotConfigured
    })?;
    guard
        .as_ref()
        .cloned()
        .ok_or(AppError::SupermemoryNotConfigured)
}

#[tauri::command]
pub async fn set_supermemory_api_key(
    app: AppHandle,
    api_key: String,
) -> Result<(), AppError> {
    if api_key.trim().is_empty() {
        return Err(AppError::Validation("API key must not be empty".into()));
    }
    if api_key.len() > MAX_SUPERMEMORY_API_KEY_LENGTH {
        return Err(AppError::Validation("API key is too long".into()));
    }

    let client = SupermemoryClient::new(api_key)?;
    let state = app.state::<RwLock<Option<Arc<SupermemoryClient>>>>();
    let mut guard = state.write().map_err(|e| {
        eprintln!("Supermemory RwLock poisoned (write): {e}");
        AppError::SupermemoryNotConfigured
    })?;
    *guard = Some(Arc::new(client));

    Ok(())
}

#[tauri::command]
pub async fn supermemory_add(
    app: AppHandle,
    content: String,
    container_tag: Option<String>,
) -> Result<AddDocumentResponse, AppError> {
    validate_not_empty(&content, "Content")?;
    validate_max_length(&content, MAX_SUPERMEMORY_CONTENT_LENGTH, "Content")?;
    validate_optional_tag(&container_tag, MAX_SUPERMEMORY_TAG_LENGTH)?;

    let client = get_supermemory_client(&app)?;
    let req = AddDocumentRequest {
        content,
        custom_id: None,
        container_tag,
    };

    Ok(client.add_document(&req).await?)
}

#[tauri::command]
pub async fn supermemory_search(
    app: AppHandle,
    q: String,
    container_tag: Option<String>,
    limit: Option<u32>,
) -> Result<SearchResponse, AppError> {
    validate_not_empty(&q, "Search query")?;
    validate_max_length(&q, MAX_SUPERMEMORY_QUERY_LENGTH, "Search query")?;
    validate_optional_tag(&container_tag, MAX_SUPERMEMORY_TAG_LENGTH)?;

    let client = get_supermemory_client(&app)?;
    let req = SearchRequest {
        q,
        container_tag,
        limit: limit.map(|l| l.clamp(1, 100)),
        threshold: None,
    };

    Ok(client.search(&req).await?)
}

// ── Global Hotkey ──

pub fn register_hotkey(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.global_shortcut().on_shortcut(
        "Alt+Space",
        move |app_handle, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let Some(window) = app_handle.get_webview_window("main") else {
                return;
            };
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        },
    )?;
    Ok(())
}
