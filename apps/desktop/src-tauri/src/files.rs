//! Attachments: files stored by the hash of their content, outside the database.
//!
//! The database keeps the metadata (name, hash, size); the bytes live in
//! `attachments/<aa>/<hash>`. Identical files are stored once and a stored file can be
//! re-hashed at any time to prove it has not changed.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::keystore::hex;

pub const MAX_ATTACHMENT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct StoredFile {
    pub hash: String,
    pub size_bytes: u64,
    pub name: String,
    /// False when an identical file was already stored.
    pub is_new: bool,
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub fn stored_path(dir: &Path, hash: &str) -> Result<PathBuf, String> {
    if !is_hash(hash) {
        return Err("invalid attachment hash".into());
    }
    Ok(dir.join("attachments").join(&hash[..2]).join(hash))
}

/// Copies `source` into the store. The content is hashed while it is copied.
pub fn store(dir: &Path, source: &Path) -> Result<StoredFile, String> {
    let meta = std::fs::metadata(source).map_err(|e| format!("cannot read the file: {e}"))?;
    if !meta.is_file() {
        return Err("only regular files can be attached".into());
    }
    if meta.len() > MAX_ATTACHMENT_BYTES {
        return Err("the file is larger than 512 MB".into());
    }
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or("the file has no name")?;

    let staging_dir = dir.join("attachments").join(".staging");
    std::fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    let staging = staging_dir.join(format!("{}.part", crate::keystore::generate_key_hex()?));

    let mut input =
        std::fs::File::open(source).map_err(|e| format!("cannot open the file: {e}"))?;
    let mut output = std::fs::File::create(&staging).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        size += n as u64;
    }
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);

    let hash = hex(&hasher.finalize());
    let target = stored_path(dir, &hash)?;
    let is_new = !target.exists();
    if is_new {
        std::fs::create_dir_all(target.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
        std::fs::rename(&staging, &target).map_err(|e| e.to_string())?;
    } else {
        let _ = std::fs::remove_file(&staging);
    }
    Ok(StoredFile {
        hash,
        size_bytes: size,
        name,
        is_new,
    })
}

/// Re-hashes the stored bytes: true when they still match their name.
pub fn verify(dir: &Path, hash: &str) -> Result<bool, String> {
    let mut file = std::fs::File::open(stored_path(dir, hash)?).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex(&hasher.finalize()) == hash)
}

/// Copies a stored file to `dest` (a path the user chose).
pub fn export(dir: &Path, hash: &str, dest: &Path) -> Result<(), String> {
    std::fs::copy(stored_path(dir, hash)?, dest)
        .map(|_| ())
        .map_err(|e| format!("cannot export the file: {e}"))
}

/// A file name that is safe to create: no directories, no characters Windows refuses.
pub fn safe_name(name: &str) -> String {
    let base = Path::new(name)
        .components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .next_back()
        .unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        "file".into()
    } else {
        trimmed
    }
}

pub fn delete(dir: &Path, hash: &str) -> Result<(), String> {
    match std::fs::remove_file(stored_path(dir, hash)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(dir: &Path, name: &str, content: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn a_file_is_stored_under_the_hash_of_its_content() {
        let data = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        let file = sample(src.path(), "contratto.pdf", b"hello");
        let stored = store(data.path(), &file).unwrap();
        // SHA-256("hello")
        assert_eq!(
            stored.hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(
            (stored.size_bytes, stored.name.as_str(), stored.is_new),
            (5, "contratto.pdf", true)
        );
        assert_eq!(
            std::fs::read(stored_path(data.path(), &stored.hash).unwrap()).unwrap(),
            b"hello"
        );
        assert!(verify(data.path(), &stored.hash).unwrap());
    }

    #[test]
    fn identical_files_are_stored_once() {
        let data = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        let a = store(data.path(), &sample(src.path(), "a.txt", b"same")).unwrap();
        let b = store(data.path(), &sample(src.path(), "b.txt", b"same")).unwrap();
        assert_eq!(a.hash, b.hash);
        assert!(a.is_new && !b.is_new);
        assert!(
            !data
                .path()
                .join("attachments/.staging")
                .read_dir()
                .unwrap()
                .any(|_| true),
            "no staging files left"
        );
    }

    #[test]
    fn tampering_with_a_stored_file_is_detected() {
        let data = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        let stored = store(data.path(), &sample(src.path(), "a.txt", b"original")).unwrap();
        std::fs::write(stored_path(data.path(), &stored.hash).unwrap(), b"changed").unwrap();
        assert!(!verify(data.path(), &stored.hash).unwrap());
    }

    #[test]
    fn hashes_that_could_escape_the_store_are_refused() {
        let data = tempfile::tempdir().unwrap();
        for bad in [
            "",
            "../../etc/passwd",
            &"A".repeat(64),
            &"g".repeat(64),
            &"a".repeat(63),
        ] {
            assert!(
                stored_path(data.path(), bad).is_err(),
                "must refuse {bad:?}"
            );
        }
    }

    #[test]
    fn directories_and_missing_files_cannot_be_attached() {
        let data = tempfile::tempdir().unwrap();
        assert!(store(data.path(), data.path()).is_err());
        assert!(store(data.path(), &data.path().join("nope")).is_err());
    }

    #[test]
    fn export_and_delete() {
        let data = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();
        let stored = store(data.path(), &sample(src.path(), "a.txt", b"bytes")).unwrap();
        let out = src.path().join("copy.txt");
        export(data.path(), &stored.hash, &out).unwrap();
        assert_eq!(std::fs::read(out).unwrap(), b"bytes");
        delete(data.path(), &stored.hash).unwrap();
        delete(data.path(), &stored.hash).unwrap(); // deleting twice is fine
        assert!(verify(data.path(), &stored.hash).is_err());
    }

    #[test]
    fn names_are_made_safe_for_every_platform() {
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("a<b>:c|d?.pdf"), "a_b__c_d_.pdf");
        assert_eq!(safe_name("..."), "file");
        assert_eq!(safe_name(""), "file");
        assert_eq!(safe_name("fattura 2026.pdf"), "fattura 2026.pdf");
    }
}
