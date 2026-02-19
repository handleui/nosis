use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use crate::arcade::{self, ArcadeClient};
use crate::error::AppError;
use crate::fal;
use crate::oauth_callback::OAuthSessionHandle;
use crate::placement::{self, PlacementMode, PlacementState};
use crate::secrets::SecretStore;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tracing::{error, info, instrument, warn};

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

pub struct FalKeyCache(pub RwLock<Option<String>>);

#[derive(Debug, Serialize, FromRow)]
pub struct Generation {
    pub id: String,
    pub conversation_id: Option<String>,
    pub model: String,
    pub prompt: String,
    pub image_url: String,
    pub width: i64,
    pub height: i64,
    pub seed: Option<String>,
    pub inference_time_ms: Option<f64>,
    pub created_at: String,
}

/// Tracks active OAuth callback sessions so they can be shut down early.
pub struct OAuthSessions(pub Mutex<HashMap<String, OAuthSessionHandle>>);

const MAX_TITLE_LENGTH: usize = 500;
const MAX_CONTENT_LENGTH: usize = 100_000;
const MAX_MODEL_LENGTH: usize = 100;
const MAX_API_KEY_LENGTH: usize = 500;
const MAX_SETTING_KEY_LENGTH: usize = 255;
const MAX_SETTING_VALUE_LENGTH: usize = 10_000;
const MAX_PROVIDER_LENGTH: usize = 50;
const DEFAULT_PAGE_SIZE: i32 = 100;
const MAX_AGENT_ID_LENGTH: usize = 200;
const MAX_ARCADE_API_KEY_LENGTH: usize = 256;
const MAX_ARCADE_BASE_URL_LENGTH: usize = 500;
const MAX_ARCADE_TOOLKIT_LENGTH: usize = 200;
const MAX_ARCADE_INPUT_BYTES: usize = 1_000_000;

fn gen_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn validate_uuid(id: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidId)?;
    Ok(())
}

fn validate_api_key(key: &str) -> Result<(), AppError> {
    validate_non_empty_bounded(key, MAX_API_KEY_LENGTH, "API key")
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
    validate_non_empty_bounded(content, MAX_CONTENT_LENGTH, "Content")?;
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

fn validate_agent_id(agent_id: &str) -> Result<(), AppError> {
    validate_identifier(agent_id, MAX_AGENT_ID_LENGTH, "Agent ID", &['-', '_', '.', ':'])
}

fn validate_setting_key(key: &str) -> Result<(), AppError> {
    validate_identifier(key, MAX_SETTING_KEY_LENGTH, "Setting key", &['-', '_', '.'])
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    validate_identifier(provider, MAX_PROVIDER_LENGTH, "Provider name", &['-', '_', ':'])
}

fn read_cache<T>(lock: &RwLock<T>) -> Result<std::sync::RwLockReadGuard<'_, T>, AppError> {
    lock.read()
        .map_err(|_| AppError::Internal("Failed to acquire cache lock".into()))
}

fn write_cache<T>(lock: &RwLock<T>) -> Result<std::sync::RwLockWriteGuard<'_, T>, AppError> {
    lock.write()
        .map_err(|_| AppError::Internal("Failed to acquire cache lock".into()))
}

async fn blocking<F, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(format!("spawn_blocking: {e}")))?
}

/// Allowlist (not suffix match) to block attacker-controlled subdomains.
const TRUSTED_FAL_HOSTS: &[&str] = &["fal.media", "v2.fal.media", "v3.fal.media"];

fn is_trusted_fal_image_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    if parsed.port().is_some() {
        return false;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    TRUSTED_FAL_HOSTS.contains(&host)
}

pub(crate) fn validate_base_url(url_str: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url_str)
        .map_err(|_| AppError::Validation("Base URL is not a valid URL".into()))?;

    reject_url_credentials_and_extras(&parsed)?;
    validate_url_scheme(&parsed)?;
    reject_private_host(&parsed)?;

    Ok(())
}

fn reject_url_credentials_and_extras(parsed: &url::Url) -> Result<(), AppError> {
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Validation(
            "Base URL must not contain credentials".into(),
        ));
    }
    if parsed.fragment().is_some() {
        return Err(AppError::Validation(
            "Base URL must not contain a fragment (#)".into(),
        ));
    }
    if parsed.query().is_some() {
        return Err(AppError::Validation(
            "Base URL must not contain query parameters".into(),
        ));
    }
    Ok(())
}

