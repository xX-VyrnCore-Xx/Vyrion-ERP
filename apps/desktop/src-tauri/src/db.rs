//! The local encrypted database (SQLite + SQLCipher).
//!
//! The user interface sends SQL with bound parameters; this module runs it on one
//! connection. A SQLite *authorizer* refuses the few statements that could weaken the
//! protection (attaching other files, loading extensions, changing the key), so a
//! compromised web view cannot use the database to reach outside of it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use serde_json::{Map, Number, Value as Json};

type Row = Map<String, Json>;

#[derive(Debug, Serialize, PartialEq)]
pub struct ExecResult {
    pub changes: usize,
    pub last_insert_rowid: i64,
}

#[derive(Debug, Serialize)]
pub struct IntegrityReport {
    pub ok: bool,
    pub messages: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub size_bytes: u64,
    pub tables: usize,
}

pub struct Database {
    conn: Mutex<Connection>,
    #[cfg(test)]
    key_hex: String,
    /// Raised while this module itself runs statements the authorizer normally refuses.
    internal: Arc<AtomicBool>,
}

fn forbidden_pragma(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(name.as_str(), "key" | "rekey" | "hexkey" | "hexrekey") || name.starts_with("cipher_")
}

fn forbidden_function(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(name.as_str(), "load_extension" | "sqlcipher_export")
}

fn install_authorizer(conn: &mut Connection, internal: Arc<AtomicBool>) -> Result<(), String> {
    conn.authorizer(Some(move |ctx: AuthContext<'_>| -> Authorization {
        if internal.load(Ordering::SeqCst) {
            return Authorization::Allow;
        }
        match ctx.action {
            AuthAction::Attach { .. } | AuthAction::Detach { .. } => Authorization::Deny,
            AuthAction::Pragma { pragma_name, .. } if forbidden_pragma(pragma_name) => {
                Authorization::Deny
            }
            AuthAction::Function { function_name } if forbidden_function(function_name) => {
                Authorization::Deny
            }
            _ => Authorization::Allow,
        }
    }))
    // Without the authorizer the protection is gone: refuse to run rather than continue.
    .map_err(|e| format!("cannot install the statement filter: {e}"))
}

/// Opens `path` with the raw key and applies the connection settings.
fn open_keyed(path: &Path, key_hex: &str) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("cannot open the database: {e}"))?;
    conn.pragma_update(None, "key", format!("x'{key_hex}'"))
        .map_err(|e| format!("cannot apply the key: {e}"))?;
    // The first read proves the key is right: with a wrong key SQLCipher fails here.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    })
    .map_err(|_| "cannot read the database: wrong key or damaged file".to_string())?;
    Ok(conn)
}

fn to_sql(value: &Json) -> Result<Value, String> {
    Ok(match value {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("number out of range")?),
        },
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(_) | Json::Object(_) => {
            return Err("parameters must be scalars; stringify structured data first".into())
        }
    })
}

fn to_json(value: ValueRef<'_>) -> Result<Json, String> {
    Ok(match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map_or(Json::Null, Json::Number),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => return Err("binary columns are not supported".into()),
    })
}

