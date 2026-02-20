use std::time::Duration;

use reqwest::header::AUTHORIZATION;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{error, warn};

use crate::error::{self, AppError};

const FAL_RUN_BASE_URL: &str = "https://fal.run";
const MAX_PROMPT_LENGTH: usize = 10_000;
const MAX_INFERENCE_STEPS: u32 = 50;
const ERROR_BODY_MAX_LEN: usize = 200;
const IMAGE_GENERATION_TIMEOUT: Duration = Duration::from_secs(180);

#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FalModel {
    #[serde(rename = "fal-ai/flux/schnell")]
    FluxSchnell,
    #[serde(rename = "fal-ai/flux/dev")]
    FluxDev,
    #[serde(rename = "fal-ai/flux-pro/v1.1")]
    FluxPro,
}

impl FalModel {
    pub fn as_path(&self) -> &'static str {
        match self {
            Self::FluxSchnell => "fal-ai/flux/schnell",
            Self::FluxDev => "fal-ai/flux/dev",
            Self::FluxPro => "fal-ai/flux-pro/v1.1",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageSizePreset {
    Square,
    SquareHd,
    #[serde(rename = "portrait_4_3")]
    Portrait4_3,
    #[serde(rename = "portrait_16_9")]
    Portrait16_9,
    #[serde(rename = "landscape_4_3")]
    Landscape4_3,
    #[serde(rename = "landscape_16_9")]
    Landscape16_9,
}

#[derive(Debug, Serialize)]
pub struct ImageGenerationRequest {
    pub prompt: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_size: Option<ImageSizePreset>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_inference_steps: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ImageGenerationResponse {
    #[serde(default)]
    pub images: Vec<GeneratedImage>,
    pub seed: Option<u64>,
    pub timings: Option<Timings>,
    pub has_nsfw_concepts: Option<Vec<bool>>,
    pub prompt: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GeneratedImage {
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Timings {
    pub inference: Option<f64>,
}

pub struct FalClient<'a> {
    http: &'a Client,
    auth_header: String,
}

impl<'a> FalClient<'a> {
    pub fn new(http: &'a Client, api_key: &str) -> Self {
        Self {
            http,
            auth_header: format!("Key {}", api_key),
        }
    }

    pub async fn generate_image(
        &self,
        model: &FalModel,
        request: &ImageGenerationRequest,
    ) -> Result<ImageGenerationResponse, AppError> {
        let url = format!("{}/{}", FAL_RUN_BASE_URL, model.as_path());
        let response = self.send_request(&url, request).await?;
        let status = response.status();

        if !status.is_success() {
            return Err(Self::classify_error_status(response).await);
        }

        Self::parse_response(response).await
    }

    async fn send_request(
        &self,
        url: &str,
        request: &ImageGenerationRequest,
    ) -> Result<reqwest::Response, AppError> {
        self.http
            .post(url)
            .header(AUTHORIZATION, &self.auth_header)
            .timeout(IMAGE_GENERATION_TIMEOUT)
            .json(request)
            .send()
            .await
            .map_err(|e| {
                error::log_transport_error("fal.ai", &e);
                AppError::FalRequest
            })
    }

    async fn classify_error_status(response: reqwest::Response) -> AppError {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let safe_body = error::sanitize_error_body(&body, ERROR_BODY_MAX_LEN);
        warn!(status = %status, body = %safe_body, "fal.ai API error");

        match status.as_u16() {
            401 => AppError::FalAuth,
            422 => AppError::FalValidation,
            429 => AppError::FalRateLimit,
            _ => AppError::FalRequest,
        }
    }

    async fn parse_response(
        response: reqwest::Response,
    ) -> Result<ImageGenerationResponse, AppError> {
        response
            .json::<ImageGenerationResponse>()
            .await
            .map_err(|_| {
                error!("fal.ai: failed to deserialize generation response");
                AppError::FalRequest
            })
    }
}

pub fn validate_generation_request(request: &ImageGenerationRequest) -> Result<(), AppError> {
    if request.prompt.trim().is_empty() {
        return Err(AppError::Validation(
            "Prompt must not be empty".into(),
        ));
    }
    if request.prompt.len() > MAX_PROMPT_LENGTH {
        return Err(AppError::Validation(format!(
            "Prompt exceeds maximum length of {} characters",
            MAX_PROMPT_LENGTH
        )));
    }
    if let Some(steps) = request.num_inference_steps {
        if steps == 0 || steps > MAX_INFERENCE_STEPS {
            return Err(AppError::Validation(format!(
                "num_inference_steps must be between 1 and {}",
                MAX_INFERENCE_STEPS
            )));
        }
    }
    Ok(())
}
