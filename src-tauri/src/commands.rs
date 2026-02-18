use std::sync::Mutex;

use crate::error::AppError;
use crate::exa::{self, ContentOptions, SearchCategory};
use crate::vault::ApiKeyVault;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tracing::{error, info, instrument};
use zeroize::Zeroize;

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub letta_agent_id: Option<String>,
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

pub struct ExaKeyCache(pub Mutex<Option<String>>);

const MAX_TITLE_LENGTH: usize = 500;
const MAX_CONTENT_LENGTH: usize = 100_000;
const MAX_MODEL_LENGTH: usize = 100;
const MAX_EXA_API_KEY_LENGTH: usize = 256;
const MAX_SETTING_KEY_LENGTH: usize = 255;
const MAX_SETTING_VALUE_LENGTH: usize = 10_000;
const MAX_PROVIDER_LENGTH: usize = 50;
const MAX_API_KEY_LENGTH: usize = 500;
const VAULT_CLIENT_NAME: &[u8] = b"api-keys";
const DEFAULT_PAGE_SIZE: i32 = 100;

const MAX_AGENT_ID_LENGTH: usize = 200;

fn validate_agent_id(agent_id: &str) -> Result<(), AppError> {
    validate_identifier(agent_id, MAX_AGENT_ID_LENGTH, "Agent ID", &['-', '_'])
}

fn gen_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn validate_uuid(id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidId)?;
    Ok(())
}

fn validate_title(title: &str) -> Result<(), AppError> {
    validate_non_empty_bounded(title, MAX_TITLE_LENGTH, "Title")
}

fn validate_message_fields(
    role: &str,
    content: &str,
    model: Option<&str>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> Result<(), AppError> {
    if !matches!(role, "user" | "assistant" | "system") {
        return Err(AppError::Validation(
            "Invalid role: must be 'user', 'assistant', or 'system'".into(),
        ));
    }
    if content.trim().is_empty() {
        return Err(AppError::Validation("Content must not be empty".into()));
    }
    if content.len() > MAX_CONTENT_LENGTH {
        return Err(AppError::Validation(format!(
            "Content exceeds maximum length of {} characters",
            MAX_CONTENT_LENGTH
        )));
    }
    if let Some(m) = model {
        if m.len() > MAX_MODEL_LENGTH {
            return Err(AppError::Validation(format!(
                "Model name exceeds maximum length of {} characters",
                MAX_MODEL_LENGTH
            )));
        }
    }
    if matches!(tokens_in, Some(t) if t < 0) {
        return Err(AppError::Validation("tokens_in must be non-negative".into()));
    }
    if matches!(tokens_out, Some(t) if t < 0) {
        return Err(AppError::Validation("tokens_out must be non-negative".into()));
    }
    Ok(())
}

fn validate_identifier(
    value: &str,
    max_len: usize,
    field: &str,
    allowed_extra: &[char],
) -> Result<(), AppError> {
    if value.is_empty() || value.len() > max_len {
        return Err(AppError::Validation(format!(
            "{field} must be 1-{max_len} characters"
        )));
    }
    if !value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || allowed_extra.contains(&c))
    {
        return Err(AppError::Validation(format!(
            "{field} contains invalid characters"
        )));
    }
    Ok(())
}

fn validate_non_empty_bounded(value: &str, max_len: usize, field: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::Validation(format!("{field} must not be empty")));
    }
    if value.len() > max_len {
        return Err(AppError::Validation(format!(
            "{field} exceeds maximum length of {max_len} characters"
        )));
    }
    Ok(())
}

fn validate_setting_key(key: &str) -> Result<(), AppError> {
    validate_identifier(key, MAX_SETTING_KEY_LENGTH, "Setting key", &['-', '_', '.'])
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    validate_identifier(provider, MAX_PROVIDER_LENGTH, "Provider name", &['-', '_'])
}

fn get_pool(app: &AppHandle) -> Result<&SqlitePool, AppError> {
    app.try_state::<SqlitePool>()
        .ok_or(AppError::DbNotInitialized)
        .map(|state| state.inner())
}

