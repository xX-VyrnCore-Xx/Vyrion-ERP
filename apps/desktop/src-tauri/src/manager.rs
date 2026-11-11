//! Owns the database for the lifetime of the app: opens it, reports why it could not be
//! opened, and swaps it atomically when a backup is restored.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::db::{build_from_backup, Database};
use crate::keystore::{generate_key_hex, KeyStore};

pub const DB_FILE: &str = "vyrion.db";

#[derive(Debug, Serialize)]
pub struct DbStatus {
    pub ready: bool,
    pub error: Option<String>,
    pub path: String,
    pub key_store: &'static str,
    pub size_bytes: u64,
    pub sqlite_version: Option<String>,
    pub cipher_version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RestoreOutcome {
    /// Where the database that was replaced was kept, if there was one.
    pub previous_copy: Option<String>,
}

pub struct DbManager {
    dir: PathBuf,
    keys: Box<dyn KeyStore>,
    db: RwLock<Option<Arc<Database>>>,
    error: Mutex<Option<String>>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl DbManager {
    pub fn new(dir: &Path, keys: Box<dyn KeyStore>) -> Self {
        let manager = Self {
            dir: dir.to_path_buf(),
            keys,
            db: RwLock::new(None),
            error: Mutex::new(None),
        };
        match manager.open_current() {
            Ok(db) => *manager.db.write().unwrap() = Some(Arc::new(db)),
            Err(error) => *manager.error.lock().unwrap() = Some(error),
        }
        manager
    }

    fn live_path(&self) -> PathBuf {
        self.dir.join(DB_FILE)
    }

    fn open_current(&self) -> Result<Database, String> {
        let path = self.live_path();
        let key = match self.keys.load()? {
            Some(key) => key,
            None if path.exists() => {
                // Never invent a new key for an existing database: that would orphan its data.
                return Err(format!(
                    "KEY_MISSING: the database exists but its key is not in the {} key store. \
                     Restore a backup to recover.",
                    self.keys.name()
                ));
            }
            None => {
                let key = generate_key_hex()?;
                self.keys.store(&key)?;
                key
            }
        };
        Database::open(&path, &key)
    }

    /// The open database, or the reason there is none.
    pub fn database(&self) -> Result<Arc<Database>, String> {
        if let Some(db) = self
            .db
            .read()
            .map_err(|_| "database lock poisoned")?
            .as_ref()
        {
            return Ok(db.clone());
        }
        Err(self
            .error
            .lock()
            .map_err(|_| "database lock poisoned")?
            .clone()
            .unwrap_or_else(|| "the database is not available".into()))
    }

    /// Flushes the log if the database is open; nothing to do (and no error) if it never was.
    pub fn checkpoint(&self) -> Result<(), String> {
        match self.database() {
            Ok(db) => db.checkpoint(),
            Err(_) => Ok(()),
        }
    }

    pub fn status(&self) -> DbStatus {
        let path = self.live_path();
        let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let versions = self
            .database()
            .ok()
            .and_then(|db| db.engine_versions().ok());
        DbStatus {
            ready: self.db.read().map(|g| g.is_some()).unwrap_or(false),
            error: self.error.lock().ok().and_then(|e| e.clone()),
            path: path.display().to_string(),
            key_store: self.keys.name(),
            size_bytes,
            sqlite_version: versions.as_ref().map(|v| v.0.clone()),
            cipher_version: versions.map(|v| v.1),
        }
    }

    /// Replaces the database with the contents of a backup. The backup is fully read,
    /// decrypted, copied and verified into a temporary file *before* anything is touched;
    /// the database being replaced is kept next to it, never deleted.
    pub fn restore(&self, source: &Path, passphrase: &str) -> Result<RestoreOutcome, String> {
        let key = match self.keys.load()? {
            Some(key) => key,
            None => {
                let key = generate_key_hex()?;
                self.keys.store(&key)?;
                key
            }
        };
        let staging = self.dir.join(format!("{DB_FILE}.restoring"));
        build_from_backup(source, passphrase, &staging, &key)?;

        let mut slot = self.db.write().map_err(|_| "database lock poisoned")?;
        if let Some(old) = slot.take() {
            if let Err(still_open) = close(old) {
                *slot = Some(still_open);
                let _ = std::fs::remove_file(&staging);
                return Err("the database is busy; try again in a moment".into());
            }
        }

        let live = self.live_path();
        let previous = if live.exists() {
            let kept = self
                .dir
                .join(format!("{DB_FILE}.before-restore-{}", now_secs()));
            std::fs::rename(&live, &kept)
                .map_err(|e| format!("cannot keep the current database: {e}"))?;
            for suffix in ["-wal", "-shm"] {
                let _ = std::fs::remove_file(format!("{}{suffix}", live.display()));
            }
            Some(kept)
        } else {
            None
        };

        let reopened = std::fs::rename(&staging, &live)
            .map_err(|e| format!("cannot put the restored database in place: {e}"))
            .and_then(|()| Database::open(&live, &key));
        match reopened {
            Ok(db) => {
                *slot = Some(Arc::new(db));
                *self.error.lock().map_err(|_| "database lock poisoned")? = None;
                Ok(RestoreOutcome {
                    previous_copy: previous.map(|p| p.display().to_string()),
                })
            }
            Err(error) => {
                // Put things back as they were.
                let _ = std::fs::remove_file(&live);
                if let Some(kept) = &previous {
                    let _ = std::fs::rename(kept, &live);
                    if let Ok(db) = Database::open(&live, &key) {
                        *slot = Some(Arc::new(db));
                    }
                }
                Err(error)
            }
        }
    }
}

/// Drops the last reference so the file is released (Windows cannot rename an open file).
fn close(mut db: Arc<Database>) -> Result<(), Arc<Database>> {
    for _ in 0..40 {
        match Arc::try_unwrap(db) {
            Ok(owned) => {
                drop(owned);
                return Ok(());
            }
            Err(shared) => {
                db = shared;
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    Err(db)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keystore::FileKeyStore;
    use serde_json::json;

    fn manager(dir: &Path) -> DbManager {
        DbManager::new(dir, Box::new(FileKeyStore::new(dir.join("key"))))
    }

    #[test]
    fn the_first_run_creates_a_key_and_a_database() {
        let dir = tempfile::tempdir().unwrap();
        let m = manager(dir.path());
        let status = m.status();
        assert!(status.ready, "{:?}", status.error);
        assert_eq!(status.key_store, "file");
        assert!(status.cipher_version.is_some());
        assert!(dir.path().join(DB_FILE).exists());
    }

    #[test]
    fn data_persists_across_restarts() {
        let dir = tempfile::tempdir().unwrap();
        {
            let m = manager(dir.path());
            let db = m.database().unwrap();
            db.execute("CREATE TABLE t (v TEXT)", &[]).unwrap();
            db.execute("INSERT INTO t VALUES ('kept')", &[]).unwrap();
        }
        let again = manager(dir.path());
        assert_eq!(
            again
                .database()
                .unwrap()
                .query("SELECT v FROM t", &[])
                .unwrap()[0]["v"],
            json!("kept")
        );
    }

    #[test]
    fn a_lost_key_is_reported_and_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        drop(manager(dir.path()));
        std::fs::remove_file(dir.path().join("key")).unwrap(); // the credential store was wiped
        let m = manager(dir.path());
        let error = m.status().error.expect("must not open");
        assert!(error.starts_with("KEY_MISSING"), "{error}");
        assert!(
            !dir.path().join("key").exists(),
            "no new key may be invented"
        );
        assert!(m.database().is_err());
    }

    #[test]
    fn restore_replaces_the_database_and_keeps_the_previous_one() {
        let dir = tempfile::tempdir().unwrap();
        let m = manager(dir.path());
        let db = m.database().unwrap();
        db.execute("CREATE TABLE t (v TEXT)", &[]).unwrap();
        db.execute("INSERT INTO t VALUES ('before')", &[]).unwrap();
        let backup = dir.path().join("b.vyb");
        db.backup(&backup, "correct horse battery").unwrap();
        db.execute("INSERT INTO t VALUES ('after-backup')", &[])
            .unwrap();
        drop(db);

        let outcome = m.restore(&backup, "correct horse battery").unwrap();
        let rows = m.database().unwrap().query("SELECT v FROM t", &[]).unwrap();
        assert_eq!(rows.len(), 1, "back to the state of the backup");
        assert_eq!(rows[0]["v"], json!("before"));

        let kept = outcome
            .previous_copy
            .expect("the replaced database is kept");
        assert!(Path::new(&kept).exists());
        let kept_key = std::fs::read_to_string(dir.path().join("key")).unwrap();
        let old = Database::open(Path::new(&kept), kept_key.trim()).unwrap();
        assert_eq!(
            old.query("SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            json!(2)
        );
    }

    #[test]
    fn a_failed_restore_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let m = manager(dir.path());
        let db = m.database().unwrap();
        db.execute("CREATE TABLE t (v TEXT)", &[]).unwrap();
        db.execute("INSERT INTO t VALUES ('safe')", &[]).unwrap();
        let backup = dir.path().join("b.vyb");
        db.backup(&backup, "correct horse battery").unwrap();
        drop(db);

        assert!(m.restore(&backup, "the wrong passphrase").is_err());
        assert_eq!(
            m.database().unwrap().query("SELECT v FROM t", &[]).unwrap()[0]["v"],
            json!("safe")
        );
        assert!(
            !dir.path().join("vyrion.db.restoring").exists(),
            "no staging file is left"
        );
    }

    #[test]
    fn a_backup_recovers_a_database_whose_key_was_lost() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("b.vyb");
        {
            let m = manager(dir.path());
            let db = m.database().unwrap();
            db.execute("CREATE TABLE t (v TEXT)", &[]).unwrap();
            db.execute("INSERT INTO t VALUES ('precious')", &[])
                .unwrap();
            db.backup(&backup, "correct horse battery").unwrap();
        }
        std::fs::remove_file(dir.path().join("key")).unwrap();
        let m = manager(dir.path());
        assert!(!m.status().ready);

        m.restore(&backup, "correct horse battery").unwrap();
        assert!(m.status().ready);
        assert_eq!(
            m.database().unwrap().query("SELECT v FROM t", &[]).unwrap()[0]["v"],
            json!("precious")
        );
    }
}
