use serde::Serialize;
use tracing::error;

/// Structured error type for all Tauri IPC commands.
///
/// Variants carry user-safe messages; internal details from sqlx are logged
/// via `tracing::error!` in the `Serialize` impl and never reach the frontend.
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

    #[error("Memory service unavailable")]
    SupermemoryNotConfigured,

    #[error("Memory service error")]
    Supermemory(#[from] crate::supermemory::SupermemoryError),

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

/// Serialize only the display message so the frontend never sees internal details.
/// Tauri requires the error type to implement `Serialize` for IPC transport.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            AppError::Database(ref inner) => error!(error = ?inner, "Database error"),
            AppError::Supermemory(ref inner) => error!(error = ?inner, "Supermemory error"),
            AppError::Internal(ref msg) => error!(msg = %msg, "Internal error"),
            AppError::Placement(ref msg) => error!(msg = %msg, "Placement error"),
            _ => {}
        }
        serializer.serialize_str(&self.to_string())
    }
}
