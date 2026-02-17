use serde::Serialize;

/// Structured error type for all Tauri IPC commands.
///
/// Variants carry user-safe messages; internal details from sqlx are logged
/// via `eprintln!` in the `Serialize` impl and never reach the frontend.
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
}

/// Serialize only the display message so the frontend never sees internal details.
/// Tauri requires the error type to implement `Serialize` for IPC transport.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // For Database errors, log the real error and return a sanitized message
        if let AppError::Database(ref inner) = self {
            eprintln!("Database error: {:?}", inner);
        }
        serializer.serialize_str(&self.to_string())
    }
}
