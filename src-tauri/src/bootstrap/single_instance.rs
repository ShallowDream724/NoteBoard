// NoteBoard 单实例处理
// 🔴 实现红线：single-instance 回调运行在 WM_COPYDATA 同步窗口过程里。
//    任何窗口查询、显示或建窗都必须切换到工作线程，避免卡死 Windows 消息循环（wry#583）。
// 🔴 S04：第二实例路径不再直接 emit 事件打开文件，而是入队目标窗口的可靠打开队列，
//    由前端消费者拉取确认（队列在未订阅时不会丢失）。

use crate::dto::WindowIntent;
use crate::state::AppState;
use std::sync::Mutex;
use tauri::Manager;

/// 接收第二实例参数并立即切出 Windows 同步消息回调
pub fn handle_second_instance(app: &tauri::AppHandle, argv: Vec<String>) {
    let app_handle = app.clone();
    std::thread::spawn(move || handle_second_instance_on_worker(&app_handle, argv));
}

/// 在工作线程中把打开请求入队，并恢复、显示和聚焦已有窗口
fn handle_second_instance_on_worker(app: &tauri::AppHandle, argv: Vec<String>) {
    // 过滤并收集命令行文件路径参数
    let paths: Vec<String> = argv
        .iter()
        .skip(1) // argv[0] 是 exe 自身
        .filter(|a| !a.starts_with('-'))
        .cloned()
        .collect();

    let state = app.state::<Mutex<AppState>>();

    // Routing and reservation form one atomic state transition. Native windows
    // may not exist yet; hidden export WebViews must never receive file opens.
    let (label, create, version) = {
        let mut s = state.lock().unwrap();
        let (label, create) = s.claim_launch_window();
        if paths.is_empty() && create {
            s.intents.insert(label.clone(), WindowIntent::Empty);
        } else if !paths.is_empty() {
            crate::window::intent::enqueue_open_requests_inner(
                &mut s,
                &label,
                paths,
                None,
                crate::dto::OpenRequestSource::SecondInstance,
            );
        }
        (label, create, s.open_queue_version)
    };
    // Keep native calls outside both the registry lock and WM_COPYDATA callback.
    if create {
        let _ = crate::window::manager::create_window(app, label.clone());
    }
    crate::window::intent::notify_open_requests(app, &label, version);
    if let Some(window) = app.get_webview_window(&label) {
        crate::window::manager::bring_to_front(&window);
    }
}
