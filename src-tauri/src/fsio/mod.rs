pub mod read;
mod text_codec;
pub mod write;
pub mod dir;
pub mod browse;
pub mod trash;
pub mod image_assets;
pub mod recovery_images;
pub mod image_edit;
pub mod commands;
mod guarded_rename;
pub mod copy_entry;
pub mod import_history;
pub mod workspace_files;
pub mod native_documents;
pub mod local_pdf;
// 🔴 S07：统一文件准备服务（归属查询提前 + 在途去重 + blocking 读取）
pub mod prepare;
