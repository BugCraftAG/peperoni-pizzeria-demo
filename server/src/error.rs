use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Fehler, die als {"error": "..."} beim Browser ankommen
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self { Self(StatusCode::BAD_REQUEST, msg.into()) }
    pub fn unauthorized() -> Self { Self(StatusCode::UNAUTHORIZED, "Bitte zuerst anmelden.".into()) }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error = %e, "Datenbankfehler");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "Interner Fehler – bitte später erneut versuchen.".into())
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
