// NoteBoard settings 命令 — IPC 接口

use crate::state::AppState;
use crate::settings::model::{self, Settings};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

/// 读取设置
#[tauri::command]
pub fn load_settings() -> Result<Settings, String> {
    Ok(model::load())
}

/// The reset UI uses the same defaults as a fresh installation.
#[tauri::command]
pub fn default_typography() -> model::TypographySettings {
    model::TypographySettings::default()
}

#[tauri::command]
pub fn apply_recommended_fonts(app: AppHandle, state: State<'_, Mutex<AppState>>, expected: Option<model::TypographySettings>) -> Result<Settings, String> {
    let settings = model::apply_recommended_fonts(expected.as_ref())?;
    {
        let mut app_state = state.lock().unwrap();
        app_state.settings_revision = app_state.settings_revision.max(settings.revision);
    }
    let _ = app.emit("nb://settings-changed", &settings);
    Ok(settings)
}

/// 保存设置（落盘 + 广播）
#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    settings: Settings,
) -> Result<u64, String> {
    let mut s = settings;
    let revision = model::save(&mut s)?;

    // 更新 AppState revision
    {
        let mut app_state = state.lock().unwrap();
        app_state.settings_revision = app_state.settings_revision.max(revision);
    }

    // 🔴 emit 在 v2 里是广播 —— 这里是故意的（FR-1004 所有窗口同步）
    // 不需要 emit_to(label, ...)
    let _ = app.emit("nb://settings-changed", &s);

    Ok(revision)
}

/// Apply only changed fields to the latest durable snapshot, then broadcast it.
#[tauri::command]
pub fn patch_settings(app: AppHandle, state: State<'_, Mutex<AppState>>, patch: serde_json::Value) -> Result<Settings, String> {
    let settings = model::patch(patch)?;
    {
        let mut app_state = state.lock().unwrap();
        app_state.settings_revision = app_state.settings_revision.max(settings.revision);
    }
    let _ = app.emit("nb://settings-changed", &settings);
    Ok(settings)
}
