//! Recoverable native/Markdown saves. The journal contains metadata only; large
//! data is streamed into same-volume staging files and application recovery files.
use crate::dto::{Encoding, Eol};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::UNIX_EPOCH,
};

static COMMITS: Mutex<()> = Mutex::new(());
static INITIAL_RECOVERY: OnceLock<Result<(), String>> = OnceLock::new();
static STARTUP_DIAGNOSTICS: Mutex<Vec<RecoveryDiagnostic>> = Mutex::new(Vec::new());
const HEADER_LIMIT: u64 = 64 * 1024;
const HEADER_BATCH_LIMIT: usize = 256;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBundleRequest {
    pub path: String,
    pub content: String,
    pub expected_hash: Option<String>,
    #[serde(default)]
    pub create_only: bool,
    pub markdown: Option<MarkdownWrite>,
    pub remove_markdown: Option<MarkdownRemoval>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownWrite {
    pub path: String,
    pub content: String,
    pub expected_hash: Option<String>,
    pub encoding: Option<Encoding>,
    pub eol: Option<Eol>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownRemoval {
    pub path: String,
    pub expected_hash: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBundleResult {
    pub ok: bool,
    pub native: Option<SavedFile>,
    pub markdown: Option<SavedFile>,
    pub error: Option<NativeSaveError>,
}

#[derive(Debug, Serialize)]
pub struct SavedFile {
    pub mtime: i64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct NativeSaveError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct NativeHeaderResult {
    pub path: String,
    pub header: String,
}

#[derive(Debug, Serialize)]
pub struct RecoveryDiagnostic {
    pub path: String,
    pub message: String,
}

impl NativeSaveError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn conflict(path: &Path) -> Self {
        Self::new(
            "conflict",
            format!("文件已被外部修改，请重新读取后再保存：{}", path.display()),
        )
    }
}

impl From<io::Error> for NativeSaveError {
    fn from(error: io::Error) -> Self {
        Self::new("io", format!("保存文件失败：{error}"))
    }
}

impl NativeBundleResult {
    fn failed(error: NativeSaveError) -> Self {
        Self {
            ok: false,
            native: None,
            markdown: None,
            error: Some(error),
        }
    }
}

#[tauri::command]
pub async fn save_native_bundle(request: NativeBundleRequest) -> NativeBundleResult {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = match COMMITS.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return NativeBundleResult::failed(NativeSaveError::new(
                    "io",
                    "保存状态不可用，请重启 NoteBoard",
                ))
            }
        };
        save_bundle_at(&recovery_root(), request, Fault::None)
    })
    .await
    .unwrap_or_else(|error| {
        NativeBundleResult::failed(NativeSaveError::new("io", error.to_string()))
    })
}

/// Called at startup and before saving. Unfinished commits are rolled back only
/// if the live files still match our recorded versions. Later edits are preserved.
#[tauri::command]
pub async fn recover_native_commits() -> Result<Vec<RecoveryDiagnostic>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_recovered_before_read()?;
        let _guard = COMMITS.lock().map_err(|_| "恢复状态不可用".to_string())?;
        let mut diagnostics = std::mem::take(&mut *STARTUP_DIAGNOSTICS.lock().map_err(|_| "恢复状态不可用".to_string())?);
        diagnostics.extend(recover_at(&recovery_root()).map_err(|error| error.message)?);
        diagnostics.dedup_by(|left, right| left.path == right.path && left.message == right.message);
        Ok(diagnostics)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Executed once on an I/O worker before any document is read. Subsequent reads
/// only access the OnceLock; completed source-removal archives are never scanned.
pub fn ensure_recovered_before_read() -> Result<(), String> {
    INITIAL_RECOVERY.get_or_init(|| {
        let _guard = COMMITS.lock().map_err(|_| "恢复状态不可用".to_string())?;
        let diagnostics = recover_at(&recovery_root()).map_err(|error| error.message)?;
        *STARTUP_DIAGNOSTICS.lock().map_err(|_| "恢复状态不可用".to_string())? = diagnostics;
        Ok(())
    }).clone()
}

