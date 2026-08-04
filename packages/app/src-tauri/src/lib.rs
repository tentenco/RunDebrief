use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

mod turn_log;

struct StartupClock(Instant);

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    gateway_url: Option<String>,
    summary_model: Option<String>,
    editor_cmd: Option<String>,
    terminal_app: Option<String>,
}

const DAEMON_LABEL: &str = "com.tenten.debrief-daemon";
const DAEMON_RESOURCE_DIRECTORY: &str = "debrief-daemon-runtime";
const DAEMON_NODE_PATH: &str = "bin/node";
const DAEMON_CLI_PATH: &str = "dist/cli.mjs";
const PRIVACY_SECURITY_URL: &str = "x-apple.systempreferences:com.apple.settings.PrivacySecurity";
const LEGACY_PRIVACY_SECURITY_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?General";
const DAEMON_STATUS_COMMAND_TIMEOUT: Duration = Duration::from_secs(8);
const DAEMON_INSTALL_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const APPLICATIONS_DIRECTORY: &str = "/Applications";
const VISUAL_STUDIO_CODE_BUNDLE: &str = "Visual Studio Code.app";
const WARP_BUNDLE: &str = "Warp.app";
// LaunchServices may accept a request while its `open` helper remains blocked.
// Bound only that child lifetime; external application delivery is not observed.
const APPLICATION_OPEN_REAPER_TIMEOUT: Duration = Duration::from_secs(5);
const APPLICATION_OPEN_REAPER_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    daemon: DaemonStatus,
    config: ConfigStatus,
    applications: ApplicationCapabilities,
    database_exists: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DaemonStatus {
    label: String,
    installed: bool,
    running: bool,
    pid: Option<u64>,
    state: Option<String>,
    #[serde(default)]
    runtime_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigStatus {
    exists: bool,
    gateway_configured: bool,
    summary_model_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplicationCapabilities {
    visual_studio_code: bool,
    warp: bool,
    editor: Option<EditorCapability>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorCapability {
    kind: String,
    name: String,
    available: bool,
}

#[tauri::command]
fn get_database_url(app: AppHandle) -> Result<String, String> {
    let path = database_path(&app)?;
    if !path.is_file() {
        return Err("Debrief database does not exist yet.".to_owned());
    }
    let path = path
        .to_str()
        .ok_or_else(|| "Debrief database path is not valid UTF-8.".to_owned())?;
    println!("{{\"event\":\"debrief_database_open\",\"mode\":\"ro\"}}");
    Ok(format!("sqlite:{path}?mode=ro"))
}

#[tauri::command]
fn get_runtime_status(app: AppHandle) -> Result<RuntimeStatus, String> {
    let daemon = run_daemon_cli(&app, &["daemon", "status"], DAEMON_STATUS_COMMAND_TIMEOUT)?;
    runtime_status(&app, daemon)
}

#[tauri::command]
async fn get_session_turn_log(
    app: AppHandle,
    session_id: i64,
    limit: Option<u32>,
) -> Result<turn_log::SessionTurnLogPage, String> {
    let database =
        database_path(&app).map_err(|_| "無法讀取這個 session 的原始紀錄。".to_owned())?;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "無法讀取這個 session 的原始紀錄。".to_owned())?;
    turn_log::load_session_turn_log(&database, &home, session_id, limit)
        .await
        .map_err(|error| {
            eprintln!(
                "{}",
                serde_json::json!({
                    "event": "session_turn_log_failed",
                    "sessionId": session_id,
                    "reason": error.category(),
                })
            );
            error.user_message().to_owned()
        })
}

#[tauri::command]
fn install_daemon(app: AppHandle) -> Result<RuntimeStatus, String> {
    let resource = daemon_resource_path(&app)?;
    let source = resource
        .to_str()
        .ok_or_else(|| "Bundled daemon path is not valid UTF-8.".to_owned())?;
    let daemon = run_daemon_cli(
        &app,
        &["daemon", "install", "--runtime-source", source],
        DAEMON_INSTALL_COMMAND_TIMEOUT,
    )?;
    runtime_status(&app, daemon)
}

#[tauri::command]
fn open_privacy_security() -> Result<(), String> {
    if open_system_settings(PRIVACY_SECURITY_URL).is_ok() {
        return Ok(());
    }
    open_system_settings(LEGACY_PRIVACY_SECURITY_URL)
}

#[tauri::command]
fn report_frontend_error(message: String) {
    let sanitized = message.replace(['\n', '\r'], " ");
    eprintln!(
        "{}",
        serde_json::json!({
            "event": "debrief_frontend_error",
            "message": sanitized,
        })
    );
}

#[tauri::command]
fn report_frontend_event(name: String, clock: State<'_, StartupClock>) {
    if matches!(
        name.as_str(),
        "database-loaded"
            | "projects-loaded"
            | "sessions-loaded"
            | "summaries-loaded"
            | "live-status-loaded"
            | "data-loaded"
            | "dom-commit"
            | "raf-unavailable"
    ) {
        println!(
            "{}",
            serde_json::json!({
                "event": "debrief_frontend_checkpoint",
                "name": name,
                "elapsedMs": clock.0.elapsed().as_millis() as u64,
            })
        );
    }
}

#[tauri::command]
fn copy_recap(recap: String) -> Result<(), String> {
    if recap.len() > 2 * 1024 * 1024 {
        return Err("Recap is unexpectedly large.".to_owned());
    }
    write_clipboard(recap.as_bytes())
}

fn write_clipboard(contents: &[u8]) -> Result<(), String> {
    let mut child = Command::new("/usr/bin/pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not access the clipboard: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Could not access clipboard input.".to_owned())?
        .write_all(contents)
        .map_err(|error| format!("Could not write to the clipboard: {error}"))?;
    let status = child
        .wait()
        .map_err(|error| format!("Could not finish clipboard write: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Clipboard write failed.".to_owned())
    }
}

#[tauri::command]
fn report_first_paint(clock: State<'_, StartupClock>) -> u64 {
    let elapsed_ms = clock.0.elapsed().as_millis() as u64;
    println!("{{\"event\":\"debrief_first_data_paint\",\"elapsedMs\":{elapsed_ms}}}");
    elapsed_ms
}

#[tauri::command]
async fn set_summary_acknowledged(
    app: AppHandle,
    summary_id: i64,
    acknowledged: bool,
) -> Result<(), String> {
    update_summary_acknowledged(&database_path(&app)?, summary_id, acknowledged).await
}

async fn update_summary_acknowledged(
    path: &Path,
    summary_id: i64,
    acknowledged: bool,
) -> Result<(), String> {
    let mut db = write_connection(path).await?;
    let result = sqlx::query("UPDATE summaries SET acknowledged = ? WHERE id = ?")
        .bind(acknowledged)
        .bind(summary_id)
        .execute(&mut db)
        .await
        .map_err(database_error)?;
    require_one_row(result.rows_affected())
}

#[tauri::command]
async fn set_project_pinned(app: AppHandle, project_id: i64, pinned: bool) -> Result<(), String> {
    update_project_pinned(&database_path(&app)?, project_id, pinned).await
}

async fn update_project_pinned(path: &Path, project_id: i64, pinned: bool) -> Result<(), String> {
    let mut db = write_connection(path).await?;
    let result = sqlx::query("UPDATE projects SET pinned = ? WHERE id = ?")
        .bind(pinned)
        .bind(project_id)
        .execute(&mut db)
        .await
        .map_err(database_error)?;
    require_one_row(result.rows_affected())
}

#[tauri::command]
async fn set_project_hidden(app: AppHandle, project_id: i64, hidden: bool) -> Result<(), String> {
    update_project_hidden(&database_path(&app)?, project_id, hidden).await
}

async fn update_project_hidden(path: &Path, project_id: i64, hidden: bool) -> Result<(), String> {
    let mut db = write_connection(path).await?;
    let result = sqlx::query("UPDATE projects SET hidden = ? WHERE id = ?")
        .bind(hidden)
        .bind(project_id)
        .execute(&mut db)
        .await
        .map_err(database_error)?;
    require_one_row(result.rows_affected())
}

#[tauri::command]
async fn set_project_client(
    app: AppHandle,
    project_id: i64,
    client: Option<String>,
) -> Result<(), String> {
    let normalized = client
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if normalized
        .as_ref()
        .is_some_and(|value| value.chars().count() > 120)
    {
        return Err("Client name is too long.".to_owned());
    }
    update_project_client(&database_path(&app)?, project_id, normalized).await
}

async fn update_project_client(
    path: &Path,
    project_id: i64,
    client: Option<String>,
) -> Result<(), String> {
    let mut db = write_connection(path).await?;
    let result = sqlx::query("UPDATE projects SET client = ? WHERE id = ?")
        .bind(client)
        .bind(project_id)
        .execute(&mut db)
        .await
        .map_err(database_error)?;
    require_one_row(result.rows_affected())
}

#[tauri::command]
async fn set_project_name(app: AppHandle, project_id: i64, name: String) -> Result<(), String> {
    let normalized = name.trim();
    if normalized.is_empty() || normalized.chars().count() > 200 {
        return Err("Project name must be between 1 and 200 characters.".to_owned());
    }
    update_project_name(&database_path(&app)?, project_id, normalized).await
}

async fn update_project_name(path: &Path, project_id: i64, name: &str) -> Result<(), String> {
    let mut db = write_connection(path).await?;
    let result = sqlx::query("UPDATE projects SET name = ? WHERE id = ?")
        .bind(name)
        .bind(project_id)
        .execute(&mut db)
        .await
        .map_err(database_error)?;
    require_one_row(result.rows_affected())
}

#[tauri::command]
fn open_in_editor(app: AppHandle, project_path: String) -> Result<(), String> {
    let project_path = validate_project_path(&project_path)?;
    let config = read_config(&app);
    let Some(configured) = config.editor_cmd.as_deref() else {
        return open_detected_editor(&project_path);
    };
    let parts = split_command(configured)?;
    let executable = parts
        .first()
        .ok_or_else(|| "Editor command is empty.".to_owned())?;
    let executable_name = Path::new(executable)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(executable);
    if !matches!(executable_name, "cursor" | "code" | "zed") {
        return Err("editorCmd must invoke cursor, code, or zed.".to_owned());
    }

    match Command::new(executable)
        .args(&parts[1..])
        .arg(&project_path)
        .spawn()
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            open_editor_app(executable_name, &project_path)
        }
        Err(error) => Err(format!("Could not open editor: {error}")),
    }
}