fn validate_url_scheme(parsed: &url::Url) -> Result<(), AppError> {
    match parsed.scheme() {
        "https" => Ok(()),
        "http" if parsed.host_str() == Some("localhost") => Ok(()),
        "http" => Err(AppError::Validation(
            "Base URL must use HTTPS (HTTP is only allowed for localhost)".into(),
        )),
        _ => Err(AppError::Validation("Base URL must use HTTPS".into())),
    }
}

fn is_private_ipv4(ip: &std::net::Ipv4Addr) -> bool {
    ip.is_private()
        || ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
}

fn is_private_ipv6(ip: &std::net::Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        if is_private_ipv4(&v4) {
            return true;
        }
    }
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (ip.segments()[0] & 0xfe00) == 0xfc00
        || (ip.segments()[0] & 0xffc0) == 0xfe80
}

fn is_private_domain(domain: &str) -> bool {
    let lower = domain.to_lowercase();
    lower == "localhost"
        || lower.ends_with(".internal")
        || lower.ends_with(".local")
        || lower.ends_with(".localhost")
}

fn reject_private_host(parsed: &url::Url) -> Result<(), AppError> {
    let err = || AppError::Validation("Base URL must not point to a private or internal address".into());

    match parsed.host() {
        Some(url::Host::Ipv4(ip)) if is_private_ipv4(&ip) => Err(err()),
        Some(url::Host::Ipv6(ip)) if is_private_ipv6(&ip) => Err(err()),
        Some(url::Host::Domain(domain)) if is_private_domain(domain) => Err(err()),
        None => Err(AppError::Validation("Base URL must have a valid host".into())),
        _ => Ok(()),
    }
}

fn get_pool(app: &AppHandle) -> Result<&SqlitePool, AppError> {
    app.try_state::<SqlitePool>()
        .ok_or(AppError::DbNotInitialized)
        .map(|state| state.inner())
}

fn get_secret_store(app: &AppHandle) -> Result<Arc<SecretStore>, AppError> {
    app.try_state::<Arc<SecretStore>>()
        .ok_or(AppError::SecretStore("secret store not initialized".into()))
        .map(|state| Arc::clone(state.inner()))
}

fn get_http_client(app: &AppHandle) -> Result<&reqwest::Client, AppError> {
    app.try_state::<reqwest::Client>()
        .ok_or(AppError::Internal("HTTP client not initialized".into()))
        .map(|state| state.inner())
}