fn get_http_client(app: &AppHandle) -> Result<&reqwest::Client, AppError> {
    app.try_state::<reqwest::Client>()
        .ok_or(AppError::Validation("HTTP client not initialized".into()))
        .map(|state| state.inner())
}

fn get_exa_key_cache(app: &AppHandle) -> Result<&ExaKeyCache, AppError> {
    app.try_state::<ExaKeyCache>()
        .ok_or(AppError::Validation("API key cache not initialized".into()))
        .map(|state| state.inner())
}

fn lock_exa_cache(
    cache: &ExaKeyCache,
) -> Result<std::sync::MutexGuard<'_, Option<String>>, AppError> {
    cache
        .0
        .lock()
        .map_err(|_| AppError::Validation("Failed to acquire API key cache lock".into()))
}

fn get_vault(app: &AppHandle) -> Result<&Mutex<ApiKeyVault>, AppError> {
    app.try_state::<Mutex<ApiKeyVault>>()
        .ok_or_else(|| AppError::Internal("API key vault not initialized".into()))
        .map(|state| state.inner())
}

fn lock_vault(
    mutex: &Mutex<ApiKeyVault>,
) -> Result<std::sync::MutexGuard<'_, ApiKeyVault>, AppError> {
    match mutex.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            tracing::warn!("vault mutex was poisoned by a prior panic, recovering");
            Ok(poisoned.into_inner())
        }
    }
}

