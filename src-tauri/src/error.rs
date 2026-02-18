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

    #[error("{0}")]
    Internal(String),

    #[error("API key not configured")]
    ApiKeyNotConfigured,

    #[error("Search request failed")]
    ExaRequest,

    #[error("Invalid API key")]
    ExaAuth,

    #[error("Rate limit exceeded, please try again later")]
    ExaRateLimit,

    #[error("Too many requests, please wait before searching again")]
    RateLimited,

    #[error("Window placement failed")]
    Placement(String),
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
            AppError::Placement(ref msg) => {
                error!(msg = %msg, "placement error");
                return serializer.serialize_str(&self.to_string());
            }
            _ => return serializer.serialize_str(&self.to_string()),
        };
        serializer.serialize_str(message)
    }
}
