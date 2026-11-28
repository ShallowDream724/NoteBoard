#[derive(serde::Serialize)]
pub struct FileClipboard {
    paths: Vec<String>,
    cut: bool,
    sequence: u32,
}

#[tauri::command]
pub async fn write_file_clipboard(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
    cut: bool,
) -> Result<u32, String> {
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || platform::write(owner, &paths, cut))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, paths, cut);
        Err("当前系统不支持 Windows 文件剪贴板".into())
    }
}

#[tauri::command]
pub async fn read_file_clipboard(
    window: tauri::WebviewWindow,
) -> Result<Option<FileClipboard>, String> {
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || platform::read(owner))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(None)
    }
}

#[tauri::command]
pub async fn consume_cut_file_clipboard(
    window: tauri::WebviewWindow,
    sequence: u32,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let owner = window.hwnd().map_err(|error| error.to_string())?.0 as usize;
        tauri::async_runtime::spawn_blocking(move || platform::consume_cut(owner, sequence))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, sequence);
        Ok(())
    }
}

#[cfg(windows)]
mod platform {
    use super::FileClipboard;
    use crate::win_clipboard::{Clipboard, OwnedGlobal};
    use std::mem::size_of;
    use std::path::{Component, Path, Prefix};
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
        RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::UI::Shell::{DragQueryFileW, CFSTR_PREFERREDDROPEFFECT, DROPFILES, HDROP};

    const CF_HDROP: u32 = 15;
    const COPY: u32 = 1;
    const MOVE: u32 = 2;
    const MAX_PATHS: usize = 4096;
    const MAX_PATH_UNITS: usize = 32767;
    const MAX_DROP_BYTES: usize = 2 * 1024 * 1024;

    fn path_allowed(path: &str) -> bool {
        let path = Path::new(path);
        let mut components = path.components();
        matches!(components.next(), Some(Component::Prefix(prefix)) if matches!(
            prefix.kind(), Prefix::Disk(_) | Prefix::UNC(_, _) | Prefix::VerbatimDisk(_) | Prefix::VerbatimUNC(_, _)))
            && path.is_absolute()
            && !components.any(|part| matches!(part, Component::ParentDir | Component::CurDir))
            && path.file_name().is_some()
            && !path.as_os_str().as_encoded_bytes().contains(&0)
    }

    fn encode_drop_files(paths: &[String]) -> Result<Vec<u8>, String> {
        if paths.is_empty() || paths.len() > MAX_PATHS {
            return Err("剪贴板文件数量无效".into());
        }
        // DROPFILES holds five 32-bit fields: byte offset, POINT, fNC and fWide.
        let mut data = Vec::new();
        for field in [size_of::<DROPFILES>() as u32, 0, 0, 0, 1] {
            data.extend_from_slice(&field.to_le_bytes());
        }
        for path in paths {
            if !path_allowed(path) || path.encode_utf16().count() > MAX_PATH_UNITS {
                return Err("剪贴板文件路径无效".into());
            }
            for unit in path.encode_utf16().chain([0]) {
                data.extend_from_slice(&unit.to_le_bytes());
            }
            if data.len() + 2 > MAX_DROP_BYTES {
                return Err("剪贴板路径过多".into());
            }
        }
        data.extend_from_slice(&[0, 0]);
        Ok(data)
    }

