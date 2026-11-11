//! Vyrion ERP desktop shell.
//!
//! The business logic lives in the web front end; this crate gives it what a web page cannot
//! have: an encrypted local database, files, and facts about this computer.

mod db;
mod files;
mod keystore;
mod manager;
mod system;

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::db::{BackupInfo, ExecResult, IntegrityReport};
use crate::files::StoredFile;
use crate::manager::{DbManager, DbStatus, RestoreOutcome};
use crate::system::{SystemSnapshot, TcpCheck};

/// Host platform details shown in the application's "Informazioni" panel.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SystemInfo {
    os: &'static str,
    arch: &'static str,
}

#[derive(Debug, Serialize)]
pub struct AppInfo {
    version: &'static str,
    data_dir: String,
    os: &'static str,
    arch: &'static str,
}

pub struct AppState {
    data_dir: PathBuf,
    db: Arc<DbManager>,
}

impl AppState {
    fn new(data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("cannot create the data folder: {e}"))?;
        let db = Arc::new(DbManager::new(
            &data_dir,
            keystore::platform_key_store(&data_dir),
        ));
        Ok(Self { data_dir, db })
    }
}

fn existing_file(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if path.is_file() {
        Ok(path)
    } else {
        Err("the file does not exist".into())
    }
}

fn destination(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    match path.parent() {
        Some(parent) if parent.as_os_str().is_empty() || parent.is_dir() => Ok(path),
        _ => Err("the destination folder does not exist".into()),
    }
}

async fn blocking<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

#[tauri::command]
fn system_info() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        data_dir: state.data_dir.display().to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

// --- database -----------------------------------------------------------------------

#[tauri::command]
fn db_status(state: State<'_, AppState>) -> DbStatus {
    state.db.status()
}

#[tauri::command]
async fn db_query(
    state: State<'_, AppState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    state.db.database()?.query(&sql, &params)
}

#[tauri::command]
async fn db_execute(
    state: State<'_, AppState>,
    sql: String,
    params: Vec<Value>,
) -> Result<ExecResult, String> {
    state.db.database()?.execute(&sql, &params)
}

#[tauri::command]
async fn db_reset(state: State<'_, AppState>) -> Result<bool, String> {
    state.db.database()?.reset()
}

#[tauri::command]
async fn db_integrity_check(state: State<'_, AppState>) -> Result<IntegrityReport, String> {
    let db = state.db.database()?;
    blocking(move || db.integrity_check()).await
}

#[tauri::command]
async fn db_backup(
    state: State<'_, AppState>,
    dest: String,
    passphrase: String,
) -> Result<BackupInfo, String> {
    let db = state.db.database()?;
    let dest = destination(&dest)?;
    blocking(move || db.backup(&dest, &passphrase)).await
}

#[tauri::command]
async fn db_restore(
    state: State<'_, AppState>,
    source: String,
    passphrase: String,
) -> Result<RestoreOutcome, String> {
    let source = existing_file(&source)?;
    // The slow copy runs off the async threads, so it needs its own handle on the manager.
    let manager = state.db.clone();
    blocking(move || manager.restore(&source, &passphrase)).await
}

// --- this computer and the network --------------------------------------------------

#[tauri::command]
async fn system_snapshot() -> Result<SystemSnapshot, String> {
    blocking(|| Ok(system::snapshot())).await
}

#[tauri::command]
async fn net_check_tcp(host: String, port: u16, timeout_ms: u64) -> Result<TcpCheck, String> {
    blocking(move || system::tcp_check(&host, port, timeout_ms)).await
}

// --- attachments --------------------------------------------------------------------

#[tauri::command]
async fn attachment_store(
    state: State<'_, AppState>,
    source: String,
) -> Result<StoredFile, String> {
    let dir = state.data_dir.clone();
    let source = existing_file(&source)?;
    blocking(move || files::store(&dir, &source)).await
}

#[tauri::command]
async fn attachment_verify(state: State<'_, AppState>, hash: String) -> Result<bool, String> {
    let dir = state.data_dir.clone();
    blocking(move || files::verify(&dir, &hash)).await
}

#[tauri::command]
async fn attachment_export(
    state: State<'_, AppState>,
    hash: String,
    dest: String,
) -> Result<(), String> {
    let dir = state.data_dir.clone();
    let dest = destination(&dest)?;
    blocking(move || files::export(&dir, &hash, &dest)).await
}

#[tauri::command]
async fn attachment_delete(state: State<'_, AppState>, hash: String) -> Result<(), String> {
    files::delete(&state.data_dir, &hash)
}

/// Opens an attachment with the program the system associates with its type. The stored
/// bytes are copied to a temporary file with the original name first.
#[tauri::command]
async fn attachment_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    hash: String,
    name: String,
) -> Result<(), String> {
    let folder = std::env::temp_dir()
        .join("vyrion-open")
        .join(&hash[..hash.len().min(16)]);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let target = folder.join(files::safe_name(&name));
    let dir = state.data_dir.clone();
    let copy_to = target.clone();
    blocking(move || files::export(&dir, &hash, &copy_to)).await?;
    app.opener()
        .open_path(target.display().to_string(), None::<&str>)
        .map_err(|e| format!("cannot open the file: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(AppState::new(dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system_info,
            app_info,
            db_status,
            db_query,
            db_execute,
            db_reset,
            db_integrity_check,
            db_backup,
            db_restore,
            system_snapshot,
            net_check_tcp,
            attachment_store,
            attachment_verify,
            attachment_export,
            attachment_delete,
            attachment_open,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vyrion ERP");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn system_info_reports_the_compile_target() {
        let info = system_info();
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.arch, std::env::consts::ARCH);
        assert!(!info.os.is_empty() && !info.arch.is_empty());
    }

    #[test]
    fn the_destination_folder_must_exist() {
        let dir = tempfile::tempdir().unwrap();
        assert!(destination(&dir.path().join("out.vyb").display().to_string()).is_ok());
        assert!(destination(&dir.path().join("missing/out.vyb").display().to_string()).is_err());
        assert!(existing_file(&dir.path().display().to_string()).is_err());
    }

    #[test]
    fn the_app_state_creates_its_folder_and_an_encrypted_database() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("nested/data");
        let state = AppState::new(data.clone()).unwrap();
        assert!(state.db.status().ready);
        assert!(Path::new(&data).join("vyrion.db").exists());
    }
}
