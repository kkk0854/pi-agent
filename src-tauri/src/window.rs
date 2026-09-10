//! 自绘窗控命令（Z-03/Z-04）：最小化 / 最大化切换 / 关窗到托盘 / 标题。
//! 拖拽与双击最大化由前端 TitleBar 的 data-tauri-drag-region 提供（tao 内建）；
//! 无边框窗口的可调窗边缘（约 8px 隐形 hit-test 带）同样由 tao 在 Windows 上内建，
//! 本模块只暴露按钮语义，避免自定义 NCHITTEST 子类引入死区回归。

use tauri::Manager;

fn main_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

#[tauri::command]
pub fn window_minimize(app: tauri::AppHandle) {
    if let Some(w) = main_window(&app) {
        let _ = w.minimize();
    }
}

#[tauri::command]
pub fn window_toggle_maximize(app: tauri::AppHandle) {
    if let Some(w) = main_window(&app) {
        match w.is_maximized() {
            Ok(true) => {
                let _ = w.unmaximize();
            }
            Ok(false) => {
                let _ = w.maximize();
            }
            Err(_) => {}
        }
    }
}

#[tauri::command]
pub fn window_is_maximized(app: tauri::AppHandle) -> bool {
    main_window(&app)
        .and_then(|w| w.is_maximized().ok())
        .unwrap_or(false)
}

/// 关窗 = 隐藏到托盘（真正退出走托盘菜单「退出」，Z-06/U-07）
#[tauri::command]
pub fn window_close_to_tray(app: tauri::AppHandle) {
    if let Some(w) = main_window(&app) {
        let _ = w.hide();
    }
}

#[tauri::command]
pub fn window_set_title(app: tauri::AppHandle, title: String) {
    if let Some(w) = main_window(&app) {
        let _ = w.set_title(&title);
    }
}

/* ---------- 系统打开（HostBridge FsApi.openExternal / openDirs 的落点） ---------- */

/// URL → 系统默认浏览器；本地路径 → explorer（选中）
#[tauri::command]
pub fn open_external(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let result = if path.starts_with("http://") || path.starts_with("https://") {
            std::process::Command::new("cmd")
                .args(["/c", "start", "", &path])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        } else {
            std::process::Command::new("explorer")
                .arg(&path)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        };
        result.map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// 打开 host 日志目录（appData/logs）
#[tauri::command]
pub fn open_logs_dir() -> Result<(), String> {
    let dir = crate::sidecar::data_root().join("logs");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_external_impl(dir.to_string_lossy().as_ref())
}

/// 打开 host 数据目录（appData）
#[tauri::command]
pub fn open_data_dir() -> Result<(), String> {
    let dir = crate::sidecar::data_root();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open_external_impl(dir.to_string_lossy().as_ref())
}

fn open_external_impl(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer")
            .arg(path)
            .creation_flags(0x0800_0000)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}
