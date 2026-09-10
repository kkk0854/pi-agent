//! 桌面通知（U-07/A-09）：审批挂起时通知，点击（窗口聚焦）后深链直达对应会话。
//! Windows toast 点击默认会激活应用窗口 → 走 Focused(true) 事件取走深链。

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

/// 全局状态：待消费的深链（sessionId）
pub struct DeepLink(pub Mutex<Option<String>>);

/// 取走深链（消费即清空，A-09）
pub fn take_deeplink(app: &tauri::AppHandle) -> Option<String> {
    app.state::<DeepLink>().0.lock().ok()?.take()
}

#[tauri::command]
pub fn notify(
    app: tauri::AppHandle,
    title: String,
    body: String,
    session_id: Option<String>,
) -> Result<(), String> {
    if let Some(sid) = session_id {
        if let Ok(mut guard) = app.state::<DeepLink>().0.lock() {
            *guard = Some(sid);
        }
    }
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}
