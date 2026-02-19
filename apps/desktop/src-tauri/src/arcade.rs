use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fmt::Write;
use std::time::Duration;

use zeroize::Zeroizing;

use crate::util::truncate_to_char_boundary;

const ARCADE_BASE_URL: &str = "https://api.arcade.dev";
const MAX_ERROR_BODY: usize = 1024;
const MAX_TOOL_NAME_LENGTH: usize = 200;
const MAX_USER_ID_LENGTH: usize = 256;

/// Percent-encode a string for safe use in URL paths and query parameters.
/// Encodes everything except unreserved characters (RFC 3986: A-Z a-z 0-9 - . _ ~).
fn percent_encode(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    encoded
}

// ── Error ──

/// Errors from the Arcade API client.
///
/// Display and Debug omit raw bodies and inner reqwest errors to prevent
/// leaking sensitive data (Bearer tokens, headers) through logs or IPC.
#[derive(thiserror::Error)]
pub(crate) enum ArcadeError {
    #[error("Failed to build HTTP client")]
    HttpClient(reqwest::Error),

    #[error("Request failed")]
    Request(reqwest::Error),

    #[error("Failed to parse response")]
    Deserialize(reqwest::Error),

    #[error("API error (HTTP {status})")]
    Api { status: u16, message: String },
}

/// Redacted `Debug` to avoid leaking tokens or response bodies.
impl std::fmt::Debug for ArcadeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HttpClient(_) => f.debug_tuple("HttpClient").field(&"<redacted>").finish(),
            Self::Request(_) => f.debug_tuple("Request").field(&"<redacted>").finish(),
            Self::Deserialize(_) => f.debug_tuple("Deserialize").field(&"<redacted>").finish(),
            Self::Api { status, .. } => f
                .debug_struct("Api")
                .field("status", status)
                .field("message", &"<redacted>")
                .finish(),
        }
    }
}

// ── Types ──

#[derive(Debug, Deserialize, Serialize, Clone)]
pub(crate) struct ToolDefinition {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) qualified_name: Option<String>,
    #[serde(default)]
    pub(crate) fully_qualified_name: Option<String>,
    #[serde(default)]
    pub(crate) description: Option<String>,
    #[serde(default)]
    pub(crate) toolkit: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) requirements: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) input: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) output: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct ToolsListResponse {
    #[serde(default)]
    pub(crate) items: Vec<ToolDefinition>,
    #[serde(default)]
    pub(crate) total_count: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub(crate) struct AuthorizationResponse {
    #[serde(default)]
    pub(crate) id: Option<String>,
    #[serde(default)]
    pub(crate) status: Option<String>,
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) scopes: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) user_id: Option<String>,
    #[serde(default)]
    pub(crate) context: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct ExecuteToolResponse {
    #[serde(default)]
    pub(crate) id: Option<String>,
    #[serde(default)]
    pub(crate) status: Option<String>,
    #[serde(default)]
    pub(crate) success: Option<bool>,
    #[serde(default)]
    pub(crate) output: Option<serde_json::Value>,
    #[serde(default)]
    pub(crate) duration: Option<f64>,
    #[serde(default)]
    pub(crate) invocation_id: Option<String>,
}

// ── Request Bodies ──

#[derive(Debug, Serialize)]
struct AuthorizeToolRequest {
    tool_name: String,
    user_id: String,
}

#[derive(Debug, Serialize)]
struct ExecuteToolRequest {
    tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<serde_json::Value>,
}

// ── Validation ──

