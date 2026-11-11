//! Where the database encryption key lives.
//!
//! The key is 256 random bits, generated on first run and kept in the operating system's
//! credential store (Windows Credential Manager, macOS Keychain). It never touches the
//! database file, so a copied `vyrion.db` is unreadable on any other machine or account.

use std::path::{Path, PathBuf};

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub const SERVICE: &str = "com.vyrncore.vyrion-erp";
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub const ACCOUNT: &str = "database-key";

pub trait KeyStore: Send + Sync {
    fn name(&self) -> &'static str;
    /// The stored key as 64 hex characters, or `None` if nothing is stored yet.
    fn load(&self) -> Result<Option<String>, String>;
    fn store(&self, key_hex: &str) -> Result<(), String>;
}

/// 32 random bytes from the operating system, hex encoded.
pub fn generate_key_hex() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("cannot gather randomness: {e}"))?;
    Ok(hex(&bytes))
}

pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
            let _ = write!(out, "{b:02x}");
            out
        })
}

pub fn is_valid_key_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A key kept in a file readable only by the owner. Used where no credential store is
/// available (development on Linux) and in tests.
pub struct FileKeyStore {
    path: PathBuf,
}

impl FileKeyStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }
}

impl KeyStore for FileKeyStore {
    fn name(&self) -> &'static str {
        "file"
    }

    fn load(&self) -> Result<Option<String>, String> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => {
                let key = text.trim().to_string();
                if is_valid_key_hex(&key) {
                    Ok(Some(key))
                } else {
                    Err(format!("the key file {} is corrupt", self.path.display()))
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("cannot read the key file: {e}")),
        }
    }

    fn store(&self, key_hex: &str) -> Result<(), String> {
        use std::io::Write;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&self.path)
            .map_err(|e| format!("cannot create the key file: {e}"))?;
        file.write_all(key_hex.as_bytes())
            .map_err(|e| format!("cannot write the key file: {e}"))
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub struct OsKeyStore;

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl OsKeyStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("credential store: {e}"))
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl KeyStore for OsKeyStore {
    fn name(&self) -> &'static str {
        "os"
    }

    fn load(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(key) if is_valid_key_hex(&key) => Ok(Some(key)),
            Ok(_) => Err("the key in the credential store is corrupt".into()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("cannot read the credential store: {e}")),
        }
    }

    fn store(&self, key_hex: &str) -> Result<(), String> {
        Self::entry()?
            .set_password(key_hex)
            .map_err(|e| format!("cannot write the credential store: {e}"))
    }
}

/// The key store the application uses on this platform.
pub fn platform_key_store(data_dir: &Path) -> Box<dyn KeyStore> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        let _ = data_dir;
        Box::new(OsKeyStore)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Box::new(FileKeyStore::new(data_dir.join("database.key")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_are_valid_and_unique() {
        let a = generate_key_hex().unwrap();
        let b = generate_key_hex().unwrap();
        assert!(is_valid_key_hex(&a));
        assert_ne!(a, b);
    }

    #[test]
    fn key_validation() {
        assert!(!is_valid_key_hex(""));
        assert!(!is_valid_key_hex(&"a".repeat(63)));
        assert!(!is_valid_key_hex(&"g".repeat(64)));
        assert!(is_valid_key_hex(&"aB".repeat(32)));
    }

    #[test]
    fn file_store_roundtrip_and_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path().join("k"));
        assert_eq!(store.load().unwrap(), None);
        let key = generate_key_hex().unwrap();
        store.store(&key).unwrap();
        assert_eq!(store.load().unwrap(), Some(key));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("k"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "the key file must be owner-only");
        }
    }

    #[test]
    fn an_existing_key_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let store = FileKeyStore::new(dir.path().join("k"));
        store.store(&generate_key_hex().unwrap()).unwrap();
        assert!(store.store(&generate_key_hex().unwrap()).is_err());
    }

    #[test]
    fn a_corrupt_key_file_is_reported_not_replaced() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("k"), "not a key").unwrap();
        assert!(FileKeyStore::new(dir.path().join("k")).load().is_err());
    }
}