#[tauri::command]
fn open_in_visual_studio_code(project_path: String) -> Result<(), String> {
    let project_path = validate_project_path(&project_path)?;
    let applications_directory = Path::new(APPLICATIONS_DIRECTORY);
    if applications_directory
        .join(VISUAL_STUDIO_CODE_BUNDLE)
        .is_dir()
    {
        return open_application_at(
            &project_path,
            applications_directory,
            VISUAL_STUDIO_CODE_BUNDLE,
            "Visual Studio Code",
        );
    }
    if executable_available("code") {
        return open_executable_at("code", &project_path, "Visual Studio Code");
    }
    Err("Visual Studio Code is not installed and its code CLI is unavailable.".to_owned())
}

#[tauri::command]
fn open_in_warp(project_path: String) -> Result<(), String> {
    let project_path = validate_project_path(&project_path)?;
    open_application_at(
        &project_path,
        Path::new(APPLICATIONS_DIRECTORY),
        WARP_BUNDLE,
        "Warp",
    )
}

#[tauri::command]
fn open_in_terminal(
    app: AppHandle,
    project_path: String,
    tmux_target: Option<String>,
) -> Result<(), String> {
    let project_path = validate_project_path(&project_path)?;
    let terminal = terminal_app(&app);
    open_terminal_at(&project_path, terminal, tmux_target)
}