fn get_fal_key_cache(app: &AppHandle) -> Result<&FalKeyCache, AppError> {
    app.try_state::<FalKeyCache>()
        .ok_or(AppError::Internal("API key cache not initialized".into()))
        .map(|state| state.inner())
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

// ── Letta Agent Commands ──

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

// ── Generic API Key Commands ──

#[tauri::command]
#[instrument(skip(app, api_key))]
pub async fn store_api_key(
    app: AppHandle,
    provider: String,
    api_key: String,
) -> Result<(), AppError> {
    validate_provider(&provider)?;
    validate_api_key(&api_key)?;

    let store_key = format!("api_key:{}", provider);
    let store = get_secret_store(&app)?;
    let key_bytes = api_key.as_bytes().to_vec();
    blocking(move || store.insert(&store_key, key_bytes)).await?;

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

    let store = get_secret_store(&app)?;
    let store_key = format!("api_key:{}", provider);
    let data = blocking(move || store.get(&store_key)).await?;
    data.map(|bytes| {
        String::from_utf8(bytes)
            .map_err(|_| AppError::Internal("Corrupted API key data".into()))
    })
    .transpose()
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn has_api_key(
    app: AppHandle,
    provider: String,
) -> Result<bool, AppError> {
    validate_provider(&provider)?;

    let store = get_secret_store(&app)?;
    let store_key = format!("api_key:{}", provider);
    let data = blocking(move || store.get(&store_key)).await?;
    Ok(data.is_some())
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn delete_api_key(
    app: AppHandle,
    provider: String,
) -> Result<(), AppError> {
    validate_provider(&provider)?;

    let store = get_secret_store(&app)?;
    let store_key = format!("api_key:{}", provider);
    blocking(move || store.remove(&store_key)).await?;

    info!(provider = %provider, "deleted API key");
    Ok(())
}

// ── Fal.ai API Key Commands ──

#[tauri::command]
#[instrument(skip(app, key))]
pub async fn store_fal_api_key(app: AppHandle, key: String) -> Result<(), AppError> {
    validate_api_key(&key)?;
    let store = get_secret_store(&app)?;
    let key_bytes = key.as_bytes().to_vec();
    blocking(move || store.insert("fal_api_key", key_bytes)).await?;
    *write_cache(&get_fal_key_cache(&app)?.0)? = Some(key);
    info!("stored fal API key");
    Ok(())
}

#[tauri::command]
pub async fn has_fal_api_key(app: AppHandle) -> Result<bool, AppError> {
    Ok(read_cache(&get_fal_key_cache(&app)?.0)?.is_some())
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn delete_fal_api_key(app: AppHandle) -> Result<(), AppError> {
    let store = get_secret_store(&app)?;
    blocking(move || store.remove("fal_api_key")).await?;
    *write_cache(&get_fal_key_cache(&app)?.0)? = None;
    info!("deleted fal API key");
    Ok(())
}

// ── Image Generation Commands ──

fn validate_image_urls(response: &fal::ImageGenerationResponse) -> Result<(), AppError> {
    for image in &response.images {
        if !is_trusted_fal_image_url(&image.url) {
            warn!(
                url_len = image.url.len(),
                "fal.ai: rejecting image URL from untrusted domain"
            );
            return Err(AppError::Validation(
                "Image generation returned an unexpected URL".into(),
            ));
        }
    }
    Ok(())
}

async fn persist_generations(
    pool: &SqlitePool,
    response: &fal::ImageGenerationResponse,
    conversation_id: &Option<String>,
    model: &fal::FalModel,
    prompt: &str,
) -> Result<(), AppError> {
    if response.images.is_empty() {
        return Ok(());
    }

    let inference_time_ms = response
        .timings
        .as_ref()
        .and_then(|t| t.inference)
        .map(|secs| secs * 1000.0);
    let seed = response.seed.map(|s| s.to_string());
    let model_str = model.as_path();

    let mut tx = pool.begin().await?;

    for image in &response.images {
        sqlx::query(
            "INSERT INTO generations (id, conversation_id, model, prompt, image_url, width, height, seed, inference_time_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(gen_id())
        .bind(conversation_id)
        .bind(model_str)
        .bind(prompt)
        .bind(&image.url)
        .bind(i64::from(image.width))
        .bind(i64::from(image.height))
        .bind(seed.as_deref())
        .bind(inference_time_ms)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}

// ── Arcade Commands ──

fn get_arcade_client(app: &AppHandle) -> Result<Arc<ArcadeClient>, AppError> {
    let state = app
        .try_state::<RwLock<Option<Arc<ArcadeClient>>>>()
        .ok_or(AppError::ArcadeNotConfigured)?;
    let guard = state.read().map_err(|e| {
        error!(error = %e, "arcade RwLock poisoned");
        AppError::ArcadeNotConfigured
    })?;
    guard
        .as_ref()
        .cloned()
        .ok_or(AppError::ArcadeNotConfigured)
}

async fn persist_arcade_settings(
    pool: &SqlitePool,
    user_id: &str,
    base_url: &Option<String>,
) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('arcade_user_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    if let Some(ref url) = base_url {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES ('arcade_base_url', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        )
        .bind(url)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query("DELETE FROM settings WHERE key = 'arcade_base_url'")
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

fn set_arcade_client(app: &AppHandle, client: ArcadeClient) -> Result<(), AppError> {
    let state = app.state::<RwLock<Option<Arc<ArcadeClient>>>>();
    let mut guard = state.write().map_err(|e| {
        error!(error = %e, "arcade RwLock poisoned");
        AppError::ArcadeNotConfigured
    })?;
    *guard = Some(Arc::new(client));
    Ok(())
}

#[tauri::command]
pub async fn arcade_set_config(
    app: AppHandle,
    api_key: String,
    user_id: String,
    base_url: Option<String>,
) -> Result<(), AppError> {
    validate_non_empty_bounded(&api_key, MAX_ARCADE_API_KEY_LENGTH, "API key")?;
    arcade::validate_user_id(&user_id)?;
    if let Some(ref url) = base_url {
        validate_non_empty_bounded(url, MAX_ARCADE_BASE_URL_LENGTH, "Base URL")?;
        validate_base_url(url)?;
    }

    let store = get_secret_store(&app)?;
    let key_bytes = api_key.as_bytes().to_vec();
    blocking({
        let store = Arc::clone(&store);
        move || store.insert("arcade_api_key", key_bytes)
    })
    .await?;

    persist_arcade_settings(get_pool(&app)?, &user_id, &base_url).await?;

    let client = ArcadeClient::new(api_key, user_id, base_url)?;
    set_arcade_client(&app, client)?;

    Ok(())
}

#[derive(Serialize)]
pub struct ArcadeConfigStatus {
    pub configured: bool,
    pub user_id: Option<String>,
}

#[tauri::command]
pub async fn arcade_get_config(app: AppHandle) -> Result<ArcadeConfigStatus, AppError> {
    let store = get_secret_store(&app)?;
    let has_key = blocking(move || {
        Ok(store.get("arcade_api_key")?.is_some())
    })
    .await?;

    let pool = get_pool(&app)?;
    let user_id: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'arcade_user_id'")
            .fetch_optional(pool)
            .await?;

    Ok(ArcadeConfigStatus {
        configured: has_key && user_id.is_some(),
        user_id,
    })
}

#[tauri::command]
pub async fn arcade_delete_config(app: AppHandle) -> Result<(), AppError> {
    let store = get_secret_store(&app)?;
    blocking(move || store.remove("arcade_api_key")).await?;

    let pool = get_pool(&app)?;
    sqlx::query("DELETE FROM settings WHERE key IN ('arcade_user_id', 'arcade_base_url')")
        .execute(pool)
        .await?;

    let state = app.state::<RwLock<Option<Arc<ArcadeClient>>>>();
    let mut guard = state.write().map_err(|e| {
        error!(error = %e, "arcade RwLock poisoned");
        AppError::ArcadeNotConfigured
    })?;
    *guard = None;

    Ok(())
}

#[tauri::command]
pub async fn arcade_list_tools(
    app: AppHandle,
    toolkit: Option<String>,
    limit: Option<u32>,
) -> Result<arcade::ToolsListResponse, AppError> {
    if let Some(ref tk) = toolkit {
        validate_non_empty_bounded(tk, MAX_ARCADE_TOOLKIT_LENGTH, "Toolkit name")?;
    }
    let client = get_arcade_client(&app)?;
    Ok(client.list_tools(toolkit.as_deref(), limit).await?)
}

#[derive(Serialize)]
pub struct AuthorizeResult {
    pub status: String,
    pub authorization_id: Option<String>,
    pub url: Option<String>,
}

fn open_auth_url_if_valid(app: &AppHandle, url_str: Option<&str>) {
    let Some(url_str) = url_str else { return };
    let Ok(parsed) = url::Url::parse(url_str) else { return };
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return;
    }
    if let Err(e) = app.opener().open_url(url_str, None::<&str>) {
        error!(error = %e, "failed to open authorization URL");
    }
}

#[tauri::command]
pub async fn arcade_authorize_tool(
    app: AppHandle,
    tool_name: String,
) -> Result<AuthorizeResult, AppError> {
    arcade::validate_tool_name(&tool_name)?;
    let client = get_arcade_client(&app)?;

    let resp = client.authorize_tool(&tool_name).await?;
    let status = resp.status.clone().unwrap_or_default();

    if status != "completed" {
        open_auth_url_if_valid(&app, resp.url.as_deref());
    }

    Ok(AuthorizeResult {
        status,
        authorization_id: resp.id,
        url: resp.url,
    })
}

#[tauri::command]
pub async fn arcade_check_auth_status(
    app: AppHandle,
    authorization_id: String,
    wait: Option<u32>,
) -> Result<AuthorizeResult, AppError> {
    validate_non_empty_bounded(&authorization_id, 256, "Authorization ID")?;
    if !authorization_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "Authorization ID contains invalid characters".into(),
        ));
    }
    let client = get_arcade_client(&app)?;

    let resp = client
        .check_auth_status(&authorization_id, wait.map(|w| w.min(59)))
        .await?;

    Ok(AuthorizeResult {
        status: resp.status.unwrap_or_default(),
        authorization_id: resp.id,
        url: resp.url,
    })
}

#[tauri::command]
pub async fn arcade_execute_tool(
    app: AppHandle,
    tool_name: String,
    input: Option<serde_json::Value>,
) -> Result<arcade::ExecuteToolResponse, AppError> {
    arcade::validate_tool_name(&tool_name)?;
    if let Some(ref val) = input {
        let estimated_size = serde_json::to_string(val)
            .map(|s| s.len())
            .unwrap_or(0);
        if estimated_size > MAX_ARCADE_INPUT_BYTES {
            return Err(AppError::Validation(format!(
                "Tool input exceeds maximum size of {MAX_ARCADE_INPUT_BYTES} bytes"
            )));
        }
    }
    let client = get_arcade_client(&app)?;
    Ok(client.execute_tool(&tool_name, input).await?)
}

// ── Image Generation Commands ──

#[tauri::command]
#[instrument(skip(app))]
pub async fn generate_image(
    app: AppHandle,
    prompt: String,
    model: Option<fal::FalModel>,
    image_size: Option<fal::ImageSizePreset>,
    num_inference_steps: Option<u32>,
    conversation_id: Option<String>,
) -> Result<fal::ImageGenerationResponse, AppError> {
    if let Some(ref cid) = conversation_id {
        validate_uuid(cid)?;
    }

    let model = model.unwrap_or(fal::FalModel::FluxSchnell);
    let request = fal::ImageGenerationRequest {
        prompt,
        image_size,
        num_inference_steps,
    };
    fal::validate_generation_request(&request)?;

    let api_key = read_cache(&get_fal_key_cache(&app)?.0)?
        .clone()
        .ok_or(AppError::ApiKeyNotConfigured)?;

    let http = get_http_client(&app)?;
    let response = fal::FalClient::new(http, &api_key)
        .generate_image(&model, &request)
        .await?;

    validate_image_urls(&response)?;
    persist_generations(get_pool(&app)?, &response, &conversation_id, &model, &request.prompt).await?;

    Ok(response)
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn list_generations(
    app: AppHandle,
    conversation_id: Option<String>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Vec<Generation>, AppError> {
    if let Some(ref cid) = conversation_id {
        validate_uuid(cid)?;
    }

    let pool = get_pool(&app)?;
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);

    let (sql, filter_id) = match conversation_id {
        Some(ref cid) => (
            "SELECT id, conversation_id, model, prompt, image_url, width, height, seed, inference_time_ms, created_at
             FROM generations WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            Some(cid.as_str()),
        ),
        None => (
            "SELECT id, conversation_id, model, prompt, image_url, width, height, seed, inference_time_ms, created_at
             FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
            None,
        ),
    };

    let mut query = sqlx::query_as::<Sqlite, Generation>(sql);
    if let Some(cid) = filter_id {
        query = query.bind(cid);
    }
    Ok(query.bind(limit).bind(offset).fetch_all(pool).await?)
}

// ── MCP Server Commands ──

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub auth_type: String,
    pub created_at: String,
    pub updated_at: String,
}

const MAX_MCP_NAME_LENGTH: usize = 100;
const MAX_MCP_URL_LENGTH: usize = 2000;

fn validate_mcp_name(name: &str) -> Result<(), AppError> {
    validate_non_empty_bounded(name, MAX_MCP_NAME_LENGTH, "Server name")?;
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "Server name may only contain alphanumeric characters, hyphens, and underscores".into(),
        ));
    }
    Ok(())
}

