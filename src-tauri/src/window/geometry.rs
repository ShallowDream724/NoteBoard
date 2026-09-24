//! Window placement is independent of document sessions and shell visibility.
//! Windows stores the normal (restored) rectangle, never the iconic/minimized size.
#[cfg(not(target_os = "windows"))]
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_window_state::Builder::new()
        .with_state_flags(
            tauri_plugin_window_state::StateFlags::SIZE
                | tauri_plugin_window_state::StateFlags::POSITION
                | tauri_plugin_window_state::StateFlags::MAXIMIZED,
        )
        .with_filter(|label| !label.starts_with("nb-export-"))
        .build()
}

#[cfg(not(target_os = "windows"))]
pub fn restore(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
pub use windows_impl::{plugin, restore};

#[cfg(target_os = "windows")]
mod windows_impl {
    use serde::{Deserialize, Serialize};
    use std::{
        collections::{HashMap, HashSet},
        path::PathBuf,
        sync::Mutex,
    };
    use tauri::{Manager, PhysicalPosition, PhysicalSize, RunEvent, Window, WindowEvent};
    use windows::Win32::{
        Foundation::{HWND, RECT},
        UI::WindowsAndMessaging::{
            GetWindowPlacement, SetWindowPlacement, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED,
            SW_SHOWNORMAL, WINDOWPLACEMENT,
        },
    };

    const FILE: &str = "window-layout.json";
    const LEGACY_FILE: &str = ".window-state.json";
    const MIN_WIDTH: f64 = 680.0;
    const MIN_HEIGHT: f64 = 480.0;

    #[derive(Clone, Debug, Deserialize, Serialize)]
    struct Placement {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        #[serde(default)]
        maximized: bool,
        #[serde(default)]
        scale: Option<f64>,
        // Legacy plugin values are inner sizes/screen coordinates. New values are
        // WINDOWPLACEMENT outer rectangles/workspace coordinates; do not mix them.
        #[serde(default)]
        workspace: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prev_x: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prev_y: Option<i32>,
    }
    struct LayoutState {
        path: PathBuf,
        saved: Mutex<HashMap<String, Placement>>,
        restored: Mutex<HashSet<String>>,
    }

    fn ordinary_window(label: &str) -> bool {
        label.starts_with("nb-") && !label.starts_with("nb-export-")
    }
    fn valid_size(p: &Placement, fallback_scale: f64) -> bool {
        let scale = p
            .scale
            .filter(|s| s.is_finite() && *s > 0.0)
            .unwrap_or(fallback_scale);
        f64::from(p.width) >= MIN_WIDTH * scale
            && f64::from(p.height) >= MIN_HEIGHT * scale
            && p.width <= i32::MAX as u32
            && p.height <= i32::MAX as u32
            && p.x.checked_add(p.width as i32).is_some()
            && p.y.checked_add(p.height as i32).is_some()
            && !(p.x == -32000 || p.y == -32000)
    }

    fn capture(window: &Window) -> Result<Placement, String> {
        let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
        let mut state = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        unsafe {
            GetWindowPlacement(hwnd, &mut state).map_err(|e| e.to_string())?;
        }
        let previous = window
            .state::<LayoutState>()
            .saved
            .lock()
            .unwrap()
            .get(window.label())
            .cloned();
        placement_from_native(
            &state,
            previous.as_ref(),
            window.scale_factor().map_err(|e| e.to_string())?,
        )
    }

    fn placement_from_native(
        state: &WINDOWPLACEMENT,
        previous: Option<&Placement>,
        scale: f64,
    ) -> Result<Placement, String> {
        let rect = state.rcNormalPosition;
        let maximized = if state.showCmd == SW_SHOWMINIMIZED.0 as u32 {
            previous.is_some_and(|p| p.maximized)
        } else {
            state.showCmd == SW_SHOWMAXIMIZED.0 as u32
        };
        let placement = Placement {
            x: rect.left,
            y: rect.top,
            width: u32::try_from(i64::from(rect.right) - i64::from(rect.left)).unwrap_or(0),
            height: u32::try_from(i64::from(rect.bottom) - i64::from(rect.top)).unwrap_or(0),
            maximized,
            scale: Some(scale),
            workspace: true,
            prev_x: None,
            prev_y: None,
        };
        if !valid_size(&placement, 1.0) {
            return Err("Ignoring invalid normal window bounds".into());
        }
        Ok(placement)
    }

    fn remember(window: &Window) {
        if !ordinary_window(window.label()) {
            return;
        }
        let state = window.state::<LayoutState>();
        if !state.restored.lock().unwrap().contains(window.label()) {
            return;
        }
        // Native rectangle reads happen outside the cache lock. No disk I/O during resize.
        if let Ok(value) = capture(window) {
            state
                .saved
                .lock()
                .unwrap()
                .insert(window.label().to_string(), value);
        }
    }

    pub fn restore(window: &tauri::WebviewWindow) -> Result<(), String> {
        let state = window.state::<LayoutState>();
        if state.restored.lock().unwrap().contains(window.label()) {
            return Ok(());
        }
        let saved = state.saved.lock().unwrap().get(window.label()).cloned();
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        if let Some(mut saved) = saved.filter(|p| valid_size(p, scale)) {
            if !saved.workspace && saved.maximized {
                saved.x = saved.prev_x.unwrap_or(saved.x);
                saved.y = saved.prev_y.unwrap_or(saved.y);
            }
            let monitors = window.available_monitors().map_err(|e| e.to_string())?;
            let target = monitors.iter().max_by_key(|monitor| {
                let area = monitor.work_area();
                let width = (i64::from(saved.x) + i64::from(saved.width))
                    .min(i64::from(area.position.x) + i64::from(area.size.width))
                    - i64::from(saved.x).max(i64::from(area.position.x));
                let height = (i64::from(saved.y) + i64::from(saved.height))
                    .min(i64::from(area.position.y) + i64::from(area.size.height))
                    - i64::from(saved.y).max(i64::from(area.position.y));
                width.max(0) * height.max(0)
            });
            if let Some(monitor) = target {
                saved.width = saved.width.min(monitor.work_area().size.width);
                saved.height = saved.height.min(monitor.work_area().size.height);
            }
            if saved.workspace {
                let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
                let placement = WINDOWPLACEMENT {
                    length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                    showCmd: if saved.maximized {
                        SW_SHOWMAXIMIZED.0 as u32
                    } else {
                        SW_SHOWNORMAL.0 as u32
                    },
                    rcNormalPosition: RECT {
                        left: saved.x,
                        top: saved.y,
                        right: saved.x + saved.width as i32,
                        bottom: saved.y + saved.height as i32,
                    },
                    ..Default::default()
                };
                // Paired with GetWindowPlacement, so taskbar/workspace coordinates do not creep.
                // Windows relocates an off-screen rectangle after monitor configuration changes.
                unsafe {
                    SetWindowPlacement(hwnd, &placement).map_err(|e| e.to_string())?;
                }
            } else {
                window
                    .set_size(PhysicalSize::new(saved.width, saved.height))
                    .map_err(|e| e.to_string())?;
                let on_monitor = monitors.iter().any(|m| {
                    let work = m.work_area();
                    i64::from(saved.x) >= i64::from(work.position.x)
                        && i64::from(saved.y) >= i64::from(work.position.y)
                        && i64::from(saved.x)
                            < i64::from(work.position.x) + i64::from(work.size.width)
                        && i64::from(saved.y)
                            < i64::from(work.position.y) + i64::from(work.size.height)
                });
                if on_monitor {
                    window
                        .set_position(PhysicalPosition::new(saved.x, saved.y))
                        .map_err(|e| e.to_string())?;
                } else {
                    window.center().map_err(|e| e.to_string())?;
                }
                if saved.maximized {
                    window.maximize().map_err(|e| e.to_string())?;
                }
            }
        } else {
            // Invalid legacy values never reach the native window. Retain the builder's
            // default size, capped to this display's work area on small/high-DPI screens.
            if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
                let work = monitor.work_area();
                window
                    .set_size(PhysicalSize::new(
                        ((1200.0 * scale) as u32).min(work.size.width),
                        ((800.0 * scale) as u32).min(work.size.height),
                    ))
                    .map_err(|e| e.to_string())?;
            }
            window.center().map_err(|e| e.to_string())?;
        }
        // Do not observe intermediate restore events, or mark a failed restore as
        // complete. A later shell-ready call must still be able to retry it.
        let initial = capture(&window.as_ref().window())?;
        state
            .saved
            .lock()
            .unwrap()
            .insert(window.label().to_string(), initial);
        state
            .restored
            .lock()
            .unwrap()
            .insert(window.label().to_string());
        Ok(())
    }

    fn persist(app: &tauri::AppHandle) -> Result<(), String> {
        for window in app.webview_windows().values() {
            remember(&window.as_ref().window());
        }
        let state = app.state::<LayoutState>();
        let data =
            serde_json::to_vec_pretty(&*state.saved.lock().unwrap()).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(
            state
                .path
                .parent()
                .ok_or("Window layout path has no parent")?,
        )
        .map_err(|e| e.to_string())?;
        crate::fsio::write::atomic_write(&state.path, &data).map_err(|e| e.to_string())
    }

    pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
        tauri::plugin::Builder::new("window-layout")
            .setup(|app, _| {
                let dir = app.path().app_config_dir()?;
                let path = dir.join(FILE);
                let input = if path.exists() {
                    path.clone()
                } else {
                    dir.join(LEGACY_FILE)
                };
                let saved = std::fs::read(input)
                    .ok()
                    .and_then(|data| serde_json::from_slice(&data).ok())
                    .unwrap_or_default();
                app.manage(LayoutState {
                    path,
                    saved: Mutex::new(saved),
                    restored: Mutex::new(HashSet::new()),
                });
                Ok(())
            })
            .on_window_ready(|window| {
                if !ordinary_window(window.label()) {
                    return;
                }
                let owned = window.clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::Moved(_)
                            | WindowEvent::Resized(_)
                            | WindowEvent::CloseRequested { .. }
                    ) {
                        remember(&owned);
                    }
                });
            })
            .on_event(|app, event| {
                if matches!(event, RunEvent::Exit) {
                    if let Err(error) = persist(app) {
                        log::error!("Window layout persistence: {error}");
                    }
                }
            })
            .build()
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        fn p(width: u32, height: u32) -> Placement {
            Placement {
                x: 200,
                y: 180,
                width,
                height,
                maximized: false,
                scale: Some(2.0),
                workspace: true,
                prev_x: None,
                prev_y: None,
            }
        }
        #[test]
        fn minimized_snapshot_is_rejected() {
            assert!(!valid_size(&p(288, 35), 2.0));
        }
        #[test]
        fn legacy_scale_and_normal_sizes() {
            let mut value = p(2400, 1600);
            value.scale = None;
            assert!(valid_size(&value, 2.0));
            value.width = 1200;
            assert!(!valid_size(&value, 2.0));
        }
        #[test]
        fn sentinel_and_overflow_coordinates_are_rejected() {
            let mut value = p(2400, 1600);
            value.x = -32000;
            assert!(!valid_size(&value, 2.0));
            value.x = i32::MAX;
            assert!(!valid_size(&value, 2.0));
            value.x = -2500;
            assert!(valid_size(&value, 2.0));
        }
        #[test]
        fn minimized_native_state_retains_normal_rectangle_and_maximized_intent() {
            let state = WINDOWPLACEMENT {
                showCmd: SW_SHOWMINIMIZED.0 as u32,
                rcNormalPosition: RECT {
                    left: 200,
                    top: 180,
                    right: 2600,
                    bottom: 1780,
                },
                ..Default::default()
            };
            let mut previous = p(2400, 1600);
            previous.maximized = true;
            let captured = placement_from_native(&state, Some(&previous), 2.0).unwrap();
            assert_eq!(
                (captured.x, captured.y, captured.width, captured.height),
                (200, 180, 2400, 1600)
            );
            assert!(captured.maximized);
            previous.maximized = false;
            assert!(
                !placement_from_native(&state, Some(&previous), 2.0)
                    .unwrap()
                    .maximized
            );
        }
    }
}