fn open_terminal_at(
    project_path: &Path,
    terminal: &str,
    tmux_target: Option<String>,
) -> Result<(), String> {
    if let Some(target) = tmux_target.filter(|value| !value.trim().is_empty()) {
        validate_tmux_target(&target)?;
        let script = if terminal == "iTerm" {
            ITERM_TMUX_SCRIPT
        } else {
            TERMINAL_TMUX_SCRIPT
        };
        return Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .arg("--")
            .arg(project_path)
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Could not attach terminal session: {error}"));
    }

    Command::new("/usr/bin/open")
        .args(["-a", terminal])
        .arg(project_path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open terminal: {error}"))
}

async fn write_connection(path: &Path) -> Result<SqliteConnection, String> {
    if !path.is_file() {
        return Err("Debrief database does not exist yet.".to_owned());
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(2))
        .foreign_keys(true);
    SqliteConnection::connect_with(&options)
        .await
        .map_err(database_error)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(configured) = env::var_os("DEBRIEF_DB_PATH") {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err("DEBRIEF_DB_PATH must be absolute.".to_owned());
        }
        return Ok(path);
    }
    app.path()
        .home_dir()
        .map(|home| home.join(".debrief").join("debrief.db"))
        .map_err(|error| format!("Could not resolve home directory: {error}"))
}

fn runtime_status(app: &AppHandle, daemon: DaemonStatus) -> Result<RuntimeStatus, String> {
    if daemon.label != DAEMON_LABEL {
        return Err("Daemon status returned an unexpected launchd label.".to_owned());
    }
    let config = read_config(app);
    Ok(RuntimeStatus {
        daemon,
        config: config_status_at(
            &config_path(app).ok_or_else(|| "Could not resolve Debrief config path.".to_owned())?,
        ),
        applications: application_capabilities_at(&config, Path::new(APPLICATIONS_DIRECTORY)),
        database_exists: database_path(app)?.is_file(),
    })
}

fn config_status_at(path: &Path) -> ConfigStatus {
    let exists = path.is_file();
    let config = fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<AppConfig>(&contents).ok())
        .unwrap_or_default();
    ConfigStatus {
        exists,
        gateway_configured: configured(config.gateway_url.as_deref()),
        summary_model_configured: configured(config.summary_model.as_deref()),
    }
}

fn configured(value: Option<&str>) -> bool {
    value.is_some_and(|candidate| !candidate.trim().is_empty())
}

