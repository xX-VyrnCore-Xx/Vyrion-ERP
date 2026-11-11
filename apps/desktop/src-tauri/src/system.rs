//! Facts about this computer and reachability checks, run natively.

use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Debug, Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub file_system: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct SystemSnapshot {
    pub hostname: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub arch: &'static str,
    pub cpu_brand: String,
    pub cpu_count: usize,
    pub cpu_usage_percent: f32,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub uptime_seconds: u64,
    pub disks: Vec<DiskInfo>,
}

/// CPU usage needs two samples a short time apart, so this takes about 250 ms.
pub fn snapshot() -> SystemSnapshot {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.max(Duration::from_millis(200)));
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let disks = Disks::new_with_refreshed_list();
    SystemSnapshot {
        hostname: System::host_name(),
        os_name: System::name(),
        os_version: System::os_version(),
        arch: std::env::consts::ARCH,
        cpu_brand: sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_default(),
        cpu_count: sys.cpus().len(),
        cpu_usage_percent: sys.global_cpu_usage(),
        memory_total_bytes: sys.total_memory(),
        memory_used_bytes: sys.used_memory(),
        swap_total_bytes: sys.total_swap(),
        swap_used_bytes: sys.used_swap(),
        uptime_seconds: System::uptime(),
        disks: disks
            .list()
            .iter()
            .map(|d| DiskInfo {
                name: d.name().to_string_lossy().into_owned(),
                mount: d.mount_point().display().to_string(),
                file_system: d.file_system().to_string_lossy().into_owned(),
                total_bytes: d.total_space(),
                available_bytes: d.available_space(),
            })
            .collect(),
    }
}

#[derive(Debug, Serialize, PartialEq)]
pub struct TcpCheck {
    pub ok: bool,
    pub elapsed_ms: u64,
    pub address: Option<String>,
    pub error: Option<String>,
}

/// Can this computer open a TCP connection to `host:port`? A real reachability test of a
/// service as seen from here (through the VPN, when it is up).
pub fn tcp_check(host: &str, port: u16, timeout_ms: u64) -> Result<TcpCheck, String> {
    let host = host.trim();
    if host.is_empty() || host.len() > 253 || host.chars().any(|c| c.is_whitespace() || c == '/') {
        return Err("invalid host name".into());
    }
    if port == 0 {
        return Err("invalid port".into());
    }
    let timeout = Duration::from_millis(timeout_ms.clamp(100, 10_000));
    let started = Instant::now();
    let elapsed = || started.elapsed().as_millis() as u64;
    let addresses: Vec<_> = match (host, port).to_socket_addrs() {
        Ok(found) => found.collect(),
        Err(e) => {
            return Ok(TcpCheck {
                ok: false,
                elapsed_ms: elapsed(),
                address: None,
                error: Some(format!("name resolution failed: {e}")),
            })
        }
    };
    let mut last_error = "no address found".to_string();
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(_) => {
                return Ok(TcpCheck {
                    ok: true,
                    elapsed_ms: elapsed(),
                    address: Some(address.to_string()),
                    error: None,
                })
            }
            Err(e) => last_error = e.to_string(),
        }
    }
    Ok(TcpCheck {
        ok: false,
        elapsed_ms: elapsed(),
        address: None,
        error: Some(last_error),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn an_open_port_is_reported_reachable() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let result = tcp_check("127.0.0.1", port, 2000).unwrap();
        assert!(result.ok, "{result:?}");
        assert!(result.address.unwrap().ends_with(&port.to_string()));
    }

    #[test]
    fn a_closed_port_is_reported_unreachable() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        }; // the listener is dropped: nothing accepts on this port now
        let result = tcp_check("127.0.0.1", port, 1000).unwrap();
        assert!(!result.ok);
        assert!(result.error.is_some());
    }

    #[test]
    fn an_unresolvable_name_is_a_result_not_an_error() {
        let result = tcp_check("no-such-host.invalid", 443, 1000).unwrap();
        assert!(!result.ok);
        assert!(result.error.unwrap().contains("name resolution"));
    }

    #[test]
    fn nonsense_input_is_refused() {
        assert!(tcp_check("", 80, 1000).is_err());
        assert!(tcp_check("exa mple.com", 80, 1000).is_err());
        assert!(tcp_check("example.com/x", 80, 1000).is_err());
        assert!(tcp_check("127.0.0.1", 0, 1000).is_err());
    }

    #[test]
    fn the_snapshot_reports_this_machine() {
        let s = snapshot();
        assert!(s.cpu_count > 0);
        assert!(s.memory_total_bytes > 0);
        assert!(s.memory_used_bytes <= s.memory_total_bytes);
        assert!((0.0..=100.0 * s.cpu_count as f32).contains(&s.cpu_usage_percent));
    }
}
