use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

const MIN_WINDOW_WIDTH: u32 = 800;
const MIN_WINDOW_HEIGHT: u32 = 600;
const WINDOW_SCREEN_MARGIN: i32 = 24;
const TOP_EDGE_THRESHOLD: i32 = 8;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowPlacement {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitor_name: Option<String>,
    scale_factor: Option<f64>,
}

#[derive(Clone, Copy)]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn window_placement_path() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|c| c.join("void").join("window-state.json"))
}

fn read_window_placement() -> Option<WindowPlacement> {
    let path = window_placement_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_window_placement(placement: &WindowPlacement) {
    let Some(path) = window_placement_path() else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(content) = serde_json::to_string_pretty(placement) {
        let _ = std::fs::write(path, content);
    }
}

fn clamp_i32(value: i32, min: i32, max: i32) -> i32 {
    if max < min {
        min
    } else {
        value.clamp(min, max)
    }
}

fn clamp_u32(value: u32, min: u32, max: u32) -> u32 {
    if max < min {
        min
    } else {
        value.clamp(min, max)
    }
}

fn bounds_center(bounds: WindowBounds) -> (i32, i32) {
    (
        bounds.x + (bounds.width / 2) as i32,
        bounds.y + (bounds.height / 2) as i32,
    )
}

fn monitor_contains_point(monitor: &tauri::Monitor, x: i32, y: i32) -> bool {
    let area = monitor.work_area();
    x >= area.position.x
        && x <= area.position.x + area.size.width as i32
        && y >= area.position.y
        && y <= area.position.y + area.size.height as i32
}

fn monitor_overlaps_bounds(monitor: &tauri::Monitor, bounds: WindowBounds) -> bool {
    let area = monitor.work_area();
    bounds.x < area.position.x + area.size.width as i32
        && bounds.x + bounds.width as i32 > area.position.x
        && bounds.y < area.position.y + area.size.height as i32
        && bounds.y + bounds.height as i32 > area.position.y
}

fn find_monitor_for_bounds<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    bounds: WindowBounds,
    saved_monitor_name: Option<&str>,
) -> Option<tauri::Monitor> {
    let monitors = window.available_monitors().ok()?;
    let (center_x, center_y) = bounds_center(bounds);

    monitors
        .iter()
        .find(|monitor| monitor_contains_point(monitor, center_x, center_y))
        .cloned()
        .or_else(|| {
            monitors
                .iter()
                .find(|monitor| monitor_overlaps_bounds(monitor, bounds))
                .cloned()
        })
        .or_else(|| {
            saved_monitor_name.and_then(|name| {
                monitors
                    .iter()
                    .find(|monitor| {
                        monitor
                            .name()
                            .is_some_and(|monitor_name| monitor_name == name)
                    })
                    .cloned()
            })
        })
}

fn fallback_monitor<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Option<tauri::Monitor> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| window.available_monitors().ok()?.into_iter().next())
}

fn adjust_bounds_for_monitor_scale(
    placement: &WindowPlacement,
    monitor: &tauri::Monitor,
) -> WindowBounds {
    let bounds = WindowBounds {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
    };

    let Some(saved_scale_factor) = placement.scale_factor else {
        return bounds;
    };

    if saved_scale_factor <= 0.0 {
        return bounds;
    }

    let scale = monitor.scale_factor() / saved_scale_factor;
    if (scale - 1.0).abs() < 0.01 {
        return bounds;
    }

    let width = (bounds.width as f64 * scale).round().max(1.0) as u32;
    let height = (bounds.height as f64 * scale).round().max(1.0) as u32;
    let (center_x, center_y) = bounds_center(bounds);

    WindowBounds {
        x: center_x - (width / 2) as i32,
        y: center_y - (height / 2) as i32,
        width,
        height,
    }
}

fn clamp_bounds_to_monitor(bounds: WindowBounds, monitor: &tauri::Monitor) -> WindowBounds {
    let area = monitor.work_area();
    let margin = WINDOW_SCREEN_MARGIN.max(0) as u32;
    let max_width = area
        .size
        .width
        .saturating_sub(margin.saturating_mul(2))
        .max(MIN_WINDOW_WIDTH);
    let max_height = area
        .size
        .height
        .saturating_sub(margin.saturating_mul(2))
        .max(MIN_WINDOW_HEIGHT);
    let width = clamp_u32(bounds.width, MIN_WINDOW_WIDTH, max_width);
    let height = clamp_u32(bounds.height, MIN_WINDOW_HEIGHT, max_height);

    WindowBounds {
        width,
        height,
        x: clamp_i32(
            bounds.x,
            area.position.x + WINDOW_SCREEN_MARGIN,
            area.position.x + area.size.width as i32 - width as i32 - WINDOW_SCREEN_MARGIN,
        ),
        y: clamp_i32(
            bounds.y,
            area.position.y + WINDOW_SCREEN_MARGIN,
            area.position.y + area.size.height as i32 - height as i32 - WINDOW_SCREEN_MARGIN,
        ),
    }
}

fn center_bounds_in_monitor<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
    monitor: &tauri::Monitor,
) -> Option<WindowBounds> {
    let size = window.outer_size().ok()?;
    let area = monitor.work_area();
    let bounds = WindowBounds {
        width: size.width,
        height: size.height,
        x: area.position.x + (area.size.width as i32 - size.width as i32) / 2,
        y: area.position.y + (area.size.height as i32 - size.height as i32) / 2,
    };

    Some(clamp_bounds_to_monitor(bounds, monitor))
}

fn apply_window_bounds<R: tauri::Runtime>(window: &WebviewWindow<R>, bounds: WindowBounds) {
    let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
    let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
}

pub fn restore_or_center_main_window<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    let Some(placement) = read_window_placement() else {
        if let Some(monitor) = fallback_monitor(window) {
            if let Some(bounds) = center_bounds_in_monitor(window, &monitor) {
                apply_window_bounds(window, bounds);
            }
        } else {
            let _ = window.center();
        }
        return;
    };

    let saved_bounds = WindowBounds {
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
    };

    let monitor = find_monitor_for_bounds(window, saved_bounds, placement.monitor_name.as_deref())
        .or_else(|| fallback_monitor(window));

    let Some(monitor) = monitor else {
        let _ = window.center();
        return;
    };

    if saved_bounds.y <= monitor.work_area().position.y + TOP_EDGE_THRESHOLD {
        if let Some(bounds) = center_bounds_in_monitor(window, &monitor) {
            apply_window_bounds(window, bounds);
        }
        return;
    }

    let bounds = clamp_bounds_to_monitor(
        adjust_bounds_for_monitor_scale(&placement, &monitor),
        &monitor,
    );
    apply_window_bounds(window, bounds);
}

pub fn save_window_placement<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let monitor = window.current_monitor().ok().flatten();

    write_window_placement(&WindowPlacement {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        monitor_name: monitor.as_ref().and_then(|m| m.name().cloned()),
        scale_factor: monitor.as_ref().map(|m| m.scale_factor()),
    });
}
