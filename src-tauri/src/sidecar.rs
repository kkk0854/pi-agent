//! host sidecar（Z-01）：内嵌 Node host 的启停 / 崩溃重启 / 端点注入。
//! - sidecar exe = make-sidecar.mjs 复制的 node 运行时（pi-agent-host-<triple>.exe）
//! - 入参 = esbuild 打包的 pi-agent-host.cjs（bundle 资源）
//! - 端点注入沿用 T02 机制：initialization_script 设 window.__PI_AGENT_HOST_OVERRIDE__
//!   （优先于 dist/index.html 里构建期注入的 __PI_AGENT_HOST__）

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 全局状态：sidecar 子进程 + 最近端点
pub struct HostSidecar {
    pub child: Mutex<Option<Child>>,
    pub endpoint: Mutex<Option<serde_json::Value>>,
}

fn is_exiting(app: &AppHandle) -> bool {
    *app.state::<crate::Exiting>().0.lock().unwrap_or_else(|e| e.into_inner())
}

/// host 数据根（与 packages/host config/paths.ts 同语义）
pub fn data_root() -> PathBuf {
    if let Ok(v) = std::env::var("PI_AGENT_DATA_DIR") {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    if cfg!(windows) {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join("AppData").join("Roaming"))
            .join("pi-agent")
    } else if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support").join("pi-agent")
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".local").join("share"))
            .join("pi-agent")
    }
}

fn host_json_path() -> PathBuf {
    data_root().join("host.json")
}

/// 轮询 host.json 直到有效端点出现（host listen 后写入）
pub fn wait_for_endpoint(timeout_ms: u64) -> Option<serde_json::Value> {
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if let Ok(raw) = std::fs::read_to_string(host_json_path()) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                let ok = v.get("httpUrl").and_then(|x| x.as_str()).is_some()
                    && v.get("wsUrl").and_then(|x| x.as_str()).is_some()
                    && v.get("token").and_then(|x| x.as_str()).is_some();
                if ok {
                    return Some(v);
                }
            }
        }
        if std::time::Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// 多候选定位 sidecar exe（dev：target/debug；安装后：主程序同目录）
pub fn find_sidecar_exe() -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent() {
            dirs.push(p.to_path_buf());
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("target").join("debug"));
        dirs.push(cwd.join("src-tauri").join("binaries"));
        dirs.push(cwd.join("binaries"));
    }
    for dir in dirs {
        // 安装布局：Tauri externalBin 打平为 <name>.exe（无 triple 后缀），与主程序同级
        let flat = dir.join("pi-agent-host.exe");
        if flat.is_file() {
            return Some(flat);
        }
        // 开发布局：<name>-<rustc-triple>.exe
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("pi-agent-host-") && name.ends_with(".exe") {
                    return Some(e.path());
                }
            }
        }
    }
    None
}

/// 多候选定位打包脚本（资源目录 / 源码目录）
pub fn find_host_script(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("binaries").join("pi-agent-host.cjs"));
        candidates.push(res.join("pi-agent-host.cjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(p) = exe.parent() {
            candidates.push(p.join("binaries").join("pi-agent-host.cjs"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri").join("binaries").join("pi-agent-host.cjs"));
        candidates.push(cwd.join("binaries").join("pi-agent-host.cjs"));
    }
    candidates.into_iter().find(|p| p.exists())
}

/// 把端点注入 webview（覆盖 dist 内构建期注入的旧端点）
fn inject_endpoint(app: &AppHandle, endpoint: &serde_json::Value) {
    if let Some(w) = app.get_webview_window("main") {
        // serde_json::Value 的 Display 即 JSON 字面量，可直接内插为 JS
        let js = format!("window.__PI_AGENT_HOST_OVERRIDE__ = {};", endpoint);
        let _ = w.eval(&js);
    }
}

/// 启动 host 并监视：异常退出（非应用退出中）→ 3s 后重启并重注入端点
pub fn spawn_and_monitor(app: AppHandle, exe: PathBuf, script: PathBuf, kb_port: u16, kb_token: String) {
    // 内置审批扩展目录（打包进资源 resources/extensions/，dev 回退仓库根）
    let ext_dir = find_extension_dir(&app, &script);

    std::thread::spawn(move || {
        loop {
            if is_exiting(&app) {
                break;
            }
            let mut cmd = Command::new(&exe);
            cmd.arg(&script)
                .env("PI_AGENT_KEYBRIDGE_URL", format!("http://127.0.0.1:{kb_port}"))
                .env("PI_AGENT_KEYBRIDGE_TOKEN", &kb_token);
            if let Some(ext) = &ext_dir {
                cmd.env("PI_AGENT_EXTENSION_DIR", ext);
            }
            let spawned = cmd.stdout(Stdio::null()).stderr(Stdio::null()).spawn();
            match spawned {
                Ok(mut child) => {
                    if let Ok(mut guard) = app.state::<HostSidecar>().child.lock() {
                        *guard = Some(child);
                    }
                    // 阻塞等待退出
                    if let Some(mut guard) = app.state::<HostSidecar>().child.lock().ok() {
                        if let Some(c) = guard.as_mut() {
                            let _ = c.wait();
                        }
                    }
                    if let Ok(mut guard) = app.state::<HostSidecar>().child.lock() {
                        *guard = None;
                    }
                    if is_exiting(&app) {
                        break;
                    }
                    eprintln!("[sidecar] host 进程退出，3s 后重启（Z-01 崩溃重启）");
                    std::thread::sleep(Duration::from_secs(3));
                    if is_exiting(&app) {
                        break;
                    }
                    if let Some(ep) = wait_for_endpoint(8000) {
                        if let Ok(mut guard) = app.state::<HostSidecar>().endpoint.lock() {
                            *guard = Some(ep.clone());
                        }
                        inject_endpoint(&app, &ep);
                        let _ = app.emit("host:endpoint-changed", ());
                    }
                }
                Err(e) => {
                    eprintln!("[sidecar] spawn 失败：{e}，3s 后重试");
                    std::thread::sleep(Duration::from_secs(3));
                }
            }
        }
    });
}

/// 内置审批扩展目录：资源目录 → sidecar 脚本同级 → 仓库根（dev）
fn find_extension_dir(app: &AppHandle, script: &PathBuf) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("extensions").join("pi-agent-permissions"));
    }
    if let Some(parent) = script.parent() {
        candidates.push(parent.join("extensions").join("pi-agent-permissions"));
        candidates.push(parent.join("../../extensions/pi-agent-permissions").join("pi-agent-permissions"));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("extensions").join("pi-agent-permissions"));
        candidates.push(cwd.join("../extensions/pi-agent-permissions"));
    }
    candidates.into_iter().find(|p| p.is_dir())
}

/// 应用退出时回收 sidecar
pub fn kill_child(app: &AppHandle) {
    if let Ok(mut guard) = app.state::<HostSidecar>().child.lock() {
        if let Some(mut c) = guard.take() {
            let _ = c.kill();
        }
    }
}

/// 前端可查询当前端点（端点变化重载后也可自取）
#[tauri::command]
pub fn host_endpoint(app: tauri::AppHandle) -> Option<serde_json::Value> {
    app.state::<HostSidecar>()
        .endpoint
        .lock()
        .ok()?
        .clone()
}
