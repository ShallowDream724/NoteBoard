use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::path::Path;

const MAX_ENTRIES: usize = 8_000;
const MAX_DIRECTORIES: usize = 256;
const MAX_DEPTH: usize = 24;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFiles {
    paths: Vec<String>,
    limited: bool,
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Windows junctions and other reparse points can point outside the chosen root.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    metadata.is_symlink()
}

fn collect_workspace_files(
    root: &Path,
    show_hidden: bool,
    max_entries: usize,
) -> Result<WorkspaceFiles, String> {
    if !root.is_absolute() {
        return Err("工作区路径必须是绝对路径".into());
    }
    let mut directories = VecDeque::from([(root.to_path_buf(), 0)]);
    let mut scheduled_directories = 1;
    let mut remaining = max_entries;
    let mut result = WorkspaceFiles {
        paths: Vec::new(),
        limited: false,
    };

    while let Some((directory, depth)) = directories.pop_front() {
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(error) if depth == 0 => return Err(error.to_string()),
            Err(_) => continue,
        };
        for entry in entries {
            if remaining == 0 {
                result.limited = true;
                return Ok(result);
            }
            remaining -= 1;
            let Ok(entry) = entry else {
                continue;
            };
            let name = entry.file_name();
            if name.eq_ignore_ascii_case(".git")
                || (!show_hidden && name.to_string_lossy().starts_with('.'))
                || super::import_history::is_live_stash(&entry.path())
            {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if is_link(&metadata) {
                continue;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if !show_hidden && metadata.file_attributes() & 0x2 != 0 {
                    continue;
                }
            }
            if metadata.is_dir() {
                if depth >= MAX_DEPTH || scheduled_directories >= MAX_DIRECTORIES {
                    result.limited = true;
                } else {
                    directories.push_back((entry.path(), depth + 1));
                    scheduled_directories += 1;
                }
            } else if metadata.is_file() {
                let path = entry.path();
                if let Some(path) = path.to_str() {
                    result.paths.push(path.to_owned());
                }
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_workspace_files(
    root: String,
    show_hidden: bool,
) -> Result<WorkspaceFiles, String> {
    tauri::async_runtime::spawn_blocking(move || {
        collect_workspace_files(Path::new(&root), show_hidden, MAX_ENTRIES)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_nested_files_with_visibility_and_entry_budget() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("nested")).unwrap();
        fs::create_dir(root.path().join(".git")).unwrap();
        for path in ["root.md", "nested/page.md", ".notes.md", ".git/index"] {
            fs::write(root.path().join(path), "").unwrap();
        }
        let files = |show_hidden, budget| {
            collect_workspace_files(root.path(), show_hidden, budget).unwrap()
        };
        let visible = files(false, 16);
        assert_eq!(visible.paths.len(), 2);
        assert!(visible.paths.iter().any(|path| path.ends_with("page.md")));
        assert!(!visible.limited);
        assert_eq!(files(true, 16).paths.len(), 3);
        let partial = files(false, 1);
        assert!(partial.limited);
        assert!(partial.paths.len() <= 1);
    }
}