fn daemon_resource_path(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(configured) = env::var_os("DEBRIEF_DAEMON_RUNTIME_PATH") {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err("DEBRIEF_DAEMON_RUNTIME_PATH must be absolute.".to_owned());
        }
        return Ok(path);
    }
    app.path()
        .resource_dir()
        .map(|directory| directory.join(DAEMON_RESOURCE_DIRECTORY))
        .map_err(|error| format!("Could not resolve bundled daemon runtime: {error}"))
}

fn run_daemon_cli(
    app: &AppHandle,
    arguments: &[&str],
    timeout: Duration,
) -> Result<DaemonStatus, String> {
    let resource = daemon_resource_path(app)?;
    let node = resource.join(DAEMON_NODE_PATH);
    let cli = resource.join(DAEMON_CLI_PATH);
    if !node.is_file() || !cli.is_file() {
        return Err(
            "The Debrief installer is incomplete. Reinstall the app from its DMG.".to_owned(),
        );
    }
    let mut command = Command::new(node);
    command.arg(cli).args(arguments);
    let output = command_output_with_timeout(command, timeout)?;
    if !output.status.success() {
        let reason = sanitized_process_message(&output.stderr);
        return Err(if reason.is_empty() {
            "The Debrief background service command failed.".to_owned()
        } else {
            format!("The Debrief background service command failed: {reason}")
        });
    }
    let status: DaemonStatus = serde_json::from_slice(&output.stdout)
        .map_err(|_| "The background service returned an invalid status.".to_owned())?;
    if status.label != DAEMON_LABEL {
        return Err("The background service returned an unexpected launchd label.".to_owned());
    }
    Ok(status)
}

fn command_output_with_timeout(mut command: Command, timeout: Duration) -> Result<Output, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the Debrief background service: {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("Could not read background service status: {error}"));
            }
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "The background service command exceeded {} seconds.",
                    timeout.as_secs()
                ));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Could not monitor the background service: {error}"));
            }
        }
    }
}

fn sanitized_process_message(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .replace(['\n', '\r'], " ")
        .trim()
        .chars()
        .take(400)
        .collect()
}

fn open_system_settings(url: &str) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|error| format!("Could not open macOS System Settings: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("macOS System Settings did not accept the Privacy & Security link.".to_owned())
    }
}

fn open_detected_editor(project_path: &Path) -> Result<(), String> {
    for (bundle_path, app_name) in [
        ("/Applications/Cursor.app", "Cursor"),
        ("/Applications/Visual Studio Code.app", "Visual Studio Code"),
        ("/Applications/Zed.app", "Zed"),
    ] {
        if Path::new(bundle_path).is_dir() {
            return Command::new("/usr/bin/open")
                .args(["-a", app_name])
                .arg(project_path)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("Could not open editor: {error}"));
        }
    }
    Err("No supported editor was found. Set editorCmd in config.json.".to_owned())
}

fn application_capabilities_at(
    config: &AppConfig,
    applications_directory: &Path,
) -> ApplicationCapabilities {
    let visual_studio_code = applications_directory
        .join(VISUAL_STUDIO_CODE_BUNDLE)
        .is_dir()
        || executable_available("code");
    let warp = applications_directory.join(WARP_BUNDLE).is_dir();
    let editor = config
        .editor_cmd
        .as_deref()
        .and_then(|configured| split_command(configured).ok())
        .and_then(|parts| {
            let executable = parts.first()?;
            let executable_name = Path::new(executable)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(executable);
            let (kind, name, bundle) = editor_identity(executable_name)?;
            Some(EditorCapability {
                kind: kind.to_owned(),
                name: name.to_owned(),
                available: executable_available(executable)
                    || applications_directory.join(bundle).is_dir(),
            })
        })
        .or_else(|| {
            [
                ("cursor", "Cursor", "Cursor.app"),
                (
                    "visual-studio-code",
                    "Visual Studio Code",
                    VISUAL_STUDIO_CODE_BUNDLE,
                ),
                ("zed", "Zed", "Zed.app"),
            ]
            .into_iter()
            .find(|(_, _, bundle)| applications_directory.join(bundle).is_dir())
            .map(|(kind, name, _)| EditorCapability {
                kind: kind.to_owned(),
                name: name.to_owned(),
                available: true,
            })
        });
    ApplicationCapabilities {
        visual_studio_code,
        warp,
        editor,
    }
}

fn editor_identity(executable_name: &str) -> Option<(&'static str, &'static str, &'static str)> {
    match executable_name {
        "cursor" => Some(("cursor", "Cursor", "Cursor.app")),
        "code" => Some((
            "visual-studio-code",
            "Visual Studio Code",
            VISUAL_STUDIO_CODE_BUNDLE,
        )),
        "zed" => Some(("zed", "Zed", "Zed.app")),
        _ => None,
    }
}

