//! A short-lived reservation probe. It never installs a hook or keeps a key.
use serde::Serialize;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(serde::Deserialize)]
struct Definition { id: String, label: String, contexts: Vec<String>, defaults: Vec<String> }
fn definitions() -> &'static Vec<Definition> {
    static CATALOG: OnceLock<Vec<Definition>> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("../../src/core/shortcutCatalog.json")).expect("valid shortcut catalog"))
}
fn valid_binding(binding: &str) -> bool {
    let Some((modifiers, key)) = native_key(binding) else { return false; };
    if modifiers & 8 != 0 || ["Ctrl+Alt+Delete", "Alt+Tab", "Alt+F4", "Ctrl+Escape", "Ctrl+Shift+Escape", "Alt+Escape"].contains(&binding) { return false; }
    let canonical = [(2, "Ctrl"), (4, "Shift"), (1, "Alt")].into_iter().filter(|(flag, _)| modifiers & flag != 0)
        .map(|(_, text)| text).chain(binding.rsplit('+').take(1)).collect::<Vec<_>>().join("+");
    canonical == binding && (modifiers & 3 != 0 || (0x70..=0x87).contains(&key))
}
pub(crate) fn validate_overrides(overrides: &BTreeMap<String, Vec<String>>) -> Result<(), String> {
    let catalog = definitions();
    for (id, bindings) in overrides {
        if !catalog.iter().any(|definition| &definition.id == id) { return Err(format!("未知快捷键命令: {id}")); }
        if bindings.len() > 4 || bindings.iter().any(|binding| !valid_binding(binding)) { return Err(format!("快捷键组合无效或被系统保留: {id}")); }
    }
    let mut assigned: BTreeMap<&str, Vec<&Definition>> = BTreeMap::new();
    for definition in catalog {
        for binding in overrides.get(&definition.id).unwrap_or(&definition.defaults) {
            let previous = assigned.entry(binding).or_default();
            for other in previous.iter() {
                let overlaps = definition.contexts.iter().any(|context| context == "app" || other.contexts.contains(context)) || other.contexts.iter().any(|context| context == "app");
                if other.id != definition.id && overlaps { return Err(format!("{binding} 同时分配给了“{}”与“{}”", other.label, definition.label)); }
            }
            previous.push(definition);
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutProbe { binding: String, status: &'static str, error_code: Option<i32> }

fn native_key(binding: &str) -> Option<(u32, u32)> {
    let mut parts: Vec<_> = binding.split('+').collect();
    let key = parts.pop()?;
    let mut modifiers = 0;
    for part in parts { modifiers |= match part { "Ctrl" => 2, "Alt" => 1, "Shift" => 4, "Meta" => 8, _ => return None }; }
    let vk = match key {
        "Enter" => 0x0d, "Space" => 0x20, "Tab" => 0x09, "Escape" => 0x1b,
        "Backspace" => 0x08, "Delete" => 0x2e, "Insert" => 0x2d,
        "Home" => 0x24, "End" => 0x23, "PageUp" => 0x21, "PageDown" => 0x22,
        "ArrowLeft" => 0x25, "ArrowUp" => 0x26, "ArrowRight" => 0x27, "ArrowDown" => 0x28,
        "/" => 0xbf, "." => 0xbe, "," => 0xbc, "-" => 0xbd, "=" => 0xbb,
        ";" => 0xba, "'" => 0xde, "[" => 0xdb, "]" => 0xdd, "\\" => 0xdc, "`" => 0xc0,
        key if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() => key.as_bytes()[0].to_ascii_uppercase() as u32,
        key if key.starts_with('F') => { let function: u32 = key[1..].parse().ok()?; if !(1..=24).contains(&function) { return None; } 0x6f + function },
        _ => return None,
    };
    Some((modifiers, vk))
}

#[tauri::command]
pub async fn probe_shortcuts(bindings: Vec<String>) -> Result<Vec<ShortcutProbe>, String> {
    if bindings.len() > 256 || bindings.iter().any(|binding| binding.len() > 64) { return Err("快捷键检测请求过大".into()); }
    // A dedicated thread also releases all reservations if Windows rejects an
    // explicit UnregisterHotKey. Never leave registrations on a pooled worker.
    tauri::async_runtime::spawn_blocking(move || std::thread::spawn(move || bindings.into_iter().enumerate().map(|(index, binding)| {
        let mut result = ShortcutProbe { binding, status: "unknown", error_code: None };
        #[cfg(windows)]
        if let Some((modifiers, key)) = native_key(&result.binding) {
            use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS};
            let id = 0x4100 + index as i32;
            unsafe {
                match RegisterHotKey(None, id, HOT_KEY_MODIFIERS(modifiers | 0x4000), key) {
                    Ok(()) => {
                        // Always release before returning any result to the UI.
                        match UnregisterHotKey(None, id) {
                            Ok(()) => result.status = "unclaimed",
                            Err(error) => result.error_code = Some(error.code().0 & 0xffff),
                        }
                    }
                    Err(error) => {
                        let code = error.code().0 & 0xffff;
                        result.status = if code == 1409 { "occupied" } else { "unknown" };
                        result.error_code = Some(code);
                    }
                }
            }
        }
        #[cfg(not(windows))]
        let _ = index;
        result
    }).collect()).join().map_err(|_| "快捷键检测线程异常".to_owned())).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_physical_combinations_without_accepting_malformed_keys() {
        assert_eq!(native_key("Ctrl+1"), Some((2, 0x31)));
        assert_eq!(native_key("Ctrl+Shift+/"), Some((6, 0xbf)));
        assert_eq!(native_key("F24"), Some((0, 0x87)));
        assert_eq!(native_key("Ctrl+F25"), None);
        assert_eq!(native_key("Ctrl+something"), None);
    }
    #[test]
    fn settings_validate_defaults_and_overlapping_command_assignments() {
        assert!(validate_overrides(&BTreeMap::new()).is_ok());
        let mut bindings = BTreeMap::from([("markdown.heading1".into(), vec!["Ctrl+F8".into()])]);
        assert!(validate_overrides(&bindings).is_ok());
        bindings.insert("file.save".into(), vec!["Ctrl+F8".into()]);
        assert!(validate_overrides(&bindings).is_err());
        bindings.insert("file.save".into(), vec!["Alt+F4".into()]);
        assert!(validate_overrides(&bindings).is_err());
    }
}
