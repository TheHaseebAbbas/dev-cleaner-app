//! Path safety: normalisation, component-aware containment, system folders, links and mount
//! points, sensitive file names and scan-time fingerprints.

use crate::model::{Block, BlockSource, Fingerprint};
use std::path::{Component, Path, PathBuf};

/// Windows and macOS file systems are case-insensitive by default.
const CASE_INSENSITIVE: bool = cfg!(any(windows, target_os = "macos"));

/// Lexically resolve `.` and `..` and drop trailing separators, without touching the disk.
pub fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                // Never climb above the root or a drive prefix.
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Strip the `\\?\` prefix `canonicalize` adds on Windows (but keep `\\?\UNC\`).
fn simplify_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if !rest.starts_with("UNC\\") {
            return PathBuf::from(rest);
        }
    }
    p
}

/// The real path when it exists (links resolved), otherwise the lexical normal form.
pub fn normalize(path: &Path) -> PathBuf {
    match std::fs::canonicalize(path) {
        Ok(p) => simplify_verbatim(p),
        Err(_) => lexical(path),
    }
}

fn key(c: Component) -> String {
    let s = c.as_os_str().to_string_lossy();
    if CASE_INSENSITIVE { s.to_lowercase() } else { s.into_owned() }
}

fn keys(p: &Path) -> Vec<String> {
    lexical(p).components().map(key).collect()
}

/// `path` equals `base` or lies inside it, compared component by component (so `C:\App` does not
/// contain `C:\Application`), after normalisation, ignoring case where the OS does.
pub fn is_within(path: &Path, base: &Path) -> bool {
    let (p, b) = (keys(path), keys(base));
    !b.is_empty() && p.len() >= b.len() && p[..b.len()] == b[..]
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    keys(a) == keys(b)
}

/// Compare using both the path as given and its resolved form, so a symlinked parent cannot hide
/// a protected folder.
pub fn within_any(path: &Path, bases: &[PathBuf]) -> Option<PathBuf> {
    let real = normalize(path);
    bases.iter().find(|b| {
        let rb = normalize(b);
        is_within(path, b) || is_within(&real, &rb) || is_within(path, &rb) || is_within(&real, b)
    }).cloned()
}

/// A protected path that lies *inside* `path` (deleting `path` would delete it too).
pub fn contains_any(path: &Path, bases: &[PathBuf]) -> Option<PathBuf> {
    let real = normalize(path);
    bases.iter().find(|b| {
        let rb = normalize(b);
        (is_within(b, path) || is_within(&rb, &real)) && !same_path(b, path) && !same_path(&rb, &real)
    }).cloned()
}

/// Folders whose contents Dev Cleaner never removes, whatever a rule or scan says.
fn system_trees() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = if cfg!(windows) {
        let win = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let mut v = vec![win];
        for k in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"] {
            if let Some(p) = std::env::var_os(k) {
                v.push(PathBuf::from(p));
            }
        }
        v.extend([r"C:\Program Files", r"C:\Program Files (x86)", r"C:\ProgramData"].map(PathBuf::from));
        v
    } else {
        ["/bin", "/sbin", "/usr", "/etc", "/boot", "/dev", "/proc", "/sys", "/lib", "/lib32", "/lib64", "/System", "/Library", "/Applications", "/private/etc", "/private/var/db"]
            .into_iter()
            .map(PathBuf::from)
            .collect()
    };
    if let Some(h) = dirs::home_dir() {
        for d in [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".password-store", ".config/gcloud", ".config/gh", "Library/Keychains"] {
            v.push(h.join(d));
        }
    }
    v
}

/// Folders that must never be deleted themselves (nor anything that contains them), although
/// specific things inside them may be cleanable.
fn system_roots() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = if cfg!(windows) {
        vec![PathBuf::from(r"C:\Users")]
    } else {
        ["/", "/var", "/opt", "/home", "/Users", "/tmp", "/private", "/private/var", "/srv", "/mnt", "/media", "/Volumes", "/root"].into_iter().map(PathBuf::from).collect()
    };
    if let Some(h) = dirs::home_dir() {
        v.push(h.clone());
        for d in [
            "Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", "Movies", "Public", "OneDrive",
            "AppData", "AppData/Local", "AppData/Roaming", "AppData/LocalLow", "Library", "Library/Application Support",
            "Library/Caches", "Library/Developer", ".config", ".local", ".local/share", ".cache", "Android", ".android",
            ".gradle", ".cargo", ".rustup", "code", "dev", "src", "projects", "Projects", "development",
        ] {
            v.push(h.join(d));
        }
    }
    for p in [dirs::document_dir(), dirs::download_dir(), dirs::desktop_dir(), dirs::picture_dir(), dirs::video_dir(), dirs::audio_dir(), dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir(), dirs::cache_dir()].into_iter().flatten() {
        v.push(p);
    }
    v
}

/// Refuses system folders, personal folders and anything containing them.
pub fn system_block(path: &Path) -> Option<Block> {
    if let Some(t) = within_any(path, &system_trees()) {
        return Some(Block::new(BlockSource::System, format!("Inside a system or credentials folder ({}).", t.display())));
    }
    let real = normalize(path);
    for r in system_roots() {
        if is_within(&r, path) || is_within(&r, &real) || is_within(&normalize(&r), &real) {
            return Some(Block::new(BlockSource::System, format!("This is, or contains, a system or personal folder ({}).", r.display())));
        }
    }
    None
}

/// What kind of link or redirection a path is, if any.
pub fn redirection(path: &Path) -> Option<&'static str> {
    let md = std::fs::symlink_metadata(path).ok()?;
    if md.file_type().is_symlink() {
        return Some("symlink");
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Some("junction or reparse point");
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Some(parent) = path.parent() {
            if let Ok(pm) = std::fs::symlink_metadata(parent) {
                if pm.dev() != md.dev() {
                    return Some("mount point");
                }
            }
        }
    }
    None
}

pub fn mtime_secs(md: &std::fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn fingerprint(path: &Path) -> Option<Fingerprint> {
    let md = std::fs::symlink_metadata(path).ok()?;
    #[cfg(unix)]
    let (file_id, device) = {
        use std::os::unix::fs::MetadataExt;
        (md.ino(), md.dev())
    };
    #[cfg(not(unix))]
    let (file_id, device) = (0u64, 0u64);
    Some(Fingerprint {
        canonical: normalize(path).to_string_lossy().into_owned(),
        file_id,
        device,
        mtime: mtime_secs(&md),
        is_dir: md.is_dir(),
    })
}

/// Why the folder differs from what the scan saw, or `None` when it is unchanged.
pub fn fingerprint_changed(then: &Fingerprint, path: &Path) -> Option<String> {
    let Some(now) = fingerprint(path) else { return Some("it no longer exists".into()) };
    if now.is_dir != then.is_dir {
        return Some("it is no longer the same kind of entry".into());
    }
    if !same_path(Path::new(&now.canonical), Path::new(&then.canonical)) {
        return Some(format!("it now resolves to {}", now.canonical));
    }
    if then.file_id != 0 && (now.file_id != then.file_id || now.device != then.device) {
        return Some("it was replaced by a different folder".into());
    }
    if now.mtime != then.mtime {
        return Some("files were added or removed inside it".into());
    }
    None
}

/// Signing material: unique, often impossible to recreate.
const SIGNING: &[&str] = &[".jks", ".keystore", ".p12", ".pfx", ".p8", ".mobileprovision", ".provisionprofile"];
const SIGNING_NAMES: &[&str] = &["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];
/// Secrets that usually also exist elsewhere, but must never be removed unnoticed.
const SECRET_EXT: &[&str] = &[".pem", ".key"];
const SECRET_NAMES: &[&str] = &[".env", "credentials.json", ".npmrc", ".pypirc", ".netrc"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sensitive {
    Signing,
    Secret,
}

/// Classify a file by name only (contents are never read).
pub fn sensitive_name(name: &str) -> Option<Sensitive> {
    let lower = name.to_lowercase();
    if SIGNING.iter().any(|e| lower.ends_with(e)) || SIGNING_NAMES.contains(&lower.as_str()) {
        return Some(Sensitive::Signing);
    }
    let env_file = lower == ".env" || (lower.starts_with(".env.") && !["example", "sample", "template", "dist", "defaults"].iter().any(|s| lower.ends_with(s)));
    if env_file || SECRET_NAMES.contains(&lower.as_str()) || SECRET_EXT.iter().any(|e| lower.ends_with(e)) || (lower.starts_with("service-account") && lower.ends_with(".json")) {
        return Some(Sensitive::Secret);
    }
    None
}