fn executable_available(executable: &str) -> bool {
    let path = Path::new(executable);
    if path.components().count() > 1 {
        return path.is_file();
    }
    env::var_os("PATH").is_some_and(|paths| {
        env::split_paths(&paths).any(|directory| directory.join(executable).is_file())
    })
}

fn open_application_at(
    project_path: &Path,
    applications_directory: &Path,
    bundle: &str,
    app_name: &str,
) -> Result<(), String> {
    if !applications_directory.join(bundle).is_dir() {
        return Err(format!("{app_name} is not installed."));
    }
    let mut command = Command::new("/usr/bin/open");
    command.args(["-a", app_name]).arg(project_path);
    spawn_reaped_command(
        &mut command,
        APPLICATION_OPEN_REAPER_TIMEOUT,
        APPLICATION_OPEN_REAPER_POLL_INTERVAL,
    )
    .map(|_| ())
    .map_err(|error| format!("Could not open {app_name}: {error}"))
}

fn spawn_reaped_command(
    command: &mut Command,
    timeout: Duration,
    poll_interval: Duration,
) -> io::Result<thread::JoinHandle<io::Result<(ExitStatus, bool)>>> {
    let child = command.spawn()?;
    Ok(thread::spawn(move || {
        let result = reap_child_with_timeout(child, timeout, poll_interval);
        if let Err(error) = &result {
            eprintln!(
                "{}",
                serde_json::json!({
                    "event": "application_open_reaper_failed",
                    "reason": error.to_string(),
                })
            );
        }
        result
    }))
}

fn reap_child_with_timeout(
    mut child: Child,
    timeout: Duration,
    poll_interval: Duration,
) -> io::Result<(ExitStatus, bool)> {
    let started = Instant::now();
    let poll_interval = if poll_interval.is_zero() {
        Duration::from_millis(1)
    } else {
        poll_interval
    };
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok((status, false));
        }
        let remaining = timeout.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            if let Err(error) = child.kill() {
                if let Some(status) = child.try_wait()? {
                    return Ok((status, false));
                }
                return Err(error);
            }
            return child.wait().map(|status| (status, true));
        }
        thread::sleep(poll_interval.min(remaining));
    }
}

fn open_executable_at(executable: &str, project_path: &Path, app_name: &str) -> Result<(), String> {
    let status = Command::new(executable)
        .arg(project_path)
        .status()
        .map_err(|error| format!("Could not open {app_name}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{app_name} did not accept the project path."))
    }
}

fn open_editor_app(executable_name: &str, project_path: &Path) -> Result<(), String> {
    let app_name = match executable_name {
        "cursor" => "Cursor",
        "code" => "Visual Studio Code",
        "zed" => "Zed",
        _ => return Err("Configured editor command was not found.".to_owned()),
    };
    Command::new("/usr/bin/open")
        .args(["-a", app_name])
        .arg(project_path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open editor: {error}"))
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .home_dir()
        .ok()
        .map(|home| home.join(".debrief").join("config.json"))
}

fn read_config(app: &AppHandle) -> AppConfig {
    let Some(path) = config_path(app) else {
        return AppConfig::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn validate_project_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute() {
        return Err("Project path must be absolute.".to_owned());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "Project path no longer exists.".to_owned())?;
    if !canonical.is_dir() {
        return Err("Project path is not a directory.".to_owned());
    }
    Ok(canonical)
}

fn terminal_app(app: &AppHandle) -> &'static str {
    if let Some(configured) = read_config(app).terminal_app {
        let normalized = configured.to_ascii_lowercase();
        if normalized.contains("iterm") {
            return "iTerm";
        }
        if normalized.contains("terminal") {
            return "Terminal";
        }
    }
    if Path::new("/Applications/iTerm.app").is_dir() {
        "iTerm"
    } else {
        "Terminal"
    }
}

fn validate_tmux_target(value: &str) -> Result<(), String> {
    if value.len() > 160
        || value.is_empty()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err("Invalid tmux target.".to_owned());
    }
    Ok(())
}

fn split_command(value: &str) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(marker) = quote {
            if character == marker {
                quote = None;
            } else {
                current.push(character);
            }
            continue;
        }
        if matches!(character, '\'' | '"') {
            quote = Some(character);
        } else if character.is_whitespace() {
            if !current.is_empty() {
                result.push(std::mem::take(&mut current));
            }
        } else {
            current.push(character);
        }
    }
    if escaped || quote.is_some() {
        return Err("editorCmd contains an incomplete quote or escape.".to_owned());
    }
    if !current.is_empty() {
        result.push(current);
    }
    Ok(result)
}

fn require_one_row(rows_affected: u64) -> Result<(), String> {
    if rows_affected == 1 {
        Ok(())
    } else {
        Err("The requested record no longer exists.".to_owned())
    }
}