pub(crate) fn validate_tool_name(name: &str) -> Result<(), crate::error::AppError> {
    if name.trim().is_empty() {
        return Err(crate::error::AppError::Validation(
            "Tool name must not be empty".into(),
        ));
    }
    if name.len() > MAX_TOOL_NAME_LENGTH {
        return Err(crate::error::AppError::Validation(format!(
            "Tool name exceeds maximum length of {MAX_TOOL_NAME_LENGTH} characters"
        )));
    }
    // Reject path traversal and URL-unsafe characters.
    // Arcade tool names are dotted identifiers like "Google.ListEmails".
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(crate::error::AppError::Validation(
            "Tool name contains invalid characters".into(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_user_id(id: &str) -> Result<(), crate::error::AppError> {
    if id.trim().is_empty() {
        return Err(crate::error::AppError::Validation(
            "User ID must not be empty".into(),
        ));
    }
    if id.len() > MAX_USER_ID_LENGTH {
        return Err(crate::error::AppError::Validation(format!(
            "User ID exceeds maximum length of {MAX_USER_ID_LENGTH} characters"
        )));
    }
    Ok(())
}

// ── Client ──

#[derive(Clone)]
pub(crate) struct ArcadeClient {
    http: Client,
    api_key: Zeroizing<String>,
    base_url: String,
    user_id: String,
}

impl std::fmt::Debug for ArcadeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ArcadeClient")
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .field("user_id", &self.user_id)
            .finish()
    }
}

impl ArcadeClient {
    pub(crate) fn new(
        api_key: String,
        user_id: String,
        base_url: Option<String>,
    ) -> Result<Self, ArcadeError> {
        let http = Client::builder()
            .user_agent("nosis/0.1.0")
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(ArcadeError::HttpClient)?;

        Ok(Self {
            http,
            api_key: Zeroizing::new(api_key),
            base_url: base_url.unwrap_or_else(|| ARCADE_BASE_URL.to_string()),
            user_id,
        })
    }

    #[allow(dead_code)]
    pub(crate) fn user_id(&self) -> &str {
        &self.user_id
    }

    pub(crate) async fn list_tools(
        &self,
        toolkit: Option<&str>,
        limit: Option<u32>,
    ) -> Result<ToolsListResponse, ArcadeError> {
        let mut url = format!("{}/v1/tools", self.base_url);
        let mut sep = '?';

        if let Some(tk) = toolkit {
            let _ = write!(url, "{sep}toolkit={}", percent_encode(tk));
            sep = '&';
        }
        if let Some(l) = limit {
            let _ = write!(url, "{sep}limit={}", l.clamp(1, 100));
        }

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&*self.api_key)
            .send()
            .await
            .map_err(ArcadeError::Request)?;

        self.handle_response(resp).await
    }

    #[allow(dead_code)]
    pub(crate) async fn get_tool(&self, name: &str) -> Result<ToolDefinition, ArcadeError> {
        let encoded_name = percent_encode(name);
        let url = format!("{}/v1/tools/{encoded_name}", self.base_url);

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&*self.api_key)
            .send()
            .await
            .map_err(ArcadeError::Request)?;

        self.handle_response(resp).await
    }

    pub(crate) async fn authorize_tool(
        &self,
        tool_name: &str,
    ) -> Result<AuthorizationResponse, ArcadeError> {
        let url = format!("{}/v1/tools/authorize", self.base_url);

        let body = AuthorizeToolRequest {
            tool_name: tool_name.to_string(),
            user_id: self.user_id.clone(),
        };

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&*self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(ArcadeError::Request)?;

        self.handle_response(resp).await
    }

    pub(crate) async fn check_auth_status(
        &self,
        authorization_id: &str,
        wait: Option<u32>,
    ) -> Result<AuthorizationResponse, ArcadeError> {
        let encoded_id = percent_encode(authorization_id);
        let mut url = format!("{}/v1/auth/status?id={encoded_id}", self.base_url);
        if let Some(w) = wait {
            url.push_str(&format!("&wait={w}"));
        }

        let resp = self
            .http
            .get(&url)
            .bearer_auth(&*self.api_key)
            .send()
            .await
            .map_err(ArcadeError::Request)?;

        self.handle_response(resp).await
    }

    pub(crate) async fn execute_tool(
        &self,
        tool_name: &str,
        input: Option<serde_json::Value>,
    ) -> Result<ExecuteToolResponse, ArcadeError> {
        let url = format!("{}/v1/tools/execute", self.base_url);

        let body = ExecuteToolRequest {
            tool_name: tool_name.to_string(),
            user_id: Some(self.user_id.clone()),
            input,
        };

        let resp = self
            .http
            .post(&url)
            .bearer_auth(&*self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(ArcadeError::Request)?;

        self.handle_response(resp).await
    }

    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> Result<T, ArcadeError> {
        let status = resp.status();
        if status.is_success() {
            return resp.json::<T>().await.map_err(ArcadeError::Deserialize);
        }

        let body =
            truncate_to_char_boundary(resp.text().await.unwrap_or_default(), MAX_ERROR_BODY);
        Err(ArcadeError::Api {
            status: status.as_u16(),
            message: body,
        })
    }
}
