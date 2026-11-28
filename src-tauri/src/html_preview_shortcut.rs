use tauri::{Emitter, EventTarget, Manager, Runtime, Webview};
use webview2_com::{AcceleratorKeyPressedEventHandler, Microsoft::Web::WebView2::Win32::*};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};

pub fn attach<R: Runtime>(webview: &Webview<R>) {
    let label = webview.label();
    if label != "nb-main" && !label.strip_prefix("nb-").is_some_and(|suffix| suffix.parse::<u32>().is_ok()) {
        return;
    }
    let app = webview.app_handle().clone();
    let target = EventTarget::webview(label);
    if let Err(error) = webview.with_webview(move |native| {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
            let mut vk = 0;
            let binding = unsafe {
                args.KeyEventKind(&mut kind)?;
                if !matches!(kind, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN | COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) {
                    return Ok(());
                }
                args.PhysicalKeyStatus(&mut status)?;
                if status.WasKeyDown.as_bool() || GetKeyState(VK_LWIN.0.into()) < 0 || GetKeyState(VK_RWIN.0.into()) < 0 {
                    return Ok(());
                }
                args.VirtualKey(&mut vk)?;
                // Chromium reports the physical Slash key even on non-US layouts.
                if status.ScanCode == 0x35 && !status.IsExtendedKey.as_bool() {
                    vk = 0xbf;
                }
                let modifiers = u32::from(GetKeyState(VK_MENU.0.into()) < 0)
                    | (u32::from(GetKeyState(VK_CONTROL.0.into()) < 0) << 1)
                    | (u32::from(GetKeyState(VK_SHIFT.0.into()) < 0) << 2);
                crate::shortcut_probe::binding_for_native_key(modifiers, vk)
            };
            if let Some(binding) = binding {
                // A sandboxed frame owns DOM keydown. Forward accelerator metadata
                // without consuming normal WebView input. Queue the cross-process
                // call outside WebView2's synchronous accelerator callback.
                let (app, target) = (app.clone(), target.clone());
                tauri::async_runtime::spawn(async move {
                    let _ = app.emit_to(target, "nb://html-preview-accelerator", binding);
                });
            }
            Ok(())
        }));
        // The controller owns the subscription for this WebView's lifetime.
        let mut token = 0;
        if let Err(error) = unsafe { native.controller().add_AcceleratorKeyPressed(&handler, &mut token) } {
            log::warn!("Could not subscribe to HTML preview shortcuts: {error}");
        }
    }) {
        log::warn!("Could not access the WebView for HTML preview shortcuts: {error}");
    }
}
