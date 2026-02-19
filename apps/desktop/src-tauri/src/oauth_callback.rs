use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
pub struct OAuthCodePayload {
    pub code: String,
    pub state: String,
}

/// Handle returned from `start_callback_server` to allow early shutdown.
///
/// Calling `shutdown()` sets the flag **and** unblocks the `recv_timeout`
/// call so the background thread exits immediately and the port is released.
#[derive(Clone)]
pub struct OAuthSessionHandle {
    shutdown: Arc<AtomicBool>,
    server: Arc<tiny_http::Server>,
}

impl OAuthSessionHandle {
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
        self.server.unblock();
    }
}

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const SUCCESS_HTML: &str = "<html><body><h1>Authorization successful</h1>\
                            <p>You can close this tab and return to Nosis.</p>\
                            </body></html>";

/// Starts a temporary localhost HTTP server on a random port, returning the port
/// and a handle that can be used to shut down the server early. A background
/// thread waits for the OAuth callback and emits the authorization code via the
/// Tauri event system.
pub fn start_callback_server(
    app: tauri::AppHandle,
    timeout_secs: u64,
    expected_state: String,
) -> Result<(u16, OAuthSessionHandle), String> {
    let server = Arc::new(
        tiny_http::Server::http("127.0.0.1:0")
            .map_err(|e| format!("Failed to start OAuth callback server: {e}"))?,
    );

    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "Failed to get server address".to_string())?
        .port();

    let shutdown = Arc::new(AtomicBool::new(false));
    let handle = OAuthSessionHandle {
        shutdown: Arc::clone(&shutdown),
        server: Arc::clone(&server),
    };

    std::thread::spawn(move || {
        run_callback_loop(&server, &app, timeout_secs, &expected_state, &shutdown);
    });

    Ok((port, handle))
}

fn run_callback_loop(
    server: &tiny_http::Server,
    app: &tauri::AppHandle,
    timeout_secs: u64,
    expected_state: &str,
    shutdown: &AtomicBool,
) {
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        if shutdown.load(Ordering::Relaxed) {
            return;
        }

        let request = match server.recv_timeout(POLL_INTERVAL) {
            Err(_) => {
                let _ = app.emit("mcp-oauth-error", "OAuth callback server error");
                return;
            }
            Ok(None) if is_expired(deadline) => {
                let _ = app.emit("mcp-oauth-error", "OAuth callback timed out");
                return;
            }
            Ok(None) => continue,
            Ok(Some(req)) => req,
        };

        if is_expired(deadline) {
            respond_error(request, 408, "Request timeout");
            let _ = app.emit("mcp-oauth-error", "OAuth callback timed out");
            return;
        }

        if !request.url().starts_with("/oauth/callback") {
            respond_error(request, 404, "Not Found");
            continue;
        }

        let url = request.url().to_string();
        match handle_oauth_callback(request, app, &url, expected_state) {
            CallbackResult::Done => return,
            CallbackResult::Continue => continue,
        }
    }
}

enum CallbackResult {
    Done,
    Continue,
}

fn handle_oauth_callback(
    request: tiny_http::Request,
    app: &tauri::AppHandle,
    url: &str,
    expected_state: &str,
) -> CallbackResult {
    let Some((code, state)) = extract_callback_params(url) else {
        respond_error(request, 400, "Bad Request: missing code or state");
        return CallbackResult::Continue;
    };

    if state != expected_state {
        respond_error(request, 400, "Bad Request: state mismatch");
        let _ = app.emit("mcp-oauth-error", "OAuth callback rejected: state mismatch");
        return CallbackResult::Done;
    }

    let response = tiny_http::Response::from_string(SUCCESS_HTML).with_header(
        tiny_http::Header::from_bytes("Content-Type", "text/html").unwrap(),
    );
    let _ = request.respond(response);
    let _ = app.emit("mcp-oauth-code", OAuthCodePayload { code, state });
    CallbackResult::Done
}

fn respond_error(request: tiny_http::Request, status: u16, body: &str) {
    let _ = request.respond(
        tiny_http::Response::from_string(body).with_status_code(status),
    );
}

fn is_expired(deadline: std::time::Instant) -> bool {
    std::time::Instant::now() > deadline
}

fn extract_callback_params(url: &str) -> Option<(String, String)> {
    let query = url.split('?').nth(1)?;
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;

    for param in query.split('&') {
        if let Some((key, value)) = param.split_once('=') {
            match key {
                "code" => code = urlencoding::decode(value).ok().map(|s| s.into_owned()),
                "state" => state = urlencoding::decode(value).ok().map(|s| s.into_owned()),
                _ => {}
            }
        }
    }

    match (code, state) {
        (Some(c), Some(s)) if !c.is_empty() && !s.is_empty() => Some((c, s)),
        _ => None,
    }
}