impl Database {
    pub fn open(path: &Path, key_hex: &str) -> Result<Self, String> {
        let mut conn = open_keyed(path, key_hex)?;
        // FULL: a power cut must not lose an accepted invoice. Foreign keys are enforced.
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA secure_delete = ON;",
        )
        .map_err(|e| format!("cannot configure the database: {e}"))?;
        let internal = Arc::new(AtomicBool::new(false));
        install_authorizer(&mut conn, internal.clone())?;
        Ok(Self {
            conn: Mutex::new(conn),
            #[cfg(test)]
            key_hex: key_hex.to_string(),
            internal,
        })
    }

    #[cfg(test)]
    pub fn key_hex(&self) -> &str {
        &self.key_hex
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.conn
            .lock()
            .map_err(|_| "the database lock is poisoned".to_string())
    }

    pub fn query(&self, sql: &str, params: &[Json]) -> Result<Vec<Row>, String> {
        let values = params.iter().map(to_sql).collect::<Result<Vec<_>, _>>()?;
        let conn = self.lock()?;
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().map(str::to_string).collect();
        let mut rows = stmt
            .query(params_from_iter(values))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut object = Map::with_capacity(names.len());
            for (index, name) in names.iter().enumerate() {
                let cell = row.get_ref(index).map_err(|e| e.to_string())?;
                object.insert(name.clone(), to_json(cell)?);
            }
            out.push(object);
        }
        Ok(out)
    }

    pub fn execute(&self, sql: &str, params: &[Json]) -> Result<ExecResult, String> {
        let values = params.iter().map(to_sql).collect::<Result<Vec<_>, _>>()?;
        let conn = self.lock()?;
        let changes = conn
            .execute(sql, params_from_iter(values))
            .map_err(|e| e.to_string())?;
        Ok(ExecResult {
            changes,
            last_insert_rowid: conn.last_insert_rowid(),
        })
    }

    /// Rolls back a transaction left open (the web view was reloaded mid-way). Returns true
    /// if there was one.
    pub fn reset(&self) -> Result<bool, String> {
        let conn = self.lock()?;
        if conn.is_autocommit() {
            return Ok(false);
        }
        conn.execute_batch("ROLLBACK").map_err(|e| e.to_string())?;
        Ok(true)
    }

    fn internal<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        struct Reset<'a>(&'a AtomicBool);
        impl Drop for Reset<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let conn = self.lock()?;
        self.internal.store(true, Ordering::SeqCst);
        let _guard = Reset(&self.internal);
        f(&conn)
    }

    pub fn integrity_check(&self) -> Result<IntegrityReport, String> {
        self.internal(|conn| {
            let mut messages = Vec::new();
            let mut stmt = conn
                .prepare("PRAGMA integrity_check")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                let message = row.map_err(|e| e.to_string())?;
                if message != "ok" {
                    messages.push(message);
                }
            }
            // Pages that fail authentication are reported here, not by integrity_check.
            let mut stmt = conn
                .prepare("PRAGMA cipher_integrity_check")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                messages.push(row.map_err(|e| e.to_string())?);
            }
            Ok(IntegrityReport {
                ok: messages.is_empty(),
                messages,
            })
        })
    }

    /// Versions of the engine, for the "about" panel.
    pub fn engine_versions(&self) -> Result<(String, String), String> {
        self.internal(|conn| {
            let sqlite: String = conn
                .query_row("SELECT sqlite_version()", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            let cipher: String = conn
                .query_row("PRAGMA cipher_version", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            Ok((sqlite, cipher))
        })
    }

    /// Writes a copy protected by `passphrase` (not by the device key), so that it can be
    /// restored on another computer. The copy is read back and checked before it is kept.
    pub fn backup(&self, dest: &Path, passphrase: &str) -> Result<BackupInfo, String> {
        if passphrase.chars().count() < 12 {
            return Err("the backup passphrase must be at least 12 characters".into());
        }
        let partial = PathBuf::from(format!("{}.partial", dest.display()));
        let _ = std::fs::remove_file(&partial);
        let outcome = self.internal(|conn| {
            if !conn.is_autocommit() {
                return Err("finish the current transaction before making a backup".into());
            }
            let partial_text = partial
                .to_str()
                .ok_or("the destination path is not valid text")?;
            conn.execute(
                "ATTACH DATABASE ?1 AS backup KEY ?2",
                [partial_text, passphrase],
            )
            .map_err(|e| format!("cannot create the backup file: {e}"))?;
            let exported = conn.execute_batch("SELECT sqlcipher_export('backup');");
            let detached = conn.execute_batch("DETACH DATABASE backup;");
            exported.map_err(|e| format!("cannot write the backup: {e}"))?;
            detached.map_err(|e| e.to_string())
        });
        if let Err(error) = outcome {
            let _ = std::fs::remove_file(&partial);
            return Err(error);
        }
        // Read it back with the passphrase: a backup nobody checked is not a backup.
        let tables = match count_tables_with_passphrase(&partial, passphrase) {
            Ok(n) => n,
            Err(error) => {
                let _ = std::fs::remove_file(&partial);
                return Err(format!("the backup could not be verified: {error}"));
            }
        };
        std::fs::rename(&partial, dest).map_err(|e| format!("cannot save the backup: {e}"))?;
        let size_bytes = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
        Ok(BackupInfo {
            path: dest.display().to_string(),
            size_bytes,
            tables,
        })
    }
}

fn count_tables_with_passphrase(path: &Path, passphrase: &str) -> Result<usize, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "key", passphrase)
        .map_err(|e| e.to_string())?;
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "wrong passphrase or damaged backup".to_string())?;
    let check: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("integrity check failed: {check}"));
    }
    Ok(tables as usize)
}