    fn preferred_effect_format() -> u32 {
        unsafe { RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT) }
    }

    fn preferred_move() -> bool {
        let format = preferred_effect_format();
        if format == 0 || unsafe { IsClipboardFormatAvailable(format) }.is_err() {
            return false;
        }
        let Ok(handle) = (unsafe { GetClipboardData(format) }) else {
            return false;
        };
        let memory = HGLOBAL(handle.0);
        if unsafe { GlobalSize(memory) } < size_of::<u32>() {
            return false;
        }
        let pointer = unsafe { GlobalLock(memory) }.cast::<u32>();
        if pointer.is_null() {
            return false;
        }
        let effect = unsafe { pointer.read_unaligned() };
        let _ = unsafe { GlobalUnlock(memory) };
        effect == MOVE
    }

    pub(super) fn write(owner: usize, paths: &[String], cut: bool) -> Result<u32, String> {
        let format = preferred_effect_format();
        if format == 0 {
            return Err("无法注册 Windows 文件剪贴板格式".into());
        }
        let mut files = OwnedGlobal::from_bytes(&encode_drop_files(paths)?)?;
        let mut effect = OwnedGlobal::from_bytes(&(if cut { MOVE } else { COPY }).to_le_bytes())?;
        let _clipboard = Clipboard::open(owner)?;
        unsafe { EmptyClipboard() }.map_err(|error| error.to_string())?;
        effect.give_to_clipboard(format)?;
        files.give_to_clipboard(CF_HDROP)?;
        Ok(unsafe { GetClipboardSequenceNumber() })
    }

    pub(super) fn read(owner: usize) -> Result<Option<FileClipboard>, String> {
        let _clipboard = Clipboard::open(owner)?;
        if unsafe { IsClipboardFormatAvailable(CF_HDROP) }.is_err() {
            return Ok(None);
        }
        let handle = unsafe { GetClipboardData(CF_HDROP) }.map_err(|error| error.to_string())?;
        if !(size_of::<DROPFILES>()..=MAX_DROP_BYTES)
            .contains(&unsafe { GlobalSize(HGLOBAL(handle.0)) })
        {
            return Err("剪贴板文件列表大小无效".into());
        }
        let drop = HDROP(handle.0);
        let count = unsafe { DragQueryFileW(drop, u32::MAX, None) };
        if count == 0 || count as usize > MAX_PATHS {
            return Err("剪贴板文件数量无效".into());
        }
        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let len = unsafe { DragQueryFileW(drop, index, None) } as usize;
            if len == 0 || len > MAX_PATH_UNITS {
                return Err("剪贴板文件路径长度无效".into());
            }
            let mut buffer = vec![0u16; len + 1];
            if unsafe { DragQueryFileW(drop, index, Some(&mut buffer)) } as usize != len {
                return Err("无法读取剪贴板文件路径".into());
            }
            let path = String::from_utf16(&buffer[..len]).map_err(|_| "剪贴板文件路径无效")?;
            if !path_allowed(&path) {
                return Err("剪贴板文件路径无效".into());
            }
            paths.push(path);
        }
        let cut = preferred_move();
        let sequence = unsafe { GetClipboardSequenceNumber() };
        Ok(Some(FileClipboard {
            paths,
            cut,
            sequence,
        }))
    }

    pub(super) fn consume_cut(owner: usize, sequence: u32) -> Result<(), String> {
        let _clipboard = Clipboard::open(owner)?;
        if sequence != 0
            && unsafe { IsClipboardFormatAvailable(CF_HDROP) }.is_ok()
            && preferred_move()
            && unsafe { GetClipboardSequenceNumber() } == sequence
        {
            unsafe { EmptyClipboard() }.map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn drop_files_carries_absolute_unicode_paths_and_a_double_terminator() {
            let paths = [
                r"C:\notes\文件.md".to_string(),
                r"\\host\share\dir".to_string(),
            ];
            let bytes = encode_drop_files(&paths).unwrap();
            let list: Vec<_> = bytes[size_of::<DROPFILES>()..]
                .chunks_exact(2)
                .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
                .collect();
            assert_eq!(
                list,
                paths
                    .join("\0")
                    .encode_utf16()
                    .chain([0, 0])
                    .collect::<Vec<_>>()
            );
        }

        #[test]
        fn rejects_devices_roots_relative_paths_and_embedded_nuls() {
            for path in [
                r"\\.\C:\file",
                r"C:\",
                "relative.md",
                "C:\\bad\0name",
                r"C:\folder\..\x",
            ] {
                assert!(encode_drop_files(&[path.to_string()]).is_err(), "{path:?}");
            }
        }
    }
}