fn validate_mcp_url(url: &str) -> Result<(), AppError> {
    validate_non_empty_bounded(url, MAX_MCP_URL_LENGTH, "URL")?;

    let is_https = url.starts_with("https://");
    let is_loopback_http = url.starts_with("http://127.0.0.1")
        || url.starts_with("http://localhost")
        || url.starts_with("http://[::1]");

    if !is_https && !is_loopback_http {
        return Err(AppError::Validation(
            "URL must use https:// (http:// is only allowed for loopback addresses)".into(),
        ));
    }
    if url.contains('@') {
        return Err(AppError::Validation(
            "URL must not contain credentials; use API key auth instead".into(),
        ));
    }
    Ok(())
}

fn validate_mcp_auth_type(auth_type: &str) -> Result<(), AppError> {
    if !matches!(auth_type, "none" | "api_key" | "oauth") {
        return Err(AppError::Validation(
            "Auth type must be 'none', 'api_key', or 'oauth'".into(),
        ));
    }
    Ok(())
}

fn validate_mcp_api_key(auth_type: &str, api_key: &Option<String>) -> Result<(), AppError> {
    if auth_type != "api_key" {
        return Ok(());
    }
    let key = api_key.as_ref().ok_or_else(|| {
        AppError::Validation("API key is required for api_key auth type".into())
    })?;
    if key.trim().is_empty() || key.len() > MAX_API_KEY_LENGTH {
        return Err(AppError::Validation("Invalid API key".into()));
    }
    Ok(())
}

