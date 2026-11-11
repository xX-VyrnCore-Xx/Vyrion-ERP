use serde::Serialize;

/// Host platform details shown in the application's "Informazioni" panel.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SystemInfo {
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
fn system_info() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![system_info])
        .run(tauri::generate_context!())
        .expect("error while running Vyrion ERP");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_info_reports_the_compile_target() {
        let info = system_info();
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.arch, std::env::consts::ARCH);
        assert!(!info.os.is_empty() && !info.arch.is_empty());
    }
}
