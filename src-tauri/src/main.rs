//! pi-agent 桌面壳入口（Windows GUI 子系统：release 不弹控制台）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pi_agent_desktop_lib::run()
}
