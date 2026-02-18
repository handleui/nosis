use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::error;

use crate::error::AppError;

const EXA_SEARCH_URL: &str = "https://api.exa.ai/search";
const MAX_QUERY_LENGTH: usize = 2_000;
const MAX_NUM_RESULTS: u32 = 100;

// ── Request Types ──

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

// ── Response Types ──

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

// ── Client ──

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
                log_transport_error(&e);
                AppError::ExaRequest
            })
    }

    async fn classify_error_status(response: reqwest::Response) -> AppError {
        let status = response.status();
        // Truncate body to avoid logging sensitive data the API might echo back.
        let body = response.text().await.unwrap_or_default();
        let safe_body: String = body.chars().take(200).collect();
        error!(status = %status, body = %safe_body, "exa API error");

        match status.as_u16() {
            401 => AppError::ExaAuth,
            429 => AppError::ExaRateLimit,
            _ => AppError::ExaRequest,
        }
    }

    async fn parse_response(response: reqwest::Response) -> Result<SearchResponse, AppError> {
        response.json::<SearchResponse>().await.map_err(|_| {
            error!("failed to deserialize exa search response");
            AppError::ExaRequest
        })
    }
}

/// Log transport-level errors without leaking connection details.
fn log_transport_error(e: &reqwest::Error) {
    if e.is_timeout() {
        error!("exa HTTP error: request timed out");
    } else if e.is_connect() {
        error!("exa HTTP error: connection failed");
    } else {
        error!(
            status = %e.status().map_or("none".to_string(), |s| s.to_string()),
            "exa HTTP error: request failed"
        );
    }
}

// ── Validation ──

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