/// Builds a database file protected by `key_hex` from a passphrase-protected backup.
/// Nothing the caller owns is touched: the result goes to `dest`.
pub fn build_from_backup(
    src: &Path,
    passphrase: &str,
    dest: &Path,
    key_hex: &str,
) -> Result<(), String> {
    let _ = std::fs::remove_file(dest);
    let source = Connection::open(src).map_err(|e| e.to_string())?;
    source
        .pragma_update(None, "key", passphrase)
        .map_err(|e| e.to_string())?;
    source
        .query_row("SELECT count(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(|_| "wrong passphrase or not a Vyrion backup".to_string())?;
    let dest_text = dest
        .to_str()
        .ok_or("the destination path is not valid text")?;
    let raw_key = format!("x'{key_hex}'");
    source
        .execute(
            "ATTACH DATABASE ?1 AS restored KEY ?2",
            [dest_text, raw_key.as_str()],
        )
        .map_err(|e| format!("cannot create the restored database: {e}"))?;
    let exported = source.execute_batch("SELECT sqlcipher_export('restored');");
    let _ = source.execute_batch("DETACH DATABASE restored;");
    exported.map_err(|e| format!("cannot copy the backup: {e}"))?;
    drop(source);
    // The new file must open with the device key and pass the integrity check.
    let check = open_keyed(dest, key_hex)?;
    let result: String = check
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if result != "ok" {
        let _ = std::fs::remove_file(dest);
        return Err(format!(
            "the restored copy failed its integrity check: {result}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keystore::generate_key_hex;
    use serde_json::json;

    pub(crate) fn temp_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("t.db"), &generate_key_hex().unwrap()).unwrap();
        (dir, db)
    }

    #[test]
    fn the_file_is_encrypted_and_needs_the_right_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("vyrion.db");
        let key = generate_key_hex().unwrap();
        let db = Database::open(&path, &key).unwrap();
        db.execute("CREATE TABLE secret (v TEXT)", &[]).unwrap();
        db.execute(
            "INSERT INTO secret VALUES (?1)",
            &[json!("top-secret-invoice")],
        )
        .unwrap();
        drop(db);

        let bytes = std::fs::read(&path).unwrap();
        assert!(
            !bytes.starts_with(b"SQLite format 3"),
            "the header must not be plain"
        );
        assert!(
            !String::from_utf8_lossy(&bytes).contains("top-secret-invoice"),
            "data must not appear in clear"
        );
        let wrong = Database::open(&path, &generate_key_hex().unwrap());
        assert!(wrong.is_err(), "a wrong key must not open the file");
        let right = Database::open(&path, &key).unwrap();
        assert_eq!(
            right.query("SELECT v FROM secret", &[]).unwrap()[0]["v"],
            json!("top-secret-invoice")
        );
    }

    #[test]
    fn values_survive_a_round_trip_with_their_types() {
        let (_dir, db) = temp_db();
        db.execute("CREATE TABLE t (a, b, c, d, e)", &[]).unwrap();
        let result = db
            .execute(
                "INSERT INTO t VALUES (?1, ?2, ?3, ?4, ?5)",
                &[
                    json!(null),
                    json!(true),
                    json!(12_345_678_901_i64),
                    json!(2.5),
                    json!("ciao è"),
                ],
            )
            .unwrap();
        assert_eq!(
            result,
            ExecResult {
                changes: 1,
                last_insert_rowid: 1
            }
        );
        let rows = db.query("SELECT * FROM t", &[]).unwrap();
        assert_eq!(rows[0]["a"], json!(null));
        assert_eq!(rows[0]["b"], json!(1));
        assert_eq!(rows[0]["c"], json!(12_345_678_901_i64));
        assert_eq!(rows[0]["d"], json!(2.5));
        assert_eq!(rows[0]["e"], json!("ciao è"));
    }

    #[test]
    fn parameters_are_bound_never_interpolated() {
        let (_dir, db) = temp_db();
        db.execute("CREATE TABLE t (name TEXT)", &[]).unwrap();
        let hostile = "x'); DROP TABLE t; --";
        db.execute("INSERT INTO t VALUES (?1)", &[json!(hostile)])
            .unwrap();
        let rows = db
            .query("SELECT name FROM t WHERE name = ?1", &[json!(hostile)])
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert!(db.query("SELECT count(*) AS n FROM t", &[]).is_ok());
    }

    #[test]
    fn structured_parameters_are_refused() {
        let (_dir, db) = temp_db();
        assert!(db.query("SELECT ?1", &[json!({"a": 1})]).is_err());
        assert!(db.query("SELECT ?1", &[json!([1, 2])]).is_err());
    }

    #[test]
    fn transactions_commit_and_roll_back() {
        let (_dir, db) = temp_db();
        db.execute("CREATE TABLE t (v INTEGER)", &[]).unwrap();
        db.execute("BEGIN IMMEDIATE", &[]).unwrap();
        db.execute("INSERT INTO t VALUES (1)", &[]).unwrap();
        db.execute("ROLLBACK", &[]).unwrap();
        assert_eq!(
            db.query("SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            json!(0)
        );
        db.execute("BEGIN IMMEDIATE", &[]).unwrap();
        db.execute("INSERT INTO t VALUES (2)", &[]).unwrap();
        db.execute("COMMIT", &[]).unwrap();
        assert_eq!(
            db.query("SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            json!(1)
        );
    }

    #[test]
    fn a_dangling_transaction_is_rolled_back_by_reset() {
        let (_dir, db) = temp_db();
        db.execute("CREATE TABLE t (v INTEGER)", &[]).unwrap();
        assert!(!db.reset().unwrap());
        db.execute("BEGIN IMMEDIATE", &[]).unwrap();
        db.execute("INSERT INTO t VALUES (1)", &[]).unwrap();
        assert!(
            db.reset().unwrap(),
            "the open transaction must be reported and rolled back"
        );
        assert_eq!(
            db.query("SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"],
            json!(0)
        );
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let (_dir, db) = temp_db();
        db.execute("CREATE TABLE p (id INTEGER PRIMARY KEY)", &[])
            .unwrap();
        db.execute("CREATE TABLE c (p INTEGER REFERENCES p(id))", &[])
            .unwrap();
        assert!(db.execute("INSERT INTO c VALUES (99)", &[]).is_err());
    }

    #[test]
    fn statements_that_could_weaken_the_protection_are_refused() {
        let (dir, db) = temp_db();
        let other = dir.path().join("other.db");
        let attach = format!("ATTACH DATABASE '{}' AS other", other.display());
        for sql in [
            attach.as_str(),
            "SELECT load_extension('x')",
            "PRAGMA key = 'x'",
            "PRAGMA rekey = 'x'",
            "PRAGMA cipher_page_size = 512",
            "SELECT sqlcipher_export('main')",
        ] {
            let error = db
                .query(sql, &[])
                .err()
                .or_else(|| db.execute(sql, &[]).err());
            assert!(error.is_some(), "must be refused: {sql}");
        }
        assert!(
            !other.exists(),
            "nothing may be created outside the database"
        );
        // The database keeps working, and the internal operations still can do their job.
        assert!(db.query("SELECT 1 AS one", &[]).is_ok());
        assert!(db.integrity_check().unwrap().ok);
    }

    #[test]
    fn integrity_check_passes_on_a_healthy_database() {
        let (_dir, db) = temp_db();
        db.execute("CREATE TABLE t (v)", &[]).unwrap();
        let report = db.integrity_check().unwrap();
        assert!(report.ok, "{:?}", report.messages);
        let (sqlite, cipher) = db.engine_versions().unwrap();
        assert!(!sqlite.is_empty() && !cipher.is_empty());
    }

    #[test]
    fn a_backup_is_protected_by_its_passphrase_and_verified() {
        let (dir, db) = temp_db();
        db.execute("CREATE TABLE invoices (n TEXT)", &[]).unwrap();
        db.execute("INSERT INTO invoices VALUES ('2026/0001')", &[])
            .unwrap();
        let dest = dir.path().join("backup.vyb");
        let info = db.backup(&dest, "correct horse battery").unwrap();
        assert_eq!(info.tables, 1);
        assert!(info.size_bytes > 0);

        let bytes = std::fs::read(&dest).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"));
        assert!(
            !dir.path().join("backup.vyb.partial").exists(),
            "no temporary file is left"
        );
        assert!(count_tables_with_passphrase(&dest, "wrong passphrase!!").is_err());
        assert_eq!(
            count_tables_with_passphrase(&dest, "correct horse battery").unwrap(),
            1
        );
        // The live database is untouched and still usable.
        assert_eq!(db.query("SELECT n FROM invoices", &[]).unwrap().len(), 1);
    }

    #[test]
    fn a_weak_backup_passphrase_is_refused() {
        let (dir, db) = temp_db();
        assert!(db.backup(&dir.path().join("b"), "short").is_err());
        assert!(!dir.path().join("b").exists());
    }

    #[test]
    fn a_backup_cannot_be_taken_inside_a_transaction() {
        let (dir, db) = temp_db();
        db.execute("BEGIN IMMEDIATE", &[]).unwrap();
        assert!(db
            .backup(&dir.path().join("b"), "correct horse battery")
            .is_err());
        db.execute("ROLLBACK", &[]).unwrap();
        assert!(
            db.query("SELECT 1 AS one", &[]).is_ok(),
            "the database still works afterwards"
        );
    }

    #[test]
    fn a_backup_restores_on_another_computer_with_a_different_key() {
        let (dir, db) = temp_db();
        db.execute("CREATE TABLE invoices (n TEXT)", &[]).unwrap();
        db.execute("INSERT INTO invoices VALUES ('2026/0007')", &[])
            .unwrap();
        let backup = dir.path().join("backup.vyb");
        db.backup(&backup, "correct horse battery").unwrap();

        let other_machine_key = generate_key_hex().unwrap();
        let restored_path = dir.path().join("restored.db");
        build_from_backup(
            &backup,
            "correct horse battery",
            &restored_path,
            &other_machine_key,
        )
        .unwrap();
        let restored = Database::open(&restored_path, &other_machine_key).unwrap();
        assert_eq!(
            restored.query("SELECT n FROM invoices", &[]).unwrap()[0]["n"],
            json!("2026/0007")
        );
        assert!(
            Database::open(&restored_path, db.key_hex()).is_err(),
            "it uses the new key"
        );
    }

    #[test]
    fn restoring_with_the_wrong_passphrase_fails_and_leaves_nothing_behind() {
        let (dir, db) = temp_db();
        db.execute("CREATE TABLE t (v)", &[]).unwrap();
        let backup = dir.path().join("backup.vyb");
        db.backup(&backup, "correct horse battery").unwrap();
        let target = dir.path().join("restored.db");
        let error = build_from_backup(
            &backup,
            "not the passphrase!",
            &target,
            &generate_key_hex().unwrap(),
        );
        assert!(error.is_err());
        let not_a_backup = dir.path().join("junk.vyb");
        std::fs::write(
            &not_a_backup,
            b"this is not a database at all, just text padding",
        )
        .unwrap();
        assert!(build_from_backup(
            &not_a_backup,
            "correct horse battery",
            &target,
            &generate_key_hex().unwrap()
        )
        .is_err());
    }
}
