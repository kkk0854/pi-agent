//! 系统钥匙串（Z-10 · Q-03）：Windows Credential Manager（keyring crate）。
//! 提供 get/set/delete 三个 Tauri 命令；服务名固定 "pi-agent"，key 即账户名。
//! host 侧经 keybridge（本地 HTTP）优先调这里，失败回退加密文件。

use keyring::Entry;

const SERVICE: &str = "pi-agent";

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(key: String, value: String) -> Result<(), String> {
    let e = entry(&key)?;
    // 已存在则覆盖（set 对已有条目同样生效，这里统一走 set_password）
    e.set_password(&value).map_err(|er| er.to_string())
}

#[tauri::command]
pub fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