async fn store_mcp_secret(store: &Arc<SecretStore>, server_id: &str, api_key: String) -> Result<(), AppError> {
    let store_key = format!("api_key:mcp:{server_id}");
    let store = Arc::clone(store);
    let key_bytes = api_key.into_bytes();
    blocking(move || store.insert(&store_key, key_bytes)).await
}

async fn delete_mcp_secret_entries(store: &Arc<SecretStore>, server_id: &str) -> Result<(), AppError> {
    let store = Arc::clone(store);
    let sid = server_id.to_string();
    blocking(move || {
        for suffix in ["", ":tokens", ":client_info", ":code_verifier"] {
            let key = format!("api_key:mcp:{sid}{suffix}");
            store.remove(&key)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
#[instrument(skip(app, api_key))]
pub async fn add_mcp_server(
    app: AppHandle,
    name: String,
    url: String,
    auth_type: Option<String>,
    api_key: Option<String>,
) -> Result<McpServer, AppError> {
    validate_mcp_name(&name)?;
    validate_mcp_url(&url)?;
    let auth_type = auth_type.unwrap_or_else(|| "none".to_string());
    validate_mcp_auth_type(&auth_type)?;
    validate_mcp_api_key(&auth_type, &api_key)?;

    let pool = get_pool(&app)?;
    let id = gen_id();

    let server = sqlx::query_as::<Sqlite, McpServer>(
        "INSERT INTO mcp_servers (id, name, url, auth_type) VALUES (?, ?, ?, ?)
         RETURNING id, name, url, auth_type, created_at, updated_at",
    )
    .bind(&id)
    .bind(&name)
    .bind(&url)
    .bind(&auth_type)
    .fetch_one(pool)
    .await?;

    if let Some(key) = api_key {
        let store = get_secret_store(&app)?;
        store_mcp_secret(&store, &id, key).await?;
        info!(server_name = %name, "stored MCP API key");
    }

    info!(server_name = %name, auth_type = %auth_type, "added MCP server");
    Ok(server)
}

#[tauri::command]
pub async fn list_mcp_servers(app: AppHandle) -> Result<Vec<McpServer>, AppError> {
    let pool = get_pool(&app)?;
    Ok(sqlx::query_as::<Sqlite, McpServer>(
        "SELECT id, name, url, auth_type, created_at, updated_at
         FROM mcp_servers ORDER BY name ASC",
    )
    .fetch_all(pool)
    .await?)
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn delete_mcp_server(app: AppHandle, id: String) -> Result<(), AppError> {
    validate_uuid(&id)?;

    let pool = get_pool(&app)?;
    let result = sqlx::query("DELETE FROM mcp_servers WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("MCP server"));
    }

    // Shut down any active OAuth session for this server
    match app.state::<OAuthSessions>().0.lock() {
        Ok(mut map) => {
            if let Some(handle) = map.remove(&id) {
                handle.shutdown();
            }
        }
        Err(e) => {
            error!(error = %e, "failed to lock OAuth sessions — callback server may remain active");
        }
    }

    let store = get_secret_store(&app)?;
    delete_mcp_secret_entries(&store, &id).await?;
    info!("deleted MCP server and secret entries");
    Ok(())
}

#[tauri::command]
pub async fn start_oauth_callback_server(
    app: AppHandle,
    expected_state: String,
    server_id: Option<String>,
) -> Result<u16, AppError> {
    if expected_state.is_empty() || expected_state.len() > 256 {
        return Err(AppError::Validation(
            "OAuth state parameter must be 1-256 characters".into(),
        ));
    }
    if !expected_state
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::Validation(
            "OAuth state parameter contains invalid characters".into(),
        ));
    }
    let (port, handle) =
        crate::oauth_callback::start_callback_server(app.clone(), 300, expected_state)
            .map_err(AppError::Internal)?;

    // Track session by server ID so it can be shut down when the server is deleted
    if let Some(id) = server_id {
        if let Ok(mut map) = app.state::<OAuthSessions>().0.lock() {
            map.insert(id, handle);
        }
    }

    Ok(port)
}

#[tauri::command]
pub fn shutdown_oauth_session(app: AppHandle, server_id: String) {
    if let Ok(mut map) = app.state::<OAuthSessions>().0.lock() {
        if let Some(handle) = map.remove(&server_id) {
            handle.shutdown();
        }
    }
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
