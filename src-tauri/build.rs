fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Tauri embeds the application manifest in bins, but not Cargo examples.
        let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("examples/windows.manifest");
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-examples=/MANIFESTINPUT:{}", manifest.display());
        println!("cargo:rerun-if-changed=examples/windows.manifest");
    }
}