fn database_error(error: sqlx::Error) -> String {
    format!("Database operation failed: {error}")
}

const TERMINAL_TMUX_SCRIPT: &str = r#"
on run argv
  set projectPath to item 1 of argv
  set targetName to item 2 of argv
  tell application "Terminal"
    activate
    do script "cd " & quoted form of projectPath & " && tmux attach-session -t " & quoted form of targetName
  end tell
end run
"#;

const ITERM_TMUX_SCRIPT: &str = r#"
on run argv
  set projectPath to item 1 of argv
  set targetName to item 2 of argv
  set terminalCommand to "cd " & quoted form of projectPath & " && tmux attach-session -t " & quoted form of targetName
  tell application "iTerm"
    activate
    if (count of windows) is 0 then
      set terminalWindow to (create window with default profile)
      tell current session of terminalWindow to write text terminalCommand
    else
      tell current window
        set terminalTab to (create tab with default profile)
        tell current session of terminalTab to write text terminalCommand
      end tell
    end if
  end tell
end run
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(StartupClock(Instant::now()))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Regular)?;

            let window = app
                .get_webview_window("main")
                .ok_or("the configured main window was not created")?;
            window.center()?;
            window.unminimize()?;
            window.show()?;
            window.set_focus()?;
            let visible = window.is_visible()?;
            let minimized = window.is_minimized()?;
            let size = window.outer_size()?;
            let position = window.outer_position()?;
            println!(
                "{{\"event\":\"debrief_window_ready\",\"visible\":{visible},\"minimized\":{minimized},\"width\":{},\"height\":{},\"x\":{},\"y\":{}}}",
                size.width, size.height, position.x, position.y
            );
            Ok(())
        })
        .on_page_load(|webview, payload| {
            println!(
                "{}",
                serde_json::json!({
                    "event": "debrief_page_load",
                    "state": format!("{:?}", payload.event()),
                })
            );
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let window = webview.window();
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_database_url,
            get_runtime_status,
            get_session_turn_log,
            install_daemon,
            open_privacy_security,
            copy_recap,
            report_first_paint,
            report_frontend_error,
            report_frontend_event,
            set_summary_acknowledged,
            set_project_pinned,
            set_project_hidden,
            set_project_client,
            set_project_name,
            open_in_editor,
            open_in_visual_studio_code,
            open_in_warp,
            open_in_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running Debrief");
}

#[cfg(test)]
mod tests {
    use super::{
        application_capabilities_at, command_output_with_timeout, config_status_at, copy_recap,
        open_application_at, open_detected_editor, open_terminal_at, sanitized_process_message,
        spawn_reaped_command, split_command, update_project_client, update_project_hidden,
        update_project_name, update_project_pinned, update_summary_acknowledged,
        validate_project_path, validate_tmux_target, write_clipboard, AppConfig, DaemonStatus,
        APPLICATIONS_DIRECTORY, APPLICATION_OPEN_REAPER_POLL_INTERVAL,
        APPLICATION_OPEN_REAPER_TIMEOUT, DAEMON_CLI_PATH, DAEMON_INSTALL_COMMAND_TIMEOUT,
        DAEMON_LABEL, DAEMON_NODE_PATH, DAEMON_STATUS_COMMAND_TIMEOUT, LEGACY_PRIVACY_SECURITY_URL,
        PRIVACY_SECURITY_URL, VISUAL_STUDIO_CODE_BUNDLE, WARP_BUNDLE,
    };
    use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
    use sqlx::{Connection, Row};
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn editor_command_is_split_without_a_shell() {
        assert_eq!(
            split_command("code --reuse-window").unwrap(),
            vec!["code", "--reuse-window"],
        );
        assert_eq!(
            split_command("\"/usr/local/bin/zed\" --wait").unwrap(),
            vec!["/usr/local/bin/zed", "--wait"],
        );
    }

    #[test]
    fn tmux_target_rejects_shell_metacharacters() {
        assert!(validate_tmux_target("debrief:0.1").is_ok());
        assert!(validate_tmux_target("debrief; open /tmp").is_err());
        assert!(validate_tmux_target("$(touch /tmp/nope)").is_err());
    }

    #[test]
    fn runtime_contract_uses_only_fixed_paths_label_and_privacy_links() {
        assert_eq!(DAEMON_LABEL, "com.tenten.debrief-daemon");
        assert_eq!(DAEMON_NODE_PATH, "bin/node");
        assert_eq!(DAEMON_CLI_PATH, "dist/cli.mjs");
        assert_eq!(DAEMON_STATUS_COMMAND_TIMEOUT, Duration::from_secs(8));
        assert_eq!(DAEMON_INSTALL_COMMAND_TIMEOUT, Duration::from_secs(60));
        assert_eq!(
            PRIVACY_SECURITY_URL,
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity",
        );
        assert_eq!(
            LEGACY_PRIVACY_SECURITY_URL,
            "x-apple.systempreferences:com.apple.preference.security?General",
        );
        assert_eq!(APPLICATIONS_DIRECTORY, "/Applications");
        assert_eq!(VISUAL_STUDIO_CODE_BUNDLE, "Visual Studio Code.app");
        assert_eq!(WARP_BUNDLE, "Warp.app");
        assert_eq!(APPLICATION_OPEN_REAPER_TIMEOUT, Duration::from_secs(5));
        assert_eq!(
            APPLICATION_OPEN_REAPER_POLL_INTERVAL,
            Duration::from_millis(25),
        );
    }

    #[test]
    fn application_capabilities_cover_present_absent_and_configured_editor_states() {
        let directory = temp_directory("application-capabilities");
        fs::create_dir_all(directory.join(VISUAL_STUDIO_CODE_BUNDLE)).unwrap();
        fs::create_dir_all(directory.join(WARP_BUNDLE)).unwrap();

        let present = application_capabilities_at(&AppConfig::default(), &directory);
        assert!(present.visual_studio_code);
        assert!(present.warp);
        let editor = present.editor.expect("detected VS Code editor");
        assert_eq!(editor.kind, "visual-studio-code");
        assert_eq!(editor.name, "Visual Studio Code");
        assert!(editor.available);

        let absent_directory = directory.join("absent");
        fs::create_dir_all(&absent_directory).unwrap();
        let configured_cursor = application_capabilities_at(
            &AppConfig {
                editor_cmd: Some("cursor --reuse-window".to_owned()),
                ..AppConfig::default()
            },
            &absent_directory,
        );
        assert!(!configured_cursor.visual_studio_code);
        assert!(!configured_cursor.warp);
        let editor = configured_cursor
            .editor
            .expect("configured editor identity");
        assert_eq!(editor.kind, "cursor");
        assert_eq!(editor.name, "Cursor");
        assert!(!editor.available);

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unavailable_named_application_fails_before_spawning_open() {
        let directory = temp_directory("missing-application");
        fs::create_dir_all(&directory).unwrap();
        let project = directory.join("project");
        fs::create_dir_all(&project).unwrap();

        let error = open_application_at(&project, &directory, WARP_BUNDLE, "Warp")
            .expect_err("missing Warp bundle must not silently succeed");
        assert_eq!(error, "Warp is not installed.");

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn application_open_spawn_returns_before_the_child_exits() {
        let mut command = Command::new("/bin/sleep");
        command.arg("5");
        let started = std::time::Instant::now();
        let reaper = spawn_reaped_command(
            &mut command,
            Duration::from_millis(100),
            Duration::from_millis(1),
        )
        .expect("sleep must spawn");
        assert!(started.elapsed() < Duration::from_millis(100));

        let (_, timed_out) = reaper
            .join()
            .expect("reaper thread must finish")
            .expect("reaper must collect the child");
        assert!(timed_out);
    }

    #[test]
    fn application_open_reaper_kills_and_waits_for_a_stuck_child() {
        let mut command = Command::new("/bin/sleep");
        command.arg("30");
        let started = std::time::Instant::now();
        let reaper = spawn_reaped_command(
            &mut command,
            Duration::from_millis(20),
            Duration::from_millis(1),
        )
        .expect("sleep must spawn");
        let (status, timed_out) = reaper
            .join()
            .expect("reaper thread must finish")
            .expect("reaper must collect the child");

        assert!(timed_out);
        assert!(!status.success());
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn application_open_spawn_failure_is_returned_without_a_reaper() {
        let directory = temp_directory("missing-open-executable");
        let mut command = Command::new(directory.join("missing"));
        let error = spawn_reaped_command(
            &mut command,
            Duration::from_millis(20),
            Duration::from_millis(1),
        )
        .expect_err("missing executable must fail before a reaper starts");

        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn runtime_status_is_redacted_and_accepts_installer_metadata() {
        let directory = temp_directory("config-status");
        fs::create_dir_all(&directory).unwrap();
        let config_path = directory.join("config.json");
        fs::write(
            &config_path,
            r#"{
              "gatewayUrl": "https://gateway.example.invalid",
              "gatewayKey": "must-not-leak",
              "summaryModel": "fixture-model"
            }"#,
        )
        .unwrap();

        let config = config_status_at(&config_path);
        let serialized = serde_json::to_string(&config).unwrap();
        assert!(config.exists);
        assert!(config.gateway_configured);
        assert!(config.summary_model_configured);
        assert!(!serialized.contains("gateway.example.invalid"));
        assert!(!serialized.contains("must-not-leak"));
        assert!(!serialized.contains("fixture-model"));

        let daemon: DaemonStatus = serde_json::from_str(
            r#"{
              "label": "com.tenten.debrief-daemon",
              "installed": true,
              "running": true,
              "pid": 5151,
              "state": "running",
              "plistPath": "/tmp/fixture.plist",
              "runtimePath": "/tmp/runtime",
              "runtimeVersion": "0.1.0"
            }"#,
        )
        .unwrap();
        assert_eq!(daemon.label, DAEMON_LABEL);
        assert_eq!(daemon.runtime_version.as_deref(), Some("0.1.0"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_process_output_is_bounded_and_sanitized() {
        let mut command = Command::new("/usr/bin/printf");
        command.arg("{\"label\":\"com.tenten.debrief-daemon\"}");
        let output = command_output_with_timeout(command, Duration::from_secs(1)).unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            "{\"label\":\"com.tenten.debrief-daemon\"}",
        );
        assert_eq!(
            sanitized_process_message(b"first line\nsecond line\r\n"),
            "first line second line",
        );
    }

    #[test]
    fn whitelisted_writes_touch_only_approved_columns() {
        tauri::async_runtime::block_on(async {
            let directory = temp_directory("write-boundary");
            fs::create_dir_all(&directory).unwrap();
            let database_path = directory.join("debrief.db");
            let options = SqliteConnectOptions::new()
                .filename(&database_path)
                .create_if_missing(true);
            let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
            sqlx::raw_sql(include_str!("../../../core/migrations/001_initial.sql"))
                .execute(&mut connection)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO projects
                  (id, path, name, client, pinned, hidden, brain_linked, last_activity_at)
                 VALUES (1, '/tmp/original', 'Original', NULL, 0, 0, 1, '2026-07-29T00:00:00Z')",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO summaries
                  (id, project_id, state_summary, acknowledged)
                 VALUES (1, 1, 'Original summary', 0)",
            )
            .execute(&mut connection)
            .await
            .unwrap();
            connection.close().await.unwrap();

            update_project_pinned(&database_path, 1, true)
                .await
                .unwrap();
            update_project_hidden(&database_path, 1, true)
                .await
                .unwrap();
            update_project_client(&database_path, 1, Some("Example Co".to_owned()))
                .await
                .unwrap();
            update_project_name(&database_path, 1, "Debrief G3")
                .await
                .unwrap();
            update_summary_acknowledged(&database_path, 1, true)
                .await
                .unwrap();

            let mut verification = SqliteConnection::connect_with(
                &SqliteConnectOptions::new().filename(&database_path),
            )
            .await
            .unwrap();
            let project = sqlx::query(
                "SELECT path, name, client, pinned, hidden, brain_linked,
                        last_activity_at
                   FROM projects WHERE id = 1",
            )
            .fetch_one(&mut verification)
            .await
            .unwrap();
            assert_eq!(project.get::<String, _>("path"), "/tmp/original");
            assert_eq!(project.get::<String, _>("name"), "Debrief G3");
            assert_eq!(
                project.get::<Option<String>, _>("client").as_deref(),
                Some("Example Co")
            );
            assert_eq!(project.get::<i64, _>("pinned"), 1);
            assert_eq!(project.get::<i64, _>("hidden"), 1);
            assert_eq!(project.get::<i64, _>("brain_linked"), 1);
            assert_eq!(
                project.get::<String, _>("last_activity_at"),
                "2026-07-29T00:00:00Z",
            );
            let summary =
                sqlx::query("SELECT state_summary, acknowledged FROM summaries WHERE id = 1")
                    .fetch_one(&mut verification)
                    .await
                    .unwrap();
            assert_eq!(
                summary.get::<String, _>("state_summary"),
                "Original summary",
            );
            assert_eq!(summary.get::<i64, _>("acknowledged"), 1);
            verification.close().await.unwrap();
            fs::remove_dir_all(directory).unwrap();
        });
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn recap_copy_round_trips_and_restores_the_clipboard() {
        let original = Command::new("/usr/bin/pbpaste")
            .output()
            .expect("pbpaste must be available")
            .stdout;
        copy_recap("# Recap — Debrief G3".to_owned()).unwrap();
        let observed = Command::new("/usr/bin/pbpaste")
            .output()
            .expect("pbpaste must be available")
            .stdout;
        write_clipboard(&original).expect("original clipboard must be restored");
        assert_eq!(observed, "# Recap — Debrief G3".as_bytes());
    }

    #[test]
    #[ignore = "G3 host action: opens the real project in terminal and editor"]
    #[cfg(target_os = "macos")]
    fn real_project_open_actions() {
        let configured = env::var("DEBRIEF_G3_PROJECT_PATH").expect("set real project path");
        let project_path = validate_project_path(&configured).unwrap();
        open_terminal_at(&project_path, "iTerm", None).unwrap();
        open_detected_editor(&project_path).unwrap();
    }

    fn temp_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("debrief-{label}-{}-{nonce}", std::process::id(),))
    }
}
