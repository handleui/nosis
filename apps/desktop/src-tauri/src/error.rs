use serde::Serialize;
use tracing::error;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database not initialized")]
    DbNotInitialized,

    #[error("Operation failed")]
    Database(#[from] sqlx::Error),

    #[error("Invalid ID format")]
    InvalidId,

    #[error("{0} not found")]
    NotFound(&'static str),

    #[error("{0}")]
    Validation(String),

    #[error("Internal error")]
    Internal(String),

    #[error("API key not configured")]
    ApiKeyNotConfigured,

    #[error("Secret storage error")]
    SecretStore(String),

    #[error("Window placement failed")]
    Placement(String),

    #[error("Image generation request failed")]
    FalRequest,

    #[error("Invalid API key")]
    FalAuth,

    #[error("Invalid generation parameters")]
    FalValidation,

    #[error("Rate limit exceeded, please try again later")]
    FalRateLimit,

}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let message = match self {
            AppError::Database(ref inner) => {
                error!(error = ?inner, "database error");
                "A database error occurred"
            }
            AppError::Internal(ref msg) => {
                error!(error = %msg, "internal error");
                "An internal error occurred"
            }
            AppError::SecretStore(ref msg) => {
                error!(error = %msg, "secret store error");
                "An internal error occurred"
            }
            AppError::Placement(ref msg) => {
                error!(msg = %msg, "placement error");
                return serializer.serialize_str(&self.to_string());
            }
            _ => return serializer.serialize_str(&self.to_string()),
        };
        serializer.serialize_str(message)
    }
}

pub fn log_transport_error(service: &str, e: &reqwest::Error) {
    if e.is_timeout() {
        error!(service = %service, "HTTP request timed out");
    } else if e.is_connect() {
        error!(service = %service, "HTTP connection failed");
    } else if let Some(status) = e.status() {
        error!(service = %service, status = %status, "HTTP request failed");
    } else {
        error!(service = %service, "HTTP request failed (no status)");
    }
}

/// Sanitize an API error body for safe logging.
///
/// Truncates to `max_len`, replaces control characters with `?`, and redacts
/// long alphanumeric tokens (40+ chars) that may be API keys or bearer tokens.
pub fn sanitize_error_body(body: &str, max_len: usize) -> String {
    let sanitized: String = body
        .chars()
        .take(max_len)
        .map(|c| if c.is_control() { '?' } else { c })
        .collect();
    redact_long_tokens(&sanitized)
}

fn redact_long_tokens(s: &str) -> String {
    const MIN_KEY_LEN: usize = 40;
    let mut result = String::with_capacity(s.len());
    let mut token_start: Option<usize> = None;

    for (i, c) in s.char_indices() {
        let is_key_char = c.is_ascii_alphanumeric() || c == '-' || c == '_';
        match (is_key_char, token_start) {
            (true, None) => {
                token_start = Some(i);
            }
            (true, Some(_)) => {}
            (false, Some(start)) => {
                if i - start >= MIN_KEY_LEN {
                    result.push_str("[REDACTED]");
                } else {
                    result.push_str(&s[start..i]);
                }
                result.push(c);
                token_start = None;
            }
            (false, None) => {
                result.push(c);
            }
        }
    }

    if let Some(start) = token_start {
        if s.len() - start >= MIN_KEY_LEN {
            result.push_str("[REDACTED]");
        } else {
            result.push_str(&s[start..]);
        }
    }

    result
}
