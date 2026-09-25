pub mod read;
pub mod write;
pub mod dir;
pub mod browse;
pub mod trash;
pub mod image_assets;
pub mod recovery_images;
pub mod commands;
pub mod native_documents;
// 🔴 S07：统一文件准备服务（归属查询提前 + 在途去重 + blocking 读取）
pub mod prepare;
