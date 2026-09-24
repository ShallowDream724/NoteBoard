//! Reminder dismissal lasts for this application process, including all windows.
//! Permanent version preferences belong to settings instead.
use std::{collections::BTreeSet, sync::Mutex};
use tauri::{AppHandle, Emitter};

static DISMISSED: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

#[tauri::command]
pub fn get_dismissed_update_notices() -> Result<Vec<String>, String> {
    Ok(DISMISSED.lock().map_err(|e| e.to_string())?.iter().cloned().collect())
}

#[tauri::command]
pub fn dismiss_update_notice(app: AppHandle, version: String) -> Result<(), String> {
    let inserted = DISMISSED.lock().map_err(|e| e.to_string())?.insert(version.clone());
    if inserted {
        app.emit("nb://update-notice-dismissed", version).map_err(|e| e.to_string())?;
    }
    Ok(())
}
