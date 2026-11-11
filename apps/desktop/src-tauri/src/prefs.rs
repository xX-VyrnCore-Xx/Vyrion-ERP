//! Small per-computer preferences the shell needs before the web view is up (the window
//! close behaviour). Kept in a plain JSON file next to the database; it holds nothing secret.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

const FILE: &str = "shell-prefs.json";

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Stored {
    close_to_tray: bool,
}

pub struct Prefs {
    path: PathBuf,
    close_to_tray: AtomicBool,
}

impl Prefs {
    /// Missing or unreadable file means "the default": the window hides in the tray.
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(FILE);
        let stored = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Stored>(&bytes).ok());
        Self {
            path,
            close_to_tray: AtomicBool::new(stored.map_or(true, |s| s.close_to_tray)),
        }
    }

    pub fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::SeqCst)
    }

    pub fn set_close_to_tray(&self, value: bool) -> Result<(), String> {
        let json = serde_json::to_vec(&Stored {
            close_to_tray: value,
        })
        .map_err(|e| e.to_string())?;
        // Write first: if saving fails the running behaviour must not change either.
        std::fs::write(&self.path, json).map_err(|e| format!("cannot save the preference: {e}"))?;
        self.close_to_tray.store(value, Ordering::SeqCst);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_is_to_keep_running_in_the_tray() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Prefs::load(dir.path()).close_to_tray());
    }

    #[test]
    fn a_choice_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        Prefs::load(dir.path()).set_close_to_tray(false).unwrap();
        assert!(!Prefs::load(dir.path()).close_to_tray());
        Prefs::load(dir.path()).set_close_to_tray(true).unwrap();
        assert!(Prefs::load(dir.path()).close_to_tray());
    }

    #[test]
    fn a_damaged_file_falls_back_to_the_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE), b"{ not json").unwrap();
        assert!(Prefs::load(dir.path()).close_to_tray());
    }

    #[test]
    fn a_failed_save_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = Prefs::load(&dir.path().join("missing"));
        assert!(prefs.set_close_to_tray(false).is_err());
        assert!(prefs.close_to_tray());
    }
}
