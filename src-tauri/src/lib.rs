// NoteBoard — Rust 核心层
// 模块装配入口
// 分层见 docs/04-技术架构设计.md §1.1

pub mod dto;
pub mod state;
pub mod path;
pub mod fsio;
pub mod registry;
pub mod window;
pub mod settings;
pub mod session;
pub mod sysfont;
pub mod font_pack;
pub mod bootstrap;
pub mod updater;
pub mod staging;
pub mod favorites;
pub mod perf;
pub mod export;
mod shortcut_probe;
mod clipboard_image;

use state::AppState;
use std::sync::Mutex;

/// 应用入口
pub fn run() {
    tauri::Builder::default()
        // 🔴 single-instance 必须第一个注册
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            bootstrap::single_instance::handle_second_instance(app, argv);
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(window::geometry::plugin())
        .manage(Mutex::new(AppState::for_startup()))
        .manage(export::ExportJobs::default())
        .manage(export::pandoc::PandocJobs::default())
        .setup(|app| {
            // 🔴 诊断 span：setup 钩子的真实执行区间（不含 WebView 创建提前量）
            perf::mark("setup_start");
            let result = bootstrap::setup(app);
            perf::mark("setup_end");
            result?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            shortcut_probe::probe_shortcuts,
            clipboard_image::copy_png_image,
            export::create_pdf,
            export::pdf_payload,
            export::pdf_layout_started,
            export::pdf_ready,
            export::read_pdf,
            export::update_pdf,
            export::save_pdf,
            export::release_pdf,
            export::pandoc::pandoc_status,
            export::pandoc::begin_pandoc,
            export::pandoc::cancel_pandoc,
            export::pandoc::pandoc_export,
            // window（S04 打开队列 + 迁移协议）
            window::commands::window_listeners_ready,
            window::commands::window_shell_ready,
            window::commands::list_open_requests,
            window::commands::ack_open_request,
            window::commands::enqueue_open_requests,
            window::commands::create_window,
            window::commands::begin_document_transfer,
            window::commands::take_transfer_payload,
            window::commands::prepare_transfer_complete,
            window::commands::abort_transfer,
            window::commands::query_transfer,
            window::commands::focus_window,
            window::commands::close_window,
            // registry
            registry::commands::register_document,
            registry::commands::unregister_document,
            registry::commands::reconcile_documents,
            registry::commands::set_document_dirty,
            registry::commands::find_document_owner,
            // fsio
            fsio::commands::read_document,
            fsio::commands::probe_document,
            // 🔴 S07：统一文件准备（读盘前归属查询 + 在途去重 + blocking 读取）
            fsio::prepare::prepare_document,
            fsio::commands::write_document,
            fsio::native_documents::save_native_bundle,
            fsio::native_documents::read_native_headers,
            fsio::native_documents::recover_native_commits,
            fsio::commands::save_binary_file,
            fsio::recovery_images::publish_recovery_image,
            fsio::recovery_images::store_image_asset,
            fsio::image_edit::write_image_edit,
            fsio::commands::read_dir,
            fsio::commands::prepare_directory_watch,
            fsio::browse::browse_locations,
            fsio::commands::create_file,
            fsio::commands::create_dir,
            fsio::commands::rename_path,
            fsio::commands::move_to_trash,
            fsio::image_assets::recycle_document_image,
            fsio::image_assets::recycle_document_images,
            fsio::image_assets::restore_document_image,
            fsio::commands::path_exists,
            fsio::commands::reveal_in_explorer,
            fsio::commands::open_with_default_app,
            // settings
            settings::commands::load_settings,
            settings::commands::default_typography,
            settings::commands::apply_recommended_fonts,
            settings::commands::save_settings,
            settings::commands::patch_settings,
            // staging
            staging::commands::get_default_staging_directory,
            staging::commands::ensure_staging_directory,
            staging::commands::open_staging_directory,
            staging::commands::stash_documents,
            staging::commands::delete_staged_file,
            // session
            session::commands::load_session,
            session::commands::save_session,
            session::commands::clear_session,
            session::commands::list_recent,
            session::commands::push_recent,
            session::commands::write_draft,
            session::commands::delete_draft,
            session::commands::list_drafts,
            // favorites
            favorites::commands::load_favorites,
            favorites::commands::save_favorites,
            // sysfont
            sysfont::commands::list_system_fonts,
            // 应用内字体资源包
            font_pack::get_font_pack_status,
            font_pack::refresh_font_pack_status,
            font_pack::download_font_pack,
            font_pack::import_font_pack,
            font_pack::remove_font_pack,
            // updater
            updater::commands::check_for_updates,
            updater::notice::get_dismissed_update_notices,
            updater::notice::dismiss_update_notice,
            updater::commands::download_and_install_update,
            updater::commands::open_external_url,
            // 性能诊断（未启用时为 no-op）
            perf::commands::record_web_spans,
            perf::commands::dump_perf_spans,
            perf::commands::is_perf_spans_enabled,
        ])
        .on_window_event(|window, event| {
            window::manager::on_window_event(window, event)
        })
        .run(tauri::generate_context!())
        .expect("error while running NoteBoard application");
}
