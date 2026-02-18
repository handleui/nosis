use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{error, warn};

use crate::error::{self, AppError};

const EXA_SEARCH_URL: &str = "https://api.exa.ai/search";
const MAX_QUERY_LENGTH: usize = 2_000;
const MAX_NUM_RESULTS: u32 = 100;
const ERROR_BODY_MAX_LEN: usize = 200;
/// Maximum response body size (5 MiB). Prevents OOM from oversized API responses.
const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<SearchType>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<SearchCategory>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_results: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub contents: Option<ContentOptions>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum SearchType {
    Neural,
    Fast,
    Auto,
    Deep,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum SearchCategory {
    #[serde(rename = "company")]
    Company,
    #[serde(rename = "research paper")]
    ResearchPaper,
    #[serde(rename = "news")]
    News,
    #[serde(rename = "pdf")]
    Pdf,
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "tweet")]
    Tweet,
    #[serde(rename = "personal site")]
    PersonalSite,
    #[serde(rename = "financial report")]
    FinancialReport,
    #[serde(rename = "people")]
    People,
}

#[derive(Debug, Serialize)]
pub struct ContentOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub request_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: Option<String>,
    pub url: String,
    pub published_date: Option<String>,
    pub author: Option<String>,
    pub text: Option<String>,
    pub highlights: Option<Vec<String>>,
    pub score: Option<f64>,
    pub id: String,
}

pub struct ExaClient<'a> {
    http: &'a Client,
    api_key: &'a str,
}

impl<'a> ExaClient<'a> {
    pub fn new(http: &'a Client, api_key: &'a str) -> Self {
        Self { http, api_key }
    }

    pub async fn search(&self, request: &SearchRequest) -> Result<SearchResponse, AppError> {
        let response = self.send_request(request).await?;
        let status = response.status();

        if !status.is_success() {
            return Err(Self::classify_error_status(response).await);
        }

        Self::parse_response(response).await
    }

    async fn send_request(
        &self,
        request: &SearchRequest,
    ) -> Result<reqwest::Response, AppError> {
        self.http
            .post(EXA_SEARCH_URL)
            .header("x-api-key", self.api_key)
            .json(request)
            .send()
            .await
            .map_err(|e| {
                error::log_transport_error("Exa", &e);
                AppError::ExaRequest
            })
    }

    async fn classify_error_status(response: reqwest::Response) -> AppError {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let safe_body = error::sanitize_error_body(&body, ERROR_BODY_MAX_LEN);
        warn!(status = %status, body = %safe_body, "Exa API error");

        match status.as_u16() {
            401 => AppError::ExaAuth,
            429 => AppError::ExaRateLimit,
            _ => AppError::ExaRequest,
        }
    }

    async fn parse_response(response: reqwest::Response) -> Result<SearchResponse, AppError> {
        if let Some(len) = response.content_length() {
            if len > MAX_RESPONSE_BYTES as u64 {
                error!(size = len, "Exa: response Content-Length exceeds size limit");
                return Err(AppError::ExaRequest);
            }
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| {
                error!("Exa: failed to read response body");
                AppError::ExaRequest
            })?;
        if bytes.len() > MAX_RESPONSE_BYTES {
            error!(size = bytes.len(), "Exa: response body exceeds size limit");
            return Err(AppError::ExaRequest);
        }
        serde_json::from_slice::<SearchResponse>(&bytes).map_err(|_| {
            error!("Exa: failed to deserialize search response");
            AppError::ExaRequest
        })
    }
}

pub fn validate_search_request(request: &SearchRequest) -> Result<(), AppError> {
    if request.query.trim().is_empty() {
        return Err(AppError::Validation(
            "Search query must not be empty".into(),
        ));
    }
    if request.query.len() > MAX_QUERY_LENGTH {
        return Err(AppError::Validation(format!(
            "Search query exceeds maximum length of {} characters",
            MAX_QUERY_LENGTH
        )));
    }
    if let Some(n) = request.num_results {
        if n == 0 || n > MAX_NUM_RESULTS {
            return Err(AppError::Validation(format!(
                "numResults must be between 1 and {}",
                MAX_NUM_RESULTS
            )));
        }
    }
    Ok(())
}
