use std::path::PathBuf;

/// Returns the path to a protoc binary.
///
/// Prefers the PROTOC env var if set, otherwise falls back to a vendored binary.
pub fn protoc() -> PathBuf {
    if let Ok(path) = std::env::var("PROTOC") {
        return PathBuf::from(path);
    }

    protoc_bin_vendored::protoc_bin_path()
        .expect("protoc-bin-vendored should provide a protoc binary")
}

/// Returns the path to the protobuf include directory if available.
pub fn include() -> PathBuf {
    if let Ok(path) = std::env::var("PROTOC_INCLUDE") {
        return PathBuf::from(path);
    }

    let protoc_path = protoc();
    if let Some(bin_dir) = protoc_path.parent() {
        if let Some(root_dir) = bin_dir.parent() {
            return root_dir.join("include");
        }
    }

    PathBuf::new()
}
