use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{CloseClipboard, OpenClipboard, SetClipboardData};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

pub(crate) struct Clipboard;

impl Clipboard {
    pub(crate) fn open(owner: usize) -> Result<Self, String> {
        if owner == 0 {
            return Err("无法取得剪贴板窗口句柄".into());
        }
        unsafe { OpenClipboard(HWND(owner as *mut core::ffi::c_void)) }
            .map_err(|error| error.to_string())?;
        Ok(Self)
    }
}

impl Drop for Clipboard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

pub(crate) struct OwnedGlobal(Option<HGLOBAL>);

impl OwnedGlobal {
    pub(crate) fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        let handle = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
            .map_err(|error| error.to_string())?;
        let pointer = unsafe { GlobalLock(handle) } as *mut u8;
        if pointer.is_null() {
            let _ = unsafe { GlobalFree(handle) };
            return Err("无法锁定剪贴板内存".into());
        }
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer, bytes.len()) };
        let _ = unsafe { GlobalUnlock(handle) };
        Ok(Self(Some(handle)))
    }

    pub(crate) fn give_to_clipboard(&mut self, format: u32) -> Result<(), String> {
        let handle = self.0.ok_or("剪贴板内存已转移")?;
        unsafe { SetClipboardData(format, HANDLE(handle.0)) }.map_err(|error| error.to_string())?;
        self.0 = None; // Windows owns it only after SetClipboardData succeeds.
        Ok(())
    }
}

impl Drop for OwnedGlobal {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            let _ = unsafe { GlobalFree(handle) };
        }
    }
}
