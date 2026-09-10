//! pi-agent 桌面壳（Tauri 2 · T05）：
//! - Z-01 sidecar 内嵌 host（启停/崩溃重启/端点注入，见 sidecar.rs）
//! - Z-03/Z-04 无边框自绘窗控（decorations:false + 前端 drag-region + 本模块命令）
//! - Z-06 托盘常驻 + 关窗到托盘（U-07）
//! - A-09 通知点击深链直达会话审批（notify.rs + Focused 事件）
//! - Z-10/Q-03 钥匙串（keychain.rs）+ host 本地桥（keybridge.rs）

mod cli;
mod keybridge;
mod keychain;
mod notify;
mod sidecar;
mod tray;
mod window;

use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use notify::DeepLink;

/// 全局「正在退出」标记：区分「关窗到托盘」与「真退出」
pub struct Exiting(pub Mutex<bool>);

pub fn run() {
    if cli::handle_early_args() {
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Exiting(Mutex::new(false)))
        .manage(DeepLink(Mutex::new(None)))
        .manage(sidecar::HostSidecar {
            child: Mutex::new(None),
            endpoint: Mutex::new(None),
        })
        .setup(|app| {
            // 1) 钥匙串桥：供 sidecar host 调（Q-03）
            let (kb_port, kb_token) = keybridge::start_bridge()
                .map_err(|e| format!("keybridge 启动失败：{e}"))?;

            // 2) sidecar host（Z-01）：未打包时给出可读错误
            let exe = sidecar::find_sidecar_exe()
                .ok_or("sidecar exe 未找到：请先运行 node scripts/make-sidecar.mjs")?;
            let script = sidecar::find_host_script(app.handle())
                .ok_or("pi-agent-host.cjs 未找到：请先运行 node scripts/make-sidecar.mjs")?;
            sidecar::spawn_and_monitor(app.handle().clone(), exe, script, kb_port, kb_token);

            // 3) 等端点（host listen 后写 host.json），超时注入 null → 前端离线模式
            let endpoint = sidecar::wait_for_endpoint(8000);
            if let Some(ep) = endpoint.clone() {
                if let Ok(mut guard) = app
                    .state::<sidecar::HostSidecar>()
                    .endpoint
                    .lock()
                {
                    *guard = Some(ep);
                }
            }
            let ep_js = endpoint
                .as_ref()
                .map(serde_json::Value::to_string)
                .unwrap_or_else(|| "null".to_string());

            // 4) 主窗：无边框自绘（Z-03/Z-04）+ 初始化脚本注入端点（先于页面脚本执行）
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("pi-agent")
                .inner_size(1280.0, 800.0)
                .min_inner_size(940.0, 600.0)
                .decorations(false)
                .resizable(true)
                .initialization_script(&format!(
                    "window.__PI_AGENT_HOST_OVERRIDE__ = {ep_js};"
                ))
                .build()?;

            // 5) 托盘（Z-06/U-07）
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 关窗到托盘：CloseRequested 只隐藏，托盘「退出」才真退（Z-06）
            WindowEvent::CloseRequested { api, .. } => {
                let exiting = *window
                    .app_handle()
                    .state::<Exiting>()
                    .0
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if !exiting {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // A-09：通知点击 → Windows 激活窗口 → Focused(true) → 取走深链推给前端
            WindowEvent::Focused(true) => {
                let app = window.app_handle();
                if let Some(sid) = notify::take_deeplink(app) {
                    let _ = app.emit("approval:deeplink", sid);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            window::window_minimize,
            window::window_toggle_maximize,
            window::window_is_maximized,
            window::window_close_to_tray,
            window::window_set_title,
            window::open_external,
            window::open_logs_dir,
            window::open_data_dir,
            notify::notify,
            keychain::secret_get,
            keychain::secret_set,
            keychain::secret_delete,
            sidecar::host_endpoint
        ])
        .build(tauri::generate_context!())
        .expect("pi-agent 桌面壳构建失败")
        .run(|app, event| {
            // 退出清理：标记退出 + 回收 sidecar 子进程
            if let tauri::RunEvent::Exit = event {
                *app.state::<Exiting>().0.lock().unwrap_or_else(|e| e.into_inner()) = true;
                sidecar::kill_child(app);
            }
        });
}
