use std::sync::{Arc, Mutex, RwLock};

use crate::error::AppError;
use crate::exa::{self, ContentOptions, SearchCategory};
use crate::supermemory::{self, AddDocumentRequest, AddDocumentResponse, SupermemoryClient};
use crate::vault::ApiKeyVault;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tracing::{error, info, instrument};
use zeroize::Zeroize;

use crate::placement::{self, PlacementMode, PlacementState};

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

// ── State ──

pub struct ExaKeyCache(pub Mutex<Option<String>>);

pub struct SearchRateLimiter(pub Mutex<Option<std::time::Instant>>);

// ── Helpers ──

const MAX_TITLE_LENGTH: usize = 500;
const MAX_CONTENT_LENGTH: usize = 100_000;
const MAX_MODEL_LENGTH: usize = 100;
const MAX_EXA_API_KEY_LENGTH: usize = 256;
const MAX_SETTING_KEY_LENGTH: usize = 255;
const MAX_SETTING_VALUE_LENGTH: usize = 10_000;
const MAX_PROVIDER_LENGTH: usize = 50;
const MAX_API_KEY_LENGTH: usize = 500;
const VAULT_CLIENT_NAME: &[u8] = b"api-keys";
const EXA_VAULT_PROVIDER: &str = "exa";
const DEFAULT_PAGE_SIZE: i32 = 100;

const MAX_SUPERMEMORY_CONTENT_LENGTH: usize = 1_000_000;
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

fn validate_title(title: &str) -> Result<(), AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title must not be empty".into()));
    }
    if title.len() > MAX_TITLE_LENGTH {
        return Err(AppError::Validation(format!(
            "Title exceeds maximum length of {} characters",
            MAX_TITLE_LENGTH
        )));
    }
    Ok(())
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

fn validate_setting_key(key: &str) -> Result<(), AppError> {
    if key.is_empty() || key.len() > MAX_SETTING_KEY_LENGTH {
        return Err(AppError::Validation(format!(
            "Setting key must be 1-{} characters",
            MAX_SETTING_KEY_LENGTH
        )));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::Validation(
            "Setting key may only contain alphanumeric characters, hyphens, underscores, and dots"
                .into(),
        ));
    }
    Ok(())
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    if provider.is_empty() || provider.len() > MAX_PROVIDER_LENGTH {
        return Err(AppError::Validation(format!(
            "Provider name must be 1-{} characters",
            MAX_PROVIDER_LENGTH
        )));
    }
    if !provider
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "Provider name may only contain alphanumeric characters, hyphens, and underscores"
                .into(),
        ));
    }
    Ok(())
}

fn get_pool(app: &AppHandle) -> Result<&SqlitePool, AppError> {
    app.try_state::<SqlitePool>()
        .ok_or(AppError::DbNotInitialized)
        .map(|state| state.inner())
}

fn get_http_client(app: &AppHandle) -> Result<&reqwest::Client, AppError> {
    app.try_state::<reqwest::Client>()
        .ok_or(AppError::Internal("HTTP client not initialized".into()))
        .map(|state| state.inner())
}

fn get_exa_key_cache(app: &AppHandle) -> Result<&ExaKeyCache, AppError> {
    app.try_state::<ExaKeyCache>()
        .ok_or(AppError::Internal("API key cache not initialized".into()))
        .map(|state| state.inner())
}

fn get_vault(app: &AppHandle) -> Result<&Mutex<ApiKeyVault>, AppError> {
    app.try_state::<Mutex<ApiKeyVault>>()
        .ok_or_else(|| AppError::Internal("API key vault not initialized".into()))
        .map(|state| state.inner())
}

/// Acquire the vault Mutex, recovering from poison if a prior command panicked.
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

// ── Conversation Commands ──

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

// ── Settings Commands ──

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
#[instrument(skip(app, value))]
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

// ── Supermemory Commands ──

