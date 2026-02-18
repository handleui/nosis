use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{LogicalPosition, LogicalSize, WebviewWindow};
use tracing::error;

const SIDEBAR_WIDTH: f64 = 400.0;
const CENTER_WIDTH: f64 = 720.0;
const CENTER_HEIGHT: f64 = 560.0;
const COMPACT_WIDTH: f64 = 400.0;
const COMPACT_HEIGHT: f64 = 500.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum PlacementMode {
    #[default]
    Center,
    Compact,
    SidebarLeft,
    SidebarRight,
}

pub struct PlacementState {
    pub mode: Mutex<PlacementMode>,
    pub state_file: PathBuf,
}

fn placement_err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Placement(e.to_string())
}

struct ScreenGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn get_screen_geometry(window: &WebviewWindow) -> Result<ScreenGeometry, AppError> {
    let monitor = window
        .current_monitor()
        .map_err(placement_err)?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| AppError::Placement("No monitor found".into()))?;

    let scale = monitor.scale_factor();
    // Use the work area rather than the full monitor size so that
    // system chrome (macOS menu bar, Windows taskbar, etc.) is
    // automatically excluded without any hardcoded per-platform offsets.
    let work_area = monitor.work_area();

    Ok(ScreenGeometry {
        x: work_area.position.x as f64 / scale,
        y: work_area.position.y as f64 / scale,
        width: work_area.size.width as f64 / scale,
        height: work_area.size.height as f64 / scale,
    })
}

fn apply_window_props(
    window: &WebviewWindow,
    decorations: bool,
    resizable: bool,
    always_on_top: bool,
    size: LogicalSize<f64>,
    position: LogicalPosition<f64>,
) -> Result<(), AppError> {
    window.set_decorations(decorations).map_err(placement_err)?;
    window.set_resizable(resizable).map_err(placement_err)?;
    window.set_always_on_top(always_on_top).map_err(placement_err)?;
    window.set_size(size).map_err(placement_err)?;
    window.set_position(position).map_err(placement_err)?;
    Ok(())
}

fn centered_position(screen: &ScreenGeometry, w: f64, h: f64) -> LogicalPosition<f64> {
    LogicalPosition::new(
        screen.x + (screen.width - w) / 2.0,
        screen.y + (screen.height - h) / 2.0,
    )
}

pub fn apply_placement(window: &WebviewWindow, mode: PlacementMode) -> Result<(), AppError> {
    let screen = get_screen_geometry(window)?;

    match mode {
        PlacementMode::Center => apply_window_props(
            window, true, true, false,
            LogicalSize::new(CENTER_WIDTH, CENTER_HEIGHT),
            centered_position(&screen, CENTER_WIDTH, CENTER_HEIGHT),
        ),
        PlacementMode::Compact => apply_window_props(
            window, true, true, true,
            LogicalSize::new(COMPACT_WIDTH, COMPACT_HEIGHT),
            centered_position(&screen, COMPACT_WIDTH, COMPACT_HEIGHT),
        ),
        PlacementMode::SidebarLeft | PlacementMode::SidebarRight => {
            let x = if mode == PlacementMode::SidebarLeft {
                screen.x
            } else {
                screen.x + screen.width - SIDEBAR_WIDTH
            };
            // screen.x/y/width/height are already derived from the monitor's
            // work area, so they exclude the menu bar / taskbar on every
            // platform.  No additional offset is required.
            apply_window_props(
                window, false, false, true,
                LogicalSize::new(SIDEBAR_WIDTH, screen.height),
                LogicalPosition::new(x, screen.y),
            )
        }
    }
}

pub fn load_state(path: &Path) -> PlacementMode {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<PlacementMode>(&s).ok())
        .unwrap_or_default()
}

fn atomic_write(path: &Path, content: &str) -> Result<(), AppError> {
    let dir = path.parent()
        .ok_or_else(|| AppError::Placement("State file path has no parent directory".into()))?;
    let temp_path = dir.join(
        format!(".{}.tmp", path.file_name().unwrap_or_default().to_string_lossy()),
    );
    std::fs::write(&temp_path, content)
        .map_err(|e| AppError::Placement(format!("Failed to write temp state file: {}", e)))?;
    std::fs::rename(&temp_path, path)
        .map_err(|e| AppError::Placement(format!("Failed to finalize state file: {}", e)))
}

pub fn save_state(state: &PlacementState) -> Result<(), AppError> {
    let mode = state.mode.lock()
        .map_err(|e| AppError::Placement(format!("Failed to lock placement state: {}", e)))?;
    let json = serde_json::to_string(&*mode).map_err(placement_err)?;
    atomic_write(&state.state_file, &json)
}

pub fn save_state_async(state: &PlacementState) {
    let Ok(guard) = state.mode.lock() else { return };
    let mode = *guard;
    drop(guard);

    let state_file = state.state_file.clone();
    // Use tokio's blocking thread pool instead of spawning a new OS thread per save.
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(json) = serde_json::to_string(&mode) else {
            error!("Failed to serialize placement state");
            return;
        };
        if let Err(e) = atomic_write(&state_file, &json) {
            error!(error = %e, "Failed to save placement state");
        }
    });
}
