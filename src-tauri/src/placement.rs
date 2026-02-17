use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{LogicalPosition, LogicalSize, WebviewWindow};

const SIDEBAR_WIDTH: f64 = 400.0;
const CENTER_WIDTH: f64 = 720.0;
const CENTER_HEIGHT: f64 = 560.0;
const COMPACT_WIDTH: f64 = 400.0;
const COMPACT_HEIGHT: f64 = 500.0;
const MENU_BAR_HEIGHT: f64 = 25.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlacementMode {
    Center,
    Compact,
    SidebarLeft,
    SidebarRight,
}

impl Default for PlacementMode {
    fn default() -> Self {
        Self::Center
    }
}

pub struct PlacementState {
    pub mode: Mutex<PlacementMode>,
    pub state_file: PathBuf,
}

fn str_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

struct ScreenGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn get_screen_geometry(window: &WebviewWindow) -> Result<ScreenGeometry, String> {
    let monitor = window
        .current_monitor()
        .map_err(str_err)?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("No monitor found")?;

    let scale = monitor.scale_factor();
    let size = monitor.size();
    let pos = monitor.position();

    Ok(ScreenGeometry {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    })
}

fn apply_window_props(
    window: &WebviewWindow,
    decorations: bool,
    resizable: bool,
    always_on_top: bool,
    size: LogicalSize<f64>,
    position: LogicalPosition<f64>,
) -> Result<(), String> {
    window.set_decorations(decorations).map_err(str_err)?;
    window.set_resizable(resizable).map_err(str_err)?;
    window.set_always_on_top(always_on_top).map_err(str_err)?;
    window.set_size(size).map_err(str_err)?;
    window.set_position(position).map_err(str_err)?;
    Ok(())
}

fn centered_position(screen: &ScreenGeometry, w: f64, h: f64) -> LogicalPosition<f64> {
    LogicalPosition::new(
        screen.x + (screen.width - w) / 2.0,
        screen.y + (screen.height - h) / 2.0,
    )
}

pub fn apply_placement(window: &WebviewWindow, mode: PlacementMode) -> Result<(), String> {
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
            let h = screen.height - MENU_BAR_HEIGHT;
            apply_window_props(
                window, false, false, true,
                LogicalSize::new(SIDEBAR_WIDTH, h),
                LogicalPosition::new(x, screen.y + MENU_BAR_HEIGHT),
            )
        }
    }
}

pub fn load_state(path: &Path) -> PlacementMode {
    let is_symlink = std::fs::symlink_metadata(path)
        .map(|m| m.is_symlink())
        .unwrap_or(false);
    if is_symlink {
        eprintln!("Refusing to load state from symlink: {:?}", path);
        return PlacementMode::default();
    }

    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<PlacementMode>(&s).ok())
        .unwrap_or_default()
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let temp_path = format!("{}.tmp", path.display());
    std::fs::write(&temp_path, content)
        .map_err(|e| format!("Failed to write temp state file: {}", e))?;
    std::fs::rename(&temp_path, path)
        .map_err(|e| format!("Failed to finalize state file: {}", e))
}

pub fn save_state(state: &PlacementState) -> Result<(), String> {
    let mode = state.mode.lock()
        .map_err(|e| format!("Failed to lock placement state: {}", e))?;
    let json = serde_json::to_string(&*mode).map_err(str_err)?;
    atomic_write(&state.state_file, &json)
}

pub fn save_state_async(state: &PlacementState) {
    let Ok(guard) = state.mode.lock() else { return };
    let mode = *guard;
    drop(guard);

    let state_file = state.state_file.clone();
    std::thread::spawn(move || {
        let Ok(json) = serde_json::to_string(&mode) else {
            eprintln!("Failed to serialize placement state");
            return;
        };
        if let Err(e) = atomic_write(&state_file, &json) {
            eprintln!("{e}");
        }
    });
}
