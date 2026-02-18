use reqwest::Client;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

const DOCUMENTS_URL: &str = "https://api.supermemory.ai/v3/documents";
const SEARCH_URL: &str = "https://api.supermemory.ai/v4/search";
const MAX_ERROR_BODY: usize = 1024;
/// Maximum response body size (5 MiB). Prevents OOM from oversized API responses.
const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;

/// Truncate a string to at most `max_len` bytes on a valid char boundary.
fn truncate_to_char_boundary(mut s: String, max_len: usize) -> String {
    let safe_len = (0..=max_len.min(s.len()))
        .rev()
        .find(|&i| s.is_char_boundary(i))
        .unwrap_or(0);
    s.truncate(safe_len);
    s
}

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
    #[error("Request failed")]
    Request(reqwest::Error),

    #[error("Failed to read response body")]
    ReadBody(reqwest::Error),

    #[error("Failed to parse response")]
    Parse(serde_json::Error),

    #[error("API error (HTTP {status})")]
    Api { status: u16, message: String },
}

/// Redacted `Debug` to avoid leaking tokens or response bodies.
impl std::fmt::Debug for SupermemoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Request(_) => f.debug_tuple("Request").field(&"<redacted>").finish(),
            Self::ReadBody(_) => f.debug_tuple("ReadBody").field(&"<redacted>").finish(),
            Self::Parse(_) => f.debug_tuple("Parse").field(&"<redacted>").finish(),
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

impl Drop for SupermemoryClient {
    fn drop(&mut self) {
        self.api_key.zeroize();
    }
}

impl SupermemoryClient {
    pub(crate) fn new(http: Client, api_key: String) -> Self {
        Self { http, api_key }
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
            // Check Content-Length header *before* buffering to avoid OOM on huge responses.
            if let Some(len) = resp.content_length() {
                if len > MAX_RESPONSE_BYTES as u64 {
                    return Err(SupermemoryError::Api {
                        status: status.as_u16(),
                        message: format!("Response Content-Length too large ({len} bytes)"),
                    });
                }
            }
            let bytes = resp.bytes().await.map_err(SupermemoryError::ReadBody)?;
            // Still check actual size: Content-Length can be absent or lie (chunked encoding).
            if bytes.len() > MAX_RESPONSE_BYTES {
                return Err(SupermemoryError::Api {
                    status: status.as_u16(),
                    message: format!("Response body too large ({} bytes)", bytes.len()),
                });
            }
            return serde_json::from_slice::<T>(&bytes).map_err(SupermemoryError::Parse);
        }

        let body = truncate_to_char_boundary(resp.text().await.unwrap_or_default(), MAX_ERROR_BODY);
        Err(SupermemoryError::Api {
            status: status.as_u16(),
            message: body,
        })
    }
}