fn get_supermemory_client(app: &AppHandle) -> Result<Arc<SupermemoryClient>, AppError> {
    let state = app
        .try_state::<RwLock<Option<Arc<SupermemoryClient>>>>()
        .ok_or(AppError::SupermemoryNotConfigured)?;
    let guard = state.read().map_err(|e| {
        error!("Supermemory RwLock poisoned (read): {e}");
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
    mut api_key: String,
) -> Result<(), AppError> {
    if api_key.trim().is_empty() {
        api_key.zeroize();
        return Err(AppError::Validation("API key must not be empty".into()));
    }
    if api_key.len() > MAX_SUPERMEMORY_API_KEY_LENGTH {
        api_key.zeroize();
        return Err(AppError::Validation("API key is too long".into()));
    }

    let http = get_http_client(&app)?.clone();
    let client = SupermemoryClient::new(http, api_key);
    // api_key has been moved into client; Drop impl will zeroize it.
    let state = app
        .try_state::<RwLock<Option<Arc<SupermemoryClient>>>>()
        .ok_or(AppError::SupermemoryNotConfigured)?;
    let mut guard = state.write().map_err(|e| {
        error!("Supermemory RwLock poisoned (write): {e}");
        AppError::SupermemoryNotConfigured
    })?;
    *guard = Some(Arc::new(client));

    Ok(())
}

// ── Placement Commands ──

#[tauri::command]
pub fn set_placement_mode(app: AppHandle, mode: PlacementMode) -> Result<(), AppError> {
    let state = app
        .try_state::<PlacementState>()
        .ok_or(AppError::Placement("Placement state not initialized".into()))?;
    let window = app
        .get_webview_window("main")
        .ok_or(AppError::Placement("Main window not found".into()))?;

    placement::apply_placement(&window, mode)?;
    {
        let mut guard = state.mode.lock()
            .map_err(|e| {
                error!(error = %e, "placement state mutex poisoned");
                AppError::Placement("Failed to update placement state".into())
            })?;
        *guard = mode;
    }
    placement::save_state(&state)?;
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
) -> Result<supermemory::SearchResponse, AppError> {
    validate_not_empty(&q, "Search query")?;
    validate_max_length(&q, MAX_SUPERMEMORY_QUERY_LENGTH, "Search query")?;
    validate_optional_tag(&container_tag, MAX_SUPERMEMORY_TAG_LENGTH)?;

    let client = get_supermemory_client(&app)?;
    let req = supermemory::SearchRequest {
        q,
        container_tag,
        limit: limit.map(|l| l.clamp(1, 100)),
        threshold: None,
    };

    Ok(client.search(&req).await?)
}

// ── Exa API Key Commands ──

#[tauri::command]
pub async fn store_exa_api_key(app: AppHandle, mut key: String) -> Result<(), AppError> {
    if key.trim().is_empty() {
        key.zeroize();
        return Err(AppError::Validation("API key must not be empty".into()));
    }
    if key.len() > MAX_EXA_API_KEY_LENGTH {
        key.zeroize();
        return Err(AppError::Validation(format!(
            "API key exceeds maximum length of {} characters",
            MAX_EXA_API_KEY_LENGTH
        )));
    }

    // Convert to bytes immediately so key data is Zeroizing-protected
    // even if vault access fails below.
    let mut key_bytes = zeroize::Zeroizing::new(key.into_bytes());

    // Store in vault (encrypted) instead of plaintext settings table
    let vault_state = get_vault(&app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    let store_key = format!("api_key:{}", EXA_VAULT_PROVIDER);
    client
        .store()
        .insert(store_key.into_bytes(), key_bytes.to_vec(), None)
        .map_err(|e| {
            error!(error = ?e, "failed to insert exa key into stronghold store");
            AppError::Internal("Failed to store API key".into())
        })?;
    commit_vault(&vault)?;

    let cache = get_exa_key_cache(&app)?;
    let mut guard = cache.0.lock().map_err(|_| {
        AppError::Internal("Failed to acquire API key cache lock".into())
    })?;
    // Zeroize the previous cached key before replacing it.
    if let Some(ref mut old_key) = *guard {
        old_key.zeroize();
    }
    *guard = Some(String::from_utf8(std::mem::take(&mut *key_bytes)).expect("key_bytes originated from a valid UTF-8 String"));

    info!("stored Exa API key in vault");
    Ok(())
}

#[tauri::command]
pub async fn has_exa_api_key(app: AppHandle) -> Result<bool, AppError> {
    let cache = get_exa_key_cache(&app)?;
    let guard = cache.0.lock().map_err(|_| AppError::Internal("Failed to acquire API key cache lock".into()))?;
    Ok(guard.is_some())
}

#[tauri::command]
pub async fn delete_exa_api_key(app: AppHandle) -> Result<(), AppError> {
    // Remove from vault (scoped to drop MutexGuard before .await)
    {
        let vault_state = get_vault(&app)?;
        let vault = lock_vault(vault_state)?;
        let client = get_vault_client(&vault)?;

        let store_key = format!("api_key:{}", EXA_VAULT_PROVIDER);
        let _ = client.store().delete(store_key.as_bytes());
        commit_vault(&vault)?;
    }

    // Also clear any legacy plaintext entry in settings (migration cleanup)
    let pool = get_pool(&app)?;
    sqlx::query("DELETE FROM settings WHERE key = 'exa_api_key'")
        .execute(pool)
        .await?;

    let cache = get_exa_key_cache(&app)?;
    let mut guard = cache.0.lock().map_err(|_| AppError::Internal("Failed to acquire API key cache lock".into()))?;
    if let Some(ref mut old_key) = *guard {
        old_key.zeroize();
    }
    *guard = None;

    info!("deleted Exa API key from vault");
    Ok(())
}

// ── Search Commands ──

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

    // Rate-limit to prevent abuse (e.g. via XSS) that could exhaust API credits.
    {
        const MIN_INTERVAL: std::time::Duration = std::time::Duration::from_millis(500);
        let limiter = app
            .try_state::<SearchRateLimiter>()
            .ok_or(AppError::Internal("Rate limiter not initialized".into()))?;
        let mut last = limiter.0.lock().map_err(|_| {
            AppError::Internal("Failed to acquire rate limiter lock".into())
        })?;
        let now = std::time::Instant::now();
        if let Some(prev) = *last {
            if now.duration_since(prev) < MIN_INTERVAL {
                return Err(AppError::RateLimited);
            }
        }
        *last = Some(now);
    }

    let cache = get_exa_key_cache(&app)?;
    let mut api_key = {
        let guard = cache.0.lock().map_err(|_| AppError::Internal("Failed to acquire API key cache lock".into()))?;
        guard.as_ref().ok_or(AppError::ApiKeyNotConfigured)?.clone()
    };

    let http = get_http_client(&app)?;
    let client = exa::ExaClient::new(http, &api_key);

    let result = client.search(&request).await;
    api_key.zeroize();
    result
}

// ── Vault API Key Commands ──

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
    mut api_key: String,
) -> Result<(), AppError> {
    validate_provider(&provider)?;
    if provider == EXA_VAULT_PROVIDER {
        api_key.zeroize();
        return Err(AppError::Validation(
            "Use store_exa_api_key for the Exa provider".into(),
        ));
    }
    if api_key.is_empty() || api_key.len() > MAX_API_KEY_LENGTH {
        api_key.zeroize();
        return Err(AppError::Validation("Invalid API key".into()));
    }

    // Convert to bytes immediately so key data is Zeroizing-protected
    // even if vault access fails below.
    let mut key_bytes = zeroize::Zeroizing::new(api_key.into_bytes());

    let vault_state = get_vault(&app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    let store_key = format!("api_key:{}", provider);
    client
        .store()
        .insert(store_key.into_bytes(), std::mem::take(&mut *key_bytes), None)
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
    match client.store().get(store_key.as_bytes()) {
        Ok(Some(data)) => {
            // Take ownership directly to avoid cloning sensitive data.
            match String::from_utf8(data) {
                Ok(value) => Ok(Some(value)),
                Err(e) => {
                    // Zeroize the bytes that failed to decode before dropping.
                    e.into_bytes().zeroize();
                    Err(AppError::Internal("Corrupted API key data".into()))
                }
            }
        }
        Ok(None) => Ok(None),
        Err(e) => {
            error!(error = ?e, "failed to read from stronghold store");
            Err(AppError::Internal("Failed to retrieve API key".into()))
        }
    }
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn has_api_key(
    app: AppHandle,
    provider: String,
) -> Result<bool, AppError> {
    validate_provider(&provider)?;

    let vault_state = get_vault(&app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    let store_key = format!("api_key:{}", provider);
    match client.store().get(store_key.as_bytes()) {
        Ok(Some(mut data)) => {
            data.zeroize();
            Ok(true)
        }
        Ok(None) => Ok(false),
        Err(e) => {
            error!(error = ?e, "failed to check stronghold store");
            Err(AppError::Internal("Failed to check API key".into()))
        }
    }
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn delete_api_key(
    app: AppHandle,
    provider: String,
) -> Result<(), AppError> {
    validate_provider(&provider)?;
    if provider == EXA_VAULT_PROVIDER {
        return Err(AppError::Validation(
            "Use delete_exa_api_key for the Exa provider".into(),
        ));
    }

    let vault_state = get_vault(&app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    let store_key = format!("api_key:{}", provider);
    let _ = client.store().delete(store_key.as_bytes());
    commit_vault(&vault)?;

    info!(provider = %provider, "deleted API key from vault");
    Ok(())
}

#[tauri::command]
pub fn get_placement_mode(app: AppHandle) -> Result<PlacementMode, AppError> {
    let state = app
        .try_state::<PlacementState>()
        .ok_or(AppError::Placement("Placement state not initialized".into()))?;
    let mode = state.mode.lock()
        .map_err(|e| {
            error!(error = %e, "placement state mutex poisoned");
            AppError::Placement("Failed to read placement state".into())
        })
        .map(|guard| *guard)?;
    Ok(mode)
}

// ── Global Hotkey ──

fn get_main_window(app_handle: &AppHandle) -> Option<tauri::WebviewWindow> {
    app_handle.get_webview_window("main")
}

fn show_and_focus(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}


fn summon(app_handle: &AppHandle) {
    let Some(window) = get_main_window(app_handle) else { return };

    let was_visible = window.is_visible().unwrap_or(false);
    show_and_focus(&window);

    if !was_visible {
        reapply_current_placement(app_handle, &window);
        let _ = window.emit("new_thread", ());
    }
}

fn reapply_current_placement(app_handle: &AppHandle, window: &tauri::WebviewWindow) {
    let Some(state) = app_handle.try_state::<PlacementState>() else { return };
    let Ok(guard) = state.mode.lock() else { return };
    let _ = placement::apply_placement(window, *guard);
}

fn dismiss(app_handle: &AppHandle) {
    let Some(window) = get_main_window(app_handle) else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn dismiss_window(app: AppHandle) {
    dismiss(&app);
}

fn set_mode_if_visible(app_handle: &AppHandle, mode: PlacementMode) {
    let Some(window) = get_main_window(app_handle) else { return };
    if !window.is_visible().unwrap_or(false) { return };

    let Some(state) = app_handle.try_state::<PlacementState>() else { return };
    let Ok(mut guard) = state.mode.lock() else { return };
    if *guard == mode { return; }

    if let Err(e) = placement::apply_placement(&window, mode) {
        error!(error = %e, "failed to apply placement");
        return;
    }
    *guard = mode;
    drop(guard);
    placement::save_state_async(&state);
}

const PLACEMENT_HOTKEYS: &[(&str, PlacementMode)] = &[
    ("Ctrl+Alt+ArrowLeft", PlacementMode::SidebarLeft),
    ("Ctrl+Alt+ArrowRight", PlacementMode::SidebarRight),
    ("Ctrl+Alt+ArrowUp", PlacementMode::Center),
    ("Ctrl+Alt+ArrowDown", PlacementMode::Compact),
];

pub fn register_hotkey(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.global_shortcut().on_shortcut("Alt+Space", move |h, _, e| {
        if e.state == ShortcutState::Pressed { summon(h); }
    })?;

    for &(key, mode) in PLACEMENT_HOTKEYS {
        app.global_shortcut().on_shortcut(key, move |h, _, e| {
            if e.state == ShortcutState::Pressed { set_mode_if_visible(h, mode); }
        })?;
    }

    Ok(())
}