#[tauri::command]
pub async fn read_native_headers(paths: Vec<String>) -> Result<Vec<NativeHeaderResult>, String> {
    if paths.len() > HEADER_BATCH_LIMIT {
        return Err(format!("每次最多读取 {HEADER_BATCH_LIMIT} 个文档头"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                let header = read_header(Path::new(&path)).unwrap_or_default();
                NativeHeaderResult { path, header }
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

fn read_header(path: &Path) -> io::Result<String> {
    let mut reader = BufReader::new(File::open(path)?.take(HEADER_LIMIT + 1));
    let mut bytes = Vec::new();
    reader.read_until(b'\n', &mut bytes)?;
    if bytes != b"#!noteboard 1\n" && bytes != b"#!noteboard 1\r\n" {
        return Ok(String::new());
    }
    let meta_start = bytes.len();
    reader.read_until(b'\n', &mut bytes)?;
    if bytes.len() as u64 > HEADER_LIMIT || !bytes[meta_start..].starts_with(b"@meta ") {
        return Ok(String::new());
    }
    Ok(String::from_utf8(bytes).unwrap_or_default())
}

fn recovery_root() -> PathBuf {
    crate::settings::model::app_data_dir().join("native-recovery")
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct Stamp {
    hash: String,
    size: u64,
    modified_ns: u128,
}

#[derive(Debug, Deserialize, Serialize)]
struct Entry {
    target: PathBuf,
    before: Option<Stamp>,
    after: Option<Stamp>,
    backup: Option<String>,
    staged: Option<PathBuf>,
    #[serde(default)]
    restored: Option<Stamp>,
    #[serde(default)]
    rollback_staged: Option<PathBuf>,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum Phase {
    Prepared,
    Committing,
    RollingBack,
    Committed,
}

#[derive(Debug, Deserialize, Serialize)]
struct Journal {
    version: u8,
    phase: Phase,
    entries: Vec<Entry>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Fault {
    None,
    #[cfg(test)]
    BeforeSecondCommit,
    #[cfg(test)]
    CrashAfterFirstCommit,
    #[cfg(test)]
    CrashDuringRollback,
}

struct Change<'a> {
    target: PathBuf,
    content: Option<&'a str>,
    expected: Option<&'a str>,
    create_only: bool,
    encoding: Encoding,
    eol: Eol,
}

fn save_bundle_at(root: &Path, request: NativeBundleRequest, fault: Fault) -> NativeBundleResult {
    match save_bundle_inner(root, &request, fault) {
        Ok((native, markdown)) => NativeBundleResult {
            ok: true,
            native: Some(native),
            markdown,
            error: None,
        },
        Err(error) => NativeBundleResult::failed(error),
    }
}

fn save_bundle_inner(
    root: &Path,
    request: &NativeBundleRequest,
    fault: Fault,
) -> Result<(SavedFile, Option<SavedFile>), NativeSaveError> {
    if request.markdown.is_some() && request.remove_markdown.is_some() {
        return Err(NativeSaveError::new(
            "invalid-request",
            "不能同时同步并删除 Markdown 文件",
        ));
    }
    let mut changes = vec![Change {
        target: checked_target(&request.path)?,
        content: Some(&request.content),
        expected: request.expected_hash.as_deref(),
        create_only: request.create_only,
        encoding: Encoding::Utf8,
        eol: Eol::Lf,
    }];
    if let Some(markdown) = &request.markdown {
        changes.push(Change {
            target: checked_target(&markdown.path)?,
            content: Some(&markdown.content),
            expected: markdown.expected_hash.as_deref(),
            create_only: false,
            encoding: markdown.encoding.unwrap_or(Encoding::Utf8),
            eol: markdown.eol.unwrap_or(Eol::Lf),
        });
    }
    if let Some(markdown) = &request.remove_markdown {
        changes.push(Change {
            target: checked_target(&markdown.path)?,
            content: None,
            expected: markdown.expected_hash.as_deref(),
            create_only: false,
            encoding: Encoding::Utf8,
            eol: Eol::Lf,
        });
    }
    if changes.len() == 2 && path_key(&changes[0].target) == path_key(&changes[1].target) {
        return Err(NativeSaveError::new(
            "invalid-request",
            "NoteBoard 与 Markdown 不能使用同一个文件路径",
        ));
    }
    let diagnostics = recover_at(root)?;
    if let Some(diagnostic) = diagnostics.iter().find(|diagnostic| {
        diagnostic.path.is_empty()
            || changes
                .iter()
                .any(|change| path_key(&change.target) == path_key(Path::new(&diagnostic.path)))
    }) {
        return Err(NativeSaveError::new(
            "recovery-required",
            diagnostic.message.clone(),
        ));
    }
    fs::create_dir_all(root)?;
    let directory = tempfile::Builder::new()
        .prefix("commit-")
        .tempdir_in(root)?;
    let mut journal = Journal {
        version: 1,
        phase: Phase::Prepared,
        entries: Vec::new(),
    };
    for change in &changes {
        match prepare_entry(directory.path(), journal.entries.len(), change) {
            Ok(entry) => journal.entries.push(entry),
            Err(error) => {
                cleanup_staging(&journal);
                return Err(error);
            }
        }
    }
    if let Err(error) = write_journal(directory.path(), &journal) {
        cleanup_staging(&journal);
        return Err(error);
    }
    // From this point onwards, a crash must leave both the journal and backups.
    let directory = directory.keep();
    let commit = commit_entries(&directory, &mut journal, fault);
    #[cfg(test)]
    if fault == Fault::CrashAfterFirstCommit {
        return Err(NativeSaveError::new("io", "模拟保存中断"));
    }
    if let Err(error) = commit {
        journal.phase = Phase::RollingBack;
        let rollback = write_journal(&directory, &journal)
            .and_then(|_| rollback_entries(&directory, &mut journal, fault));
        return match rollback {
            Ok(()) => {
                cleanup_staging(&journal);
                let _ = fs::remove_dir_all(&directory);
                Err(error)
            }
            Err(recovery_error) => Err(NativeSaveError::new(
                "recovery-required",
                format!(
                    "{}。恢复副本已保留在 {}；{}",
                    error.message,
                    directory.display(),
                    recovery_error.message
                ),
            )),
        };
    }
    let native = saved_file(&journal.entries[0]);
    let markdown = request
        .markdown
        .as_ref()
        .map(|_| saved_file(&journal.entries[1]));
    finish_committed(&directory, &journal);
    Ok((native, markdown))
}

fn checked_target(path: &str) -> Result<PathBuf, NativeSaveError> {
    let path = Path::new(path);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(NativeSaveError::new(
            "invalid-request",
            "保存路径必须是完整文件路径",
        ));
    }
    let parent = fs::canonicalize(path.parent().unwrap())?;
    let target = parent.join(path.file_name().unwrap());
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if !metadata.file_type().is_file() {
            return Err(NativeSaveError::new(
                "invalid-request",
                format!("目标不是普通文件：{}", target.display()),
            ));
        }
    }
    Ok(target)
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    #[cfg(windows)]
    let value = value
        .replace('/', "\\")
        .trim_start_matches("\\\\?\\")
        .to_lowercase();
    value
}

fn prepare_entry(
    directory: &Path,
    index: usize,
    change: &Change<'_>,
) -> Result<Entry, NativeSaveError> {
    let before = stamp_optional(&change.target)?;
    match (&before, change.expected) {
        (Some(_), _) if change.create_only => {
            return Err(NativeSaveError::new(
                "already-exists",
                format!(
                    "目标文件已存在，请选择其它名称：{}",
                    change.target.display()
                ),
            ))
        }
        (Some(_), None) => {
            return Err(NativeSaveError::new(
                "conflict",
                format!(
                    "目标文件已存在，尚未确认其版本，未覆盖：{}",
                    change.target.display()
                ),
            ))
        }
        (None, Some(_)) => return Err(NativeSaveError::conflict(&change.target)),
        (None, None) if change.content.is_none() => {
            return Err(NativeSaveError::conflict(&change.target))
        }
        (Some(_), Some(expected)) => {
            if normalized_text_hash(&change.target)? != expected.to_ascii_lowercase() {
                return Err(NativeSaveError::conflict(&change.target));
            }
        }
        _ => {}
    }
    let backup = before.as_ref().map(|_| format!("before-{index}"));
    if let Some(name) = &backup {
        copy_synced(&change.target, &directory.join(name))?;
        let backed_up = stamp(&directory.join(name))?;
        let original = before.as_ref().unwrap();
        if backed_up.hash != original.hash || backed_up.size != original.size {
            return Err(NativeSaveError::conflict(&change.target));
        }
    }
    let (staged, after) = if let Some(content) = change.content {
        let mut staged = tempfile::Builder::new()
            .prefix(".nb-commit-")
            .tempfile_in(change.target.parent().unwrap())?;
        write_content(staged.as_file_mut(), content, change.encoding, change.eol)?;
        staged.as_file().sync_all()?;
        let (_, path) = staged.keep().map_err(|error| error.error)?;
        let after = match stamp(&path) {
            Ok(after) => after,
            Err(error) => {
                let _ = fs::remove_file(&path);
                return Err(error.into());
            }
        };
        (Some(path), Some(after))
    } else {
        (None, None)
    };
    let entry = Entry {
        target: change.target.clone(),
        before,
        after,
        backup,
        staged,
        restored: None,
        rollback_staged: None,
    };
    if !matches_stamp(&entry.target, &entry.before).unwrap_or(false) {
        if let Some(path) = &entry.staged {
            let _ = fs::remove_file(path);
        }
        return Err(NativeSaveError::conflict(&entry.target));
    }
    Ok(entry)
}

fn commit_entries(
    directory: &Path,
    journal: &mut Journal,
    fault: Fault,
) -> Result<(), NativeSaveError> {
    journal.phase = Phase::Committing;
    write_journal(directory, journal)?;
    for entry in &journal.entries {
        if !matches_stamp(&entry.target, &entry.before)? {
            return Err(NativeSaveError::conflict(&entry.target));
        }
    }
    for (index, entry) in journal.entries.iter().enumerate() {
        #[cfg(test)]
        if index == 1 && fault == Fault::BeforeSecondCommit {
            return Err(NativeSaveError::new("io", "模拟第二份文件保存失败"));
        }
        let _ = (index, fault);
        if !matches_stamp(&entry.target, &entry.before)? {
            return Err(NativeSaveError::conflict(&entry.target));
        }
        if let Some(staged) = &entry.staged {
            if !matches_stamp(staged, &entry.after)? {
                return Err(NativeSaveError::new("io", "待保存文件的完整性检查失败"));
            }
            persist_staged(staged, &entry.target, entry.before.is_none())?;
        } else {
            // The synced backup and its journal are already durable in the app
            // recovery directory. Keep them after success so source removal is reversible.
            fs::remove_file(&entry.target)?;
        }
        sync_parent(&entry.target)?;
        #[cfg(test)]
        if index == 0 && fault == Fault::CrashAfterFirstCommit {
            return Err(NativeSaveError::new("io", "模拟保存中断"));
        }
    }
    for entry in &journal.entries {
        if !matches_stamp(&entry.target, &entry.after)? {
            return Err(NativeSaveError::conflict(&entry.target));
        }
    }
    #[cfg(test)]
    if fault == Fault::CrashDuringRollback {
        return Err(NativeSaveError::new("io", "模拟提交确认失败"));
    }
    journal.phase = Phase::Committed;
    write_journal(directory, journal)
}

fn persist_staged(staged: &Path, target: &Path, create_only: bool) -> Result<(), NativeSaveError> {
    let temporary = tempfile::TempPath::try_from_path(staged).map_err(NativeSaveError::from)?;
    if create_only {
        temporary.persist_noclobber(target).map_err(|error| {
            NativeSaveError::new(
                "conflict",
                format!(
                    "目标文件在保存期间已存在，未覆盖：{}（{}）",
                    target.display(),
                    error.error
                ),
            )
        })?;
    } else {
        temporary
            .persist(target)
            .map_err(|error| NativeSaveError::from(error.error))?;
    }
    Ok(())
}

fn rollback_entries(
    directory: &Path,
    journal: &mut Journal,
    fault: Fault,
) -> Result<(), NativeSaveError> {
    // Preflight the complete set before restoring anything. An external edit on
    // either side requires manual recovery, preserving all current files.
    for entry in &journal.entries {
        let current = stamp_optional(&entry.target)?;
        if current != entry.before
            && current != entry.after
            && !(entry.restored.is_some() && current == entry.restored)
        {
            return Err(NativeSaveError::new(
                "recovery-required",
                format!(
                    "文件在保存中断后又被修改，未覆盖现有内容：{}",
                    entry.target.display()
                ),
            ));
        }
    }
    journal.phase = Phase::RollingBack;
    write_journal(directory, journal)?;
    for index in (0..journal.entries.len()).rev() {
        let entry = &journal.entries[index];
        if matches_stamp(&entry.target, &entry.before)?
            || (entry.restored.is_some() && matches_stamp(&entry.target, &entry.restored)?)
        {
            continue;
        }
        if !matches_stamp(&entry.target, &entry.after)? {
            return Err(NativeSaveError::conflict(&entry.target));
        }
        if let Some(backup) = &entry.backup {
            let backup = directory.join(backup);
            let expected = entry
                .before
                .as_ref()
                .ok_or_else(|| NativeSaveError::new("io", "恢复记录缺少原始版本"))?;
            let actual = stamp(&backup)?;
            if actual.hash != expected.hash || actual.size != expected.size {
                return Err(NativeSaveError::new("io", "恢复副本的完整性检查失败"));
            }
            let mut temporary = tempfile::Builder::new()
                .prefix(".nb-restore-")
                .tempfile_in(entry.target.parent().unwrap())?;
            io::copy(&mut File::open(backup)?, temporary.as_file_mut())?;
            temporary.as_file().sync_all()?;
            if !matches_stamp(&entry.target, &entry.after)? {
                return Err(NativeSaveError::conflict(&entry.target));
            }
            let (_, staged) = temporary
                .keep()
                .map_err(|error| NativeSaveError::from(error.error))?;
            let restored = stamp(&staged)?;
            // Record the exact restoration version before the rename so a
            // second interruption cannot mistake our restored file for an edit.
            let entry = &mut journal.entries[index];
            if let Some(previous) = &entry.rollback_staged {
                if matches_stamp(previous, &entry.restored).unwrap_or(false) {
                    let _ = fs::remove_file(previous);
                }
            }
            entry.rollback_staged = Some(staged.clone());
            entry.restored = Some(restored);
            write_journal(directory, journal)?;
            let entry = &journal.entries[index];
            if !matches_stamp(&entry.target, &entry.after)? {
                return Err(NativeSaveError::conflict(&entry.target));
            }
            persist_staged(&staged, &entry.target, entry.after.is_none())?;
        } else {
            fs::remove_file(&entry.target)?;
        }
        sync_parent(&journal.entries[index].target)?;
        #[cfg(test)]
        if fault == Fault::CrashDuringRollback {
            return Err(NativeSaveError::new("io", "模拟回滚中断"));
        }
        let _ = fault;
    }
    Ok(())
}

fn recover_at(root: &Path) -> Result<Vec<RecoveryDiagnostic>, NativeSaveError> {
    let mut diagnostics = Vec::new();
    if !root.exists() {
        return Ok(diagnostics);
    }
    for item in fs::read_dir(root)? {
        let item = item?;
        if !item.file_type()?.is_dir() || !item.file_name().to_string_lossy().starts_with("commit-")
        {
            continue;
        }
        let directory = item.path();
        let journal_path = directory.join("journal.json");
        if !journal_path.exists() {
            continue;
        }
        let mut journal: Journal = match File::open(&journal_path).and_then(|file| {
            serde_json::from_reader::<_, Journal>(file.take(1024 * 1024)).map_err(io::Error::other)
        }) {
            Ok(journal) if journal.version == 1 && journal.entries.len() <= 2 => journal,
            _ => {
                diagnostics.push(RecoveryDiagnostic {
                    path: String::new(),
                    message: format!("恢复记录无法读取，请检查 {}", directory.display()),
                });
                continue;
            }
        };
        if journal.phase == Phase::Committed {
            finish_committed(&directory, &journal);
            continue;
        }
        match rollback_entries(&directory, &mut journal, Fault::None) {
            Ok(()) => {
                cleanup_staging(&journal);
                let _ = fs::remove_dir_all(&directory);
            }
            Err(error) => {
                for entry in &journal.entries {
                    diagnostics.push(RecoveryDiagnostic {
                        path: entry.target.to_string_lossy().to_string(),
                        message: format!(
                            "{}；恢复副本保留在 {}",
                            error.message,
                            directory.display()
                        ),
                    });
                }
            }
        }
    }
    Ok(diagnostics)
}

fn finish_committed(directory: &Path, journal: &Journal) {
    cleanup_staging(journal);
    if journal.entries.iter().any(|entry| entry.after.is_none()) {
        // Retain only the removed source and the small receipt; successful
        // ordinary saves do not accumulate recovery files.
        for entry in &journal.entries {
            if entry.after.is_some() {
                if let Some(backup) = &entry.backup {
                    let _ = fs::remove_file(directory.join(backup));
                }
            }
        }
        if let (Some(root), Some(name)) = (directory.parent(), directory.file_name()) {
            let archive = root.join("removed-sources");
            if fs::create_dir_all(&archive).is_ok() {
                let _ = fs::rename(directory, archive.join(name));
            }
        }
    } else {
        let _ = fs::remove_dir_all(directory);
    }
}

fn cleanup_staging(journal: &Journal) {
    for entry in &journal.entries {
        if let Some(staged) = &entry.staged {
            if matches_stamp(staged, &entry.after).unwrap_or(false) {
                let _ = fs::remove_file(staged);
            }
        }
        if let Some(staged) = &entry.rollback_staged {
            if matches_stamp(staged, &entry.restored).unwrap_or(false) {
                let _ = fs::remove_file(staged);
            }
        }
    }
}

fn write_journal(directory: &Path, journal: &Journal) -> Result<(), NativeSaveError> {
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    serde_json::to_writer(file.as_file_mut(), journal)
        .map_err(|error| NativeSaveError::new("io", error.to_string()))?;
    file.as_file().sync_all()?;
    file.persist(directory.join("journal.json"))
        .map_err(|error| NativeSaveError::from(error.error))?;
    sync_parent(&directory.join("journal.json"))?;
    Ok(())
}

fn sync_parent(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    File::open(path.parent().unwrap())?.sync_all()?;
    let _ = path;
    Ok(())
}

fn copy_synced(source: &Path, destination: &Path) -> io::Result<()> {
    let mut output = File::create_new(destination)?;
    io::copy(&mut File::open(source)?, &mut output)?;
    output.sync_all()
}

fn stamp(path: &Path) -> io::Result<Stamp> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::other("目标不是普通文件"));
    }
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 32 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(Stamp {
        hash: format!("{:x}", hash.finalize()),
        size: metadata.len(),
        modified_ns: metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    })
}

fn stamp_optional(path: &Path) -> io::Result<Option<Stamp>> {
    match stamp(path) {
        Ok(stamp) => Ok(Some(stamp)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn matches_stamp(path: &Path, expected: &Option<Stamp>) -> io::Result<bool> {
    Ok(stamp_optional(path)? == *expected)
}

fn saved_file(entry: &Entry) -> SavedFile {
    let stamp = entry.after.as_ref().expect("saved file has staged data");
    SavedFile {
        mtime: (stamp.modified_ns / 1_000_000) as i64,
        size: stamp.size,
    }
}

fn write_content(
    output: &mut File,
    content: &str,
    encoding: Encoding,
    eol: Eol,
) -> Result<(), NativeSaveError> {
    if encoding == Encoding::Utf8Bom {
        output.write_all(&[0xef, 0xbb, 0xbf])?;
    }
    let mut buffer = String::with_capacity(16 * 1024);
    let mut chars = content.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\r' || character == '\n' {
            if character == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            if eol == Eol::Crlf {
                buffer.push('\r');
            }
            buffer.push('\n');
        } else {
            buffer.push(character);
        }
        if buffer.len() >= 16 * 1024 {
            write_encoded(output, &buffer, encoding)?;
            buffer.clear();
        }
    }
    write_encoded(output, &buffer, encoding)
}

fn write_encoded(
    output: &mut File,
    content: &str,
    encoding: Encoding,
) -> Result<(), NativeSaveError> {
    if encoding == Encoding::Gbk {
        let (bytes, _, errors) = encoding_rs::GBK.encode(content);
        if errors {
            return Err(NativeSaveError::new(
                "encoding",
                "内容包含 GBK 无法表示的字符，请先将 Markdown 编码改为 UTF-8",
            ));
        }
        output.write_all(&bytes)?;
    } else {
        output.write_all(content.as_bytes())?;
    }
    Ok(())
}

/// Matches read::decode_bytes followed by CRLF/CR normalization, without holding
/// another full decoded file or raw byte buffer in memory.
fn normalized_text_hash(path: &Path) -> io::Result<String> {
    let mut detector = chardetng::EncodingDetector::new();
    let mut utf8 = encoding_rs::UTF_8.new_decoder_without_bom_handling();
    let mut utf8_errors = false;
    let mut first = true;
    let mut bom = false;
    let mut input = [0u8; 32 * 1024];
    let mut output = [0u8; 64 * 1024];
    let mut file = File::open(path)?;
    loop {
        let count = file.read(&mut input)?;
        if first {
            bom = count >= 3 && input[..3] == [0xef, 0xbb, 0xbf];
            first = false;
        }
        detector.feed(&input[..count], count == 0);
        let mut offset = 0;
        loop {
            let (result, read, _, errors) =
                utf8.decode_to_utf8(&input[offset..count], &mut output, count == 0);
            utf8_errors |= errors;
            offset += read;
            if result == encoding_rs::CoderResult::InputEmpty {
                break;
            }
        }
        if count == 0 {
            break;
        }
    }
    let encoding = if bom || !utf8_errors {
        encoding_rs::UTF_8
    } else {
        let guessed = detector.guess(None, true);
        if guessed == encoding_rs::GB18030 {
            encoding_rs::GBK
        } else {
            guessed
        }
    };
    let mut decoder = encoding.new_decoder_without_bom_handling();
    let mut reader = File::open(path)?;
    if bom {
        reader.read_exact(&mut [0u8; 3])?;
    }
    let mut hash = Sha256::new();
    let mut after_cr = false;
    loop {
        let count = reader.read(&mut input)?;
        let mut offset = 0;
        loop {
            let (result, read, written, _) =
                decoder.decode_to_utf8(&input[offset..count], &mut output, count == 0);
            offset += read;
            let bytes = &output[..written];
            let mut start = 0;
            for (index, byte) in bytes.iter().copied().enumerate() {
                if byte == b'\r' || (after_cr && byte == b'\n') {
                    hash.update(&bytes[start..index]);
                    if byte == b'\r' {
                        hash.update(b"\n");
                    }
                    start = index + 1;
                }
                after_cr = byte == b'\r';
            }
            hash.update(&bytes[start..]);
            if result == encoding_rs::CoderResult::InputEmpty {
                break;
            }
        }
        if count == 0 {
            break;
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(content: &str) -> String {
        format!("{:x}", Sha256::digest(content.as_bytes()))
    }

    fn request(native: &Path, markdown: &Path) -> NativeBundleRequest {
        NativeBundleRequest {
            path: native.to_string_lossy().into_owned(),
            content: "new native\r\n".into(),
            expected_hash: Some(hash("old native\n")),
            create_only: false,
            markdown: Some(MarkdownWrite {
                path: markdown.to_string_lossy().into_owned(),
                content: "new markdown\n".into(),
                expected_hash: Some(hash("old markdown\n")),
                encoding: Some(Encoding::Utf8Bom),
                eol: Some(Eol::Crlf),
            }),
            remove_markdown: None,
        }
    }

    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let native = directory.path().join("note.nb");
        let markdown = directory.path().join("note.md");
        let recovery = directory.path().join("recovery");
        fs::write(&native, "old native\n").unwrap();
        fs::write(&markdown, "old markdown\r\n").unwrap();
        (directory, native, markdown, recovery)
    }

    #[test]
    fn saves_pair_and_preserves_markdown_encoding_and_eol() {
        let (_directory, native, markdown, recovery) = fixture();
        let result = save_bundle_at(&recovery, request(&native, &markdown), Fault::None);
        assert!(result.ok, "{:?}", result.error);
        assert_eq!(fs::read(&native).unwrap(), b"new native\n");
        assert_eq!(
            fs::read(&markdown).unwrap(),
            b"\xef\xbb\xbfnew markdown\r\n"
        );
        assert!(result.native.is_some() && result.markdown.is_some());
        assert_eq!(fs::read_dir(recovery).unwrap().count(), 0);
    }

    #[test]
    fn external_markdown_edit_rejects_entire_pair() {
        let (_directory, native, markdown, recovery) = fixture();
        fs::write(&markdown, "external edit").unwrap();
        let result = save_bundle_at(&recovery, request(&native, &markdown), Fault::None);
        assert_eq!(result.error.unwrap().code, "conflict");
        assert_eq!(fs::read_to_string(native).unwrap(), "old native\n");
        assert_eq!(fs::read_to_string(markdown).unwrap(), "external edit");
    }

    #[test]
    fn create_only_and_unknown_existing_targets_never_overwrite() {
        let (_directory, native, markdown, recovery) = fixture();
        let mut save = request(&native, &markdown);
        save.create_only = true;
        assert_eq!(
            save_bundle_at(&recovery, save, Fault::None)
                .error
                .unwrap()
                .code,
            "already-exists"
        );
        let mut save = request(&native, &markdown);
        save.markdown.as_mut().unwrap().expected_hash = None;
        assert_eq!(
            save_bundle_at(&recovery, save, Fault::None)
                .error
                .unwrap()
                .code,
            "conflict"
        );
        assert_eq!(fs::read_to_string(native).unwrap(), "old native\n");
    }

    #[test]
    fn second_write_failure_rolls_back_first_write() {
        let (_directory, native, markdown, recovery) = fixture();
        let result = save_bundle_at(
            &recovery,
            request(&native, &markdown),
            Fault::BeforeSecondCommit,
        );
        assert!(!result.ok);
        assert_eq!(fs::read_to_string(native).unwrap(), "old native\n");
        assert_eq!(fs::read_to_string(markdown).unwrap(), "old markdown\r\n");
        assert!(recover_at(&recovery).unwrap().is_empty());
    }

    #[test]
    fn crash_recovers_pair_and_does_not_overwrite_later_external_writes() {
        let (_directory, native, markdown, recovery) = fixture();
        let result = save_bundle_at(
            &recovery,
            request(&native, &markdown),
            Fault::CrashAfterFirstCommit,
        );
        assert!(!result.ok);
        assert_eq!(fs::read_to_string(&native).unwrap(), "new native\n");
        assert!(recover_at(&recovery).unwrap().is_empty());
        assert_eq!(fs::read_to_string(&native).unwrap(), "old native\n");
        save_bundle_at(
            &recovery,
            request(&native, &markdown),
            Fault::CrashAfterFirstCommit,
        );
        fs::write(&native, "later external content").unwrap();
        let diagnostics = recover_at(&recovery).unwrap();
        assert!(!diagnostics.is_empty());
        assert_eq!(
            fs::read_to_string(&native).unwrap(),
            "later external content"
        );
        assert_eq!(fs::read_to_string(&markdown).unwrap(), "old markdown\r\n");
    }

    #[test]
    fn interruption_during_rollback_resumes_using_exact_restored_version() {
        let (_directory, native, markdown, recovery) = fixture();
        let result = save_bundle_at(
            &recovery,
            request(&native, &markdown),
            Fault::CrashDuringRollback,
        );
        assert!(!result.ok);
        assert_eq!(fs::read_to_string(&native).unwrap(), "new native\n");
        assert_eq!(fs::read_to_string(&markdown).unwrap(), "old markdown\r\n");
        assert!(recover_at(&recovery).unwrap().is_empty());
        assert_eq!(fs::read_to_string(&native).unwrap(), "old native\n");
        assert_eq!(fs::read_dir(&recovery).unwrap().count(), 0);
    }

    #[test]
    fn source_removal_waits_for_native_commit_and_retains_recoverable_copy() {
        let (_directory, native, markdown, recovery) = fixture();
        let removal = || {
            let mut save = request(&native, &markdown);
            save.markdown = None;
            save.remove_markdown = Some(MarkdownRemoval {
                path: markdown.to_string_lossy().into_owned(),
                expected_hash: Some(hash("old markdown\n")),
            });
            save
        };
        assert!(!save_bundle_at(&recovery, removal(), Fault::BeforeSecondCommit).ok);
        assert!(markdown.exists());
        assert_eq!(fs::read_to_string(&native).unwrap(), "old native\n");
        assert!(save_bundle_at(&recovery, removal(), Fault::None).ok);
        assert!(!markdown.exists());
        let directory = fs::read_dir(recovery.join("removed-sources"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read_to_string(directory.join("before-1")).unwrap(),
            "old markdown\r\n"
        );
        assert!(recover_at(&recovery).unwrap().is_empty());
        assert!(!markdown.exists());
    }

    #[test]
    fn hash_matches_reader_for_encodings_and_chunk_boundary_line_endings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.md");
        for encoding in [Encoding::Utf8, Encoding::Utf8Bom, Encoding::Gbk] {
            let mut file = File::create(&path).unwrap();
            let content = format!("{}\r\n中文\r尾部\n", "x".repeat(32767));
            write_content(&mut file, &content, encoding, Eol::Crlf).unwrap();
            drop(file);
            let decoded = super::super::read::read_file(&path)
                .unwrap()
                .content
                .replace("\r\n", "\n")
                .replace('\r', "\n");
            assert_eq!(normalized_text_hash(&path).unwrap(), hash(&decoded));
        }
    }

    #[test]
    fn header_scan_is_bounded_and_never_returns_document_body() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("document.nb");
        fs::write(
            &path,
            format!(
                "#!noteboard 1\n@meta {{\"id\":\"one\"}}\n{}",
                "body".repeat(100_000)
            ),
        )
        .unwrap();
        assert_eq!(
            read_header(&path).unwrap(),
            "#!noteboard 1\n@meta {\"id\":\"one\"}\n"
        );
        fs::write(
            &path,
            format!("#!noteboard 1\n@meta {}", "x".repeat(HEADER_LIMIT as usize)),
        )
        .unwrap();
        assert_eq!(read_header(&path).unwrap(), "");
    }
}
