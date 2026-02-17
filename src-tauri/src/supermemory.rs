use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const DOCUMENTS_URL: &str = "https://api.supermemory.ai/v3/documents";
const SEARCH_URL: &str = "https://api.supermemory.ai/v4/search";
const MAX_ERROR_BODY: usize = 1024;

/// Truncate a string to at most `max_len` bytes on a valid char boundary.
fn truncate_to_char_boundary(mut s: String, max_len: usize) -> String {
    let safe_len = (0..=max_len.min(s.len()))
        .rev()
        .find(|&i| s.is_char_boundary(i))
        .unwrap_or(0);
    s.truncate(safe_len);
    s
}

#[derive(Clone)]
pub(crate) struct SupermemoryClient {
    http: Client,
    api_key: String,
}

impl std::fmt::Debug for SupermemoryClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupermemoryClient")
            .field("http", &"<client>")
            .field("api_key", &"<redacted>")
            .finish()
    }
}

/// Errors from the Supermemory API client.
///
/// Display and Debug omit raw bodies and inner reqwest errors to prevent
/// leaking sensitive data (Bearer tokens, headers) through logs or IPC.
#[derive(thiserror::Error)]
pub(crate) enum SupermemoryError {
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
impl std::fmt::Debug for SupermemoryError {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddDocumentRequest {
    pub(crate) content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) custom_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) container_tag: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct AddDocumentResponse {
    pub(crate) id: String,
    pub(crate) status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRequest {
    pub(crate) q: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) container_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) threshold: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
pub(crate) struct SearchResponse {
    pub(crate) results: Vec<SearchResult>,
    pub(crate) total: u32,
    pub(crate) timing: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchResult {
    pub(crate) document_id: String,
    pub(crate) chunks: Vec<SearchChunk>,
    pub(crate) score: f64,
    pub(crate) title: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchChunk {
    pub(crate) content: String,
    pub(crate) is_relevant: bool,
    pub(crate) score: f64,
}

impl SupermemoryClient {
    pub(crate) fn new(api_key: String) -> Result<Self, SupermemoryError> {
        let http = Client::builder()
            .user_agent("muppet/0.1.0")
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(SupermemoryError::HttpClient)?;

        Ok(Self { http, api_key })
    }

    pub(crate) async fn add_document(
        &self,
        req: &AddDocumentRequest,
    ) -> Result<AddDocumentResponse, SupermemoryError> {
        let resp = self
            .http
            .post(DOCUMENTS_URL)
            .bearer_auth(&self.api_key)
            .json(req)
            .send()
            .await
            .map_err(SupermemoryError::Request)?;

        self.handle_response(resp).await
    }

    pub(crate) async fn search(
        &self,
        req: &SearchRequest,
    ) -> Result<SearchResponse, SupermemoryError> {
        let resp = self
            .http
            .post(SEARCH_URL)
            .bearer_auth(&self.api_key)
            .json(req)
            .send()
            .await
            .map_err(SupermemoryError::Request)?;

        self.handle_response(resp).await
    }

    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
    ) -> Result<T, SupermemoryError> {
        let status = resp.status();
        if status.is_success() {
            return resp.json::<T>().await.map_err(SupermemoryError::Deserialize);
        }

        let body = truncate_to_char_boundary(resp.text().await.unwrap_or_default(), MAX_ERROR_BODY);
        Err(SupermemoryError::Api {
            status: status.as_u16(),
            message: body,
        })
    }
}
