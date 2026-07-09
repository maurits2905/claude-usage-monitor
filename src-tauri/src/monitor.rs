//! Reading captured usage data and managing the statusline shim install.

use serde::Serialize;
use std::path::PathBuf;

use crate::shim::monitor_dir;

fn claude_settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("settings.json")
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_settings() -> Result<serde_json::Value, String> {
    let path = claude_settings_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Could not parse {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

fn write_settings(settings: &serde_json::Value) -> Result<(), String> {
    let path = claude_settings_path();
    let tmp = path.with_extension("json.tmp");
    let pretty = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, pretty + "\n").map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn backup_settings() -> Option<String> {
    let path = claude_settings_path();
    if !path.exists() {
        return None;
    }
    let stamp = now_ms();
    let backup = path.with_file_name(format!("settings.json.backup-halo-{stamp}"));
    std::fs::copy(&path, &backup).ok()?;
    Some(backup.display().to_string())
}

fn statusline_command(settings: &serde_json::Value) -> Option<String> {
    settings
        .pointer("/statusLine/command")
        .and_then(|v| v.as_str())
        .map(String::from)
}

fn shim_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\" --shim", exe.display()))
}

pub fn shim_installed() -> bool {
    read_settings()
        .ok()
        .and_then(|s| statusline_command(&s))
        .map(|c| c.contains("--shim") || c.contains("usage-monitor"))
        .unwrap_or(false)
}

#[derive(Serialize)]
pub struct InstallResult {
    pub status: String,
    pub wrapped: Option<String>,
    pub backup: Option<String>,
}

#[tauri::command]
pub fn install_shim() -> Result<InstallResult, String> {
    let mut settings = read_settings()?;
    let current = statusline_command(&settings);
    let dir = monitor_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let config_path = dir.join("shim-config.json");
    let new_command = shim_command()?;

    let (status, wrapped) = match &current {
        // Already pointing at a Halo exe shim: refresh the path (it may have moved).
        Some(c) if c.contains("--shim") => ("refreshed".to_string(), None),
        // Migrating from the legacy Node shim: its config already holds the
        // user's real original command - keep it, only swap the entry point.
        Some(c) if c.contains("usage-monitor") => ("migrated".to_string(), None),
        // Fresh install: remember whatever statusline the user had.
        Some(c) => {
            let config = serde_json::json!({
                "originalCommand": c,
                "installedAt": now_ms(),
            });
            std::fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;
            ("installed".to_string(), Some(c.clone()))
        }
        None => {
            let config = serde_json::json!({
                "originalCommand": null,
                "installedAt": now_ms(),
            });
            std::fs::write(&config_path, config.to_string()).map_err(|e| e.to_string())?;
            ("installed".to_string(), None)
        }
    };

    let backup = backup_settings();
    settings["statusLine"] = serde_json::json!({
        "type": "command",
        "command": new_command,
    });
    write_settings(&settings)?;

    Ok(InstallResult {
        status,
        wrapped,
        backup,
    })
}

#[tauri::command]
pub fn restore_shim() -> Result<InstallResult, String> {
    let mut settings = read_settings()?;
    let current = statusline_command(&settings);
    if !current
        .as_deref()
        .map(|c| c.contains("--shim") || c.contains("usage-monitor"))
        .unwrap_or(false)
    {
        return Ok(InstallResult {
            status: "not-installed".into(),
            wrapped: None,
            backup: None,
        });
    }

    let original: Option<String> = std::fs::read_to_string(monitor_dir().join("shim-config.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| {
            v.get("originalCommand")
                .and_then(|c| c.as_str().map(String::from))
        });

    let backup = backup_settings();
    match &original {
        Some(cmd) => {
            settings["statusLine"] = serde_json::json!({ "type": "command", "command": cmd });
        }
        None => {
            if let Some(obj) = settings.as_object_mut() {
                obj.remove("statusLine");
            }
        }
    }
    write_settings(&settings)?;

    Ok(InstallResult {
        status: "restored".into(),
        wrapped: original,
        backup,
    })
}

#[derive(Serialize)]
pub struct Status {
    pub installed: bool,
    pub captured_at: Option<u64>,
    pub age_seconds: Option<u64>,
    pub latest: Option<serde_json::Value>,
    pub history: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn get_status() -> Status {
    let dir = monitor_dir();
    let latest: Option<serde_json::Value> = std::fs::read_to_string(dir.join("latest.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok());

    // The Node-era shim wrote ISO strings; the Rust shim writes epoch ms.
    let captured_at = latest.as_ref().and_then(|l| {
        let v = l.get("__captured_at")?;
        v.as_u64().or_else(|| {
            let s = v.as_str()?;
            // Minimal ISO-8601 parse: fall back to None on anything odd.
            humantime_parse(s)
        })
    });
    let age_seconds = captured_at.map(|t| now_ms().saturating_sub(t) / 1000);

    let history = std::fs::read_to_string(dir.join("history.jsonl"))
        .map(|text| {
            let cutoff = now_ms().saturating_sub(24 * 3600 * 1000);
            text.lines()
                .rev()
                .take(1000)
                .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
                .filter(|s| s.get("t").and_then(|t| t.as_u64()).unwrap_or(0) >= cutoff)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        })
        .unwrap_or_default();

    Status {
        installed: shim_installed(),
        captured_at,
        age_seconds,
        latest,
        history,
    }
}

/// Parse "2026-07-09T07:06:50.901Z" to epoch ms without pulling in chrono.
fn humantime_parse(s: &str) -> Option<u64> {
    let date = s.get(0..10)?;
    let time = s.get(11..19)?;
    let mut dp = date.split('-');
    let (y, m, d) = (
        dp.next()?.parse::<i64>().ok()?,
        dp.next()?.parse::<u32>().ok()?,
        dp.next()?.parse::<u32>().ok()?,
    );
    let mut tp = time.split(':');
    let (hh, mm, ss) = (
        tp.next()?.parse::<i64>().ok()?,
        tp.next()?.parse::<i64>().ok()?,
        tp.next()?.parse::<i64>().ok()?,
    );
    // Days since epoch (civil-from-days algorithm, Howard Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = ((m as i64) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + (d as i64) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let secs = days * 86400 + hh * 3600 + mm * 60 + ss;
    u64::try_from(secs * 1000).ok()
}