#[tauri::command]
pub async fn create_conversation(
    app: AppHandle,
    title: Option<String>,
) -> Result<Conversation, AppError> {
    if let Some(ref t) = title {
        validate_title(t)?;
    }
    let title = title.unwrap_or_else(|| "New Conversation".to_string());

    let pool = get_pool(&app)?;
    let id = gen_id();

    Ok(sqlx::query_as::<Sqlite, Conversation>(
        "INSERT INTO conversations (id, title) VALUES (?, ?)
         RETURNING id, title, letta_agent_id, created_at, updated_at",
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
        "SELECT id, title, letta_agent_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?",
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
    validate_title(&title)?;

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

#[tauri::command]
pub async fn get_conversation(
    app: AppHandle,
    id: String,
) -> Result<Conversation, AppError> {
    validate_uuid(&id)?;
    let pool = get_pool(&app)?;

    sqlx::query_as::<Sqlite, Conversation>(
        "SELECT id, title, letta_agent_id, created_at, updated_at FROM conversations WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Conversation"))
}

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
    validate_uuid(&conversation_id)?;
    validate_message_fields(&role, &content, model.as_deref(), tokens_in, tokens_out)?;

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

#[tauri::command]
#[instrument(skip(app))]
pub async fn get_setting(app: AppHandle, key: String) -> Result<Option<String>, AppError> {
    validate_setting_key(&key)?;

    let pool = get_pool(&app)?;
    Ok(sqlx::query_scalar::<Sqlite, String>("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(pool)
        .await?)
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn set_setting(app: AppHandle, key: String, value: String) -> Result<(), AppError> {
    validate_setting_key(&key)?;
    if value.len() > MAX_SETTING_VALUE_LENGTH {
        return Err(AppError::Validation(format!(
            "Setting value exceeds maximum length of {} characters",
            MAX_SETTING_VALUE_LENGTH
        )));
    }

    let pool = get_pool(&app)?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(&key)
    .bind(&value)
    .execute(pool)
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn set_conversation_agent_id(
    app: AppHandle,
    conversation_id: String,
    agent_id: String,
) -> Result<(), AppError> {
    validate_uuid(&conversation_id)?;
    validate_agent_id(&agent_id)?;

    let pool = get_pool(&app)?;
    let result = sqlx::query(
        "UPDATE conversations SET letta_agent_id = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&agent_id)
    .bind(&conversation_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Conversation"));
    }
    Ok(())
}

#[tauri::command]
pub async fn store_exa_api_key(app: AppHandle, key: String) -> Result<(), AppError> {
    validate_non_empty_bounded(&key, MAX_EXA_API_KEY_LENGTH, "API key")?;

    let pool = get_pool(&app)?;

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('exa_api_key', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(&key)
    .execute(pool)
    .await?;

    let cache = get_exa_key_cache(&app)?;
    let mut guard = lock_exa_cache(cache)?;
    *guard = Some(key);

    Ok(())
}

#[tauri::command]
pub async fn has_exa_api_key(app: AppHandle) -> Result<bool, AppError> {
    let cache = get_exa_key_cache(&app)?;
    let guard = lock_exa_cache(cache)?;
    Ok(guard.is_some())
}

#[tauri::command]
pub async fn delete_exa_api_key(app: AppHandle) -> Result<(), AppError> {
    let pool = get_pool(&app)?;

    sqlx::query("DELETE FROM settings WHERE key = 'exa_api_key'")
        .execute(pool)
        .await?;

    let cache = get_exa_key_cache(&app)?;
    let mut guard = lock_exa_cache(cache)?;
    *guard = None;

    Ok(())
}

#[tauri::command]
pub async fn search_web(
    app: AppHandle,
    query: String,
    num_results: Option<u32>,
    category: Option<SearchCategory>,
) -> Result<exa::SearchResponse, AppError> {
    let request = exa::SearchRequest {
        query,
        r#type: None,
        category,
        num_results,
        contents: Some(ContentOptions { text: Some(true) }),
    };

    exa::validate_search_request(&request)?;

    let cache = get_exa_key_cache(&app)?;
    let api_key = {
        let guard = lock_exa_cache(cache)?;
        guard.as_ref().ok_or(AppError::ApiKeyNotConfigured)?.clone()
    };

    let http = get_http_client(&app)?;
    let client = exa::ExaClient::new(http, &api_key);

    client.search(&request).await
}

fn get_vault_client(
    vault: &ApiKeyVault,
) -> Result<iota_stronghold::Client, AppError> {
    vault
        .stronghold
        .get_client(VAULT_CLIENT_NAME)
        .map_err(|e| {
            error!(error = ?e, "failed to get stronghold client");
            AppError::Internal("Vault operation failed".into())
        })
}

fn commit_vault(vault: &ApiKeyVault) -> Result<(), AppError> {
    let keyprovider =
        iota_stronghold::KeyProvider::try_from(vault.vault_key.clone()).map_err(|e| {
            error!(error = ?e, "failed to create key provider");
            AppError::Internal("Vault operation failed".into())
        })?;

    vault
        .stronghold
        .commit_with_keyprovider(&vault.snapshot_path, &keyprovider)
        .map_err(|e| {
            error!(error = ?e, "failed to commit stronghold snapshot");
            AppError::Internal("Failed to persist API key".into())
        })
}

#[tauri::command]
#[instrument(skip(app, api_key))]
pub async fn store_api_key(
    app: AppHandle,
    provider: String,
    api_key: String,
) -> Result<(), AppError> {
    let api_key = zeroize::Zeroizing::new(api_key);
    validate_provider(&provider)?;
    if api_key.is_empty() || api_key.len() > MAX_API_KEY_LENGTH {
        return Err(AppError::Validation("Invalid API key".into()));
    }

    let vault_state = get_vault(&app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    let store_key = format!("api_key:{}", provider);
    let key_bytes = api_key.as_bytes().to_vec();

    client
        .store()
        .insert(store_key.into_bytes(), key_bytes, None)
        .map_err(|e| {
            error!(error = ?e, "failed to insert into stronghold store");
            AppError::Internal("Failed to store API key".into())
        })?;

    commit_vault(&vault)?;
    info!(provider = %provider, "stored API key");
    Ok(())
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn get_api_key(
    app: AppHandle,
    provider: String,
) -> Result<Option<String>, AppError> {
    validate_provider(&provider)?;

    let vault_state = get_vault(&app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    let store_key = format!("api_key:{}", provider);
    let data = client
        .store()
        .get(store_key.as_bytes())
        .map_err(|e| {
            error!(error = ?e, "failed to read from stronghold store");
            AppError::Internal("Failed to retrieve API key".into())
        })?;

    let Some(bytes) = data else {
        return Ok(None);
    };

    let value = String::from_utf8(bytes).map_err(|e| {
        let mut bad = e.into_bytes();
        bad.zeroize();
        AppError::Internal("Corrupted API key data".into())
    })?;

    Ok(Some(value))
}

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
