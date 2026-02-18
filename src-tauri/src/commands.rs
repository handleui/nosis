use std::sync::{Arc, Mutex, RwLock};

use crate::arcade::{self, ArcadeClient};
use crate::error::AppError;
use crate::exa::{self, ContentOptions, SearchCategory};
use crate::placement::{self, PlacementMode, PlacementState};
use crate::vault::ApiKeyVault;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
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

/// Tracks whether an Exa API key exists in the vault without holding the raw secret.
pub struct ExaKeyPresent(pub Mutex<bool>);

pub struct SearchRateLimiter(pub Mutex<Option<std::time::Instant>>);

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

const MAX_AGENT_ID_LENGTH: usize = 200;
const MAX_ARCADE_API_KEY_LENGTH: usize = 256;
const MAX_ARCADE_BASE_URL_LENGTH: usize = 500;
const MAX_ARCADE_TOOLKIT_LENGTH: usize = 200;
const MAX_ARCADE_INPUT_BYTES: usize = 1_000_000;

fn validate_agent_id(agent_id: &str) -> Result<(), AppError> {
    validate_identifier(agent_id, MAX_AGENT_ID_LENGTH, "Agent ID", &['-', '_', '.', ':'])
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

/// Validate that a base URL uses HTTPS (or HTTP for localhost dev) and has a valid host.
/// Prevents SSRF via file://, ftp://, or requests to internal network addresses.
pub(crate) fn validate_base_url(url_str: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url_str)
        .map_err(|_| AppError::Validation("Base URL is not a valid URL".into()))?;

    // Reject URLs with embedded credentials (e.g., https://evil@internal-host/)
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::Validation(
            "Base URL must not contain credentials".into(),
        ));
    }

    match parsed.scheme() {
        "https" => {}
        "http" => {
            // Allow http only for localhost development
            let host = parsed.host_str().unwrap_or("");
            if host != "localhost" {
                return Err(AppError::Validation(
                    "Base URL must use HTTPS (HTTP is only allowed for localhost)".into(),
                ));
            }
        }
        _ => {
            return Err(AppError::Validation(
                "Base URL must use HTTPS".into(),
            ));
        }
    }

    // Block private/internal addresses to prevent SSRF.
    // Use the url crate's parsed Host enum for robust IP range checking
    // instead of fragile string-prefix matching.
    match parsed.host() {
        Some(url::Host::Ipv4(ip)) => {
            if ip.is_private()         // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                || ip.is_loopback()    // 127.0.0.0/8
                || ip.is_unspecified() // 0.0.0.0
                || ip.is_link_local()  // 169.254.0.0/16 (covers AWS metadata endpoint)
                || ip.is_broadcast()   // 255.255.255.255
                || ip.is_multicast()   // 224.0.0.0/4
            {
                return Err(AppError::Validation(
                    "Base URL must not point to a private or internal address".into(),
                ));
            }
        }
        Some(url::Host::Ipv6(ip)) => {
            // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) bypass native IPv6
            // checks like is_loopback(), so extract and check the inner IPv4 address.
            if let Some(v4) = ip.to_ipv4_mapped() {
                if v4.is_private()
                    || v4.is_loopback()
                    || v4.is_unspecified()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_multicast()
                {
                    return Err(AppError::Validation(
                        "Base URL must not point to a private or internal address".into(),
                    ));
                }
            }
            if ip.is_loopback()       // ::1
                || ip.is_unspecified() // ::
                || ip.is_multicast()  // ff00::/8
                // RFC 4193 unique local addresses (fc00::/7)
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                // Link-local unicast (fe80::/10)
                || (ip.segments()[0] & 0xffc0) == 0xfe80
            {
                return Err(AppError::Validation(
                    "Base URL must not point to a private or internal address".into(),
                ));
            }
        }
        Some(url::Host::Domain(domain)) => {
            let lower = domain.to_lowercase();
            if lower == "localhost"
                || lower.ends_with(".internal")
                || lower.ends_with(".local")
                || lower.ends_with(".localhost")
            {
                return Err(AppError::Validation(
                    "Base URL must not point to a private or internal address".into(),
                ));
            }
            // Note: "localhost" is also caught by the lower == "localhost" check above,
            // ensuring it's blocked for both http and https.
        }
        None => {
            return Err(AppError::Validation("Base URL must have a valid host".into()));
        }
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

fn get_exa_key_flag(app: &AppHandle) -> Result<&ExaKeyPresent, AppError> {
    app.try_state::<ExaKeyPresent>()
        .ok_or(AppError::Internal("API key presence flag not initialized".into()))
        .map(|state| state.inner())
}

fn lock_exa_flag(
    flag: &ExaKeyPresent,
) -> Result<std::sync::MutexGuard<'_, bool>, AppError> {
    flag
        .0
        .lock()
        .map_err(|_| AppError::Internal("Failed to acquire API key flag lock".into()))
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

// ── Exa API Key Commands ──

#[tauri::command]
#[instrument(skip(app, key))]
pub async fn store_exa_api_key(app: AppHandle, key: String) -> Result<(), AppError> {
    let key = zeroize::Zeroizing::new(key);
    validate_non_empty_bounded(&key, MAX_EXA_API_KEY_LENGTH, "API key")?;

    write_exa_vault_key(&app, b"api_key:exa", key.as_bytes().to_vec(), true, "store")?;

    info!("stored exa API key in vault");
    Ok(())
}

#[tauri::command]
pub async fn has_exa_api_key(app: AppHandle) -> Result<bool, AppError> {
    let flag = get_exa_key_flag(&app)?;
    let guard = lock_exa_flag(flag)?;
    Ok(*guard)
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn delete_exa_api_key(app: AppHandle) -> Result<(), AppError> {
    write_exa_vault_key(&app, b"api_key:exa", Vec::new(), false, "delete")?;

    info!("deleted exa API key from vault");
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

    let mut api_key = read_vault_key(&app, b"api_key:exa")?;

    let http = get_http_client(&app)?;
    let exa = exa::ExaClient::new(http, &api_key);
    let result = exa.search(&request).await;

    api_key.zeroize();
    result
}

// ── Vault Helpers ──

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

fn write_exa_vault_key(
    app: &AppHandle,
    store_key: &[u8],
    value: Vec<u8>,
    flag_value: bool,
    op_name: &str,
) -> Result<(), AppError> {
    let vault_state = get_vault(app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    client
        .store()
        .insert(store_key.to_vec(), value, None)
        .map_err(|e| {
            error!(error = ?e, "failed to {} key in stronghold store", op_name);
            AppError::Internal(format!("Failed to {} API key", op_name))
        })?;

    commit_vault(&vault)?;

    let flag = get_exa_key_flag(app)?;
    let mut guard = lock_exa_flag(flag)?;
    *guard = flag_value;

    Ok(())
}

fn read_vault_key(app: &AppHandle, store_key: &[u8]) -> Result<String, AppError> {
    let vault_state = get_vault(app)?;
    let vault = lock_vault(vault_state)?;
    let client = get_vault_client(&vault)?;

    let data = client
        .store()
        .get(store_key)
        .map_err(|e| {
            error!(error = ?e, "failed to read key from stronghold store");
            AppError::Internal("Failed to retrieve API key".into())
        })?;

    let key_bytes = data
        .filter(|b| !b.is_empty())
        .ok_or(AppError::ApiKeyNotConfigured)?;

    String::from_utf8(key_bytes).map_err(|e| {
        let mut bad = e.into_bytes();
        bad.zeroize();
        AppError::Internal("Corrupted API key data".into())
    })
}

// ── Generic API Key Commands ──

#[tauri::command]
#[instrument(skip(app, api_key))]
pub async fn store_api_key(
    app: AppHandle,
    provider: String,
    api_key: String,
) -> Result<(), AppError> {
    let api_key = zeroize::Zeroizing::new(api_key);
    validate_provider(&provider)?;
    if provider == EXA_VAULT_PROVIDER {
        return Err(AppError::Validation(
            "Use store_exa_api_key for the Exa provider".into(),
        ));
    }
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

    let Some(bytes) = data.filter(|b| !b.is_empty()) else {
        return Ok(None);
    };

    let value = String::from_utf8(bytes).map_err(|e| {
        let mut bad = e.into_bytes();
        bad.zeroize();
        AppError::Internal("Corrupted API key data".into())
    })?;

    Ok(Some(value))
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

#[tauri::command]
pub async fn arcade_set_config(
    app: AppHandle,
    mut api_key: String,
    user_id: String,
    base_url: Option<String>,
) -> Result<(), AppError> {
    validate_non_empty_bounded(&api_key, MAX_ARCADE_API_KEY_LENGTH, "API key")?;
    arcade::validate_user_id(&user_id)?;
    if let Some(ref url) = base_url {
        validate_non_empty_bounded(url, MAX_ARCADE_BASE_URL_LENGTH, "Base URL")?;
        validate_base_url(url)?;
    }

    // Store API key in the encrypted vault (not plaintext settings)
    {
        let vault_state = get_vault(&app)?;
        let vault = lock_vault(vault_state)?;
        let client = get_vault_client(&vault)?;

        let key_bytes = api_key.as_bytes().to_vec();
        client
            .store()
            .insert(b"arcade_api_key".to_vec(), key_bytes, None)
            .map_err(|e| {
                error!(error = ?e, "failed to store arcade API key in vault");
                AppError::Internal("Failed to store API key".into())
            })?;
        commit_vault(&vault)?;
    }

    // Store non-secret config in settings
    let pool = get_pool(&app)?;
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('arcade_user_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(&user_id)
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

    let client = ArcadeClient::new(api_key.clone(), user_id, base_url)?;
    api_key.zeroize();
    let state = app.state::<RwLock<Option<Arc<ArcadeClient>>>>();
    let mut guard = state.write().map_err(|e| {
        error!(error = %e, "arcade RwLock poisoned");
        AppError::ArcadeNotConfigured
    })?;
    *guard = Some(Arc::new(client));

    Ok(())
}

#[derive(Serialize)]
pub struct ArcadeConfigStatus {
    pub configured: bool,
    pub user_id: Option<String>,
}

#[tauri::command]
pub async fn arcade_get_config(app: AppHandle) -> Result<ArcadeConfigStatus, AppError> {
    // Check API key existence in the vault without loading its value into memory
    let has_key = {
        let vault_state = get_vault(&app)?;
        let vault = lock_vault(vault_state)?;
        let client = get_vault_client(&vault)?;
        matches!(client.store().get(b"arcade_api_key"), Ok(Some(_)))
    };

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
    // Remove API key from the encrypted vault
    {
        let vault_state = get_vault(&app)?;
        let vault = lock_vault(vault_state)?;
        let client = get_vault_client(&vault)?;
        let _ = client.store().delete(b"arcade_api_key");
        commit_vault(&vault)?;
    }

    // Remove non-secret config from settings
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
        if let Some(ref url_str) = resp.url {
            // Parse and validate the URL scheme to prevent opening javascript:, file:,
            // data:, or custom scheme URLs from a potentially malicious API response.
            // url::Url::parse normalizes the scheme to lowercase, so this is case-insensitive.
            if let Ok(parsed) = url::Url::parse(url_str) {
                if parsed.scheme() == "https" || parsed.scheme() == "http" {
                    if let Err(e) = app.opener().open_url(url_str, None::<&str>) {
                        error!(error = %e, "failed to open authorization URL");
                    }
                }
            }
        }
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
    // Authorization IDs should only contain safe characters (alphanumeric, hyphens, underscores)
    if !authorization_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Validation(
            "Authorization ID contains invalid characters".into(),
        ));
    }
    let client = get_arcade_client(&app)?;

    // Clamp the wait timeout to prevent excessively long server-side polling
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
