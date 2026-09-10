//! CLI 入口骨架（E-06）：桌面壳对外的命令行参数解析。
//! 本轮仅骨架：--version / --help 即时退出；`--deep-link pi-agent://session/<id>`
//! 预留为深链入口（单实例聚合与完整 CLI 子命令在后续批次评估，Z-08 骨架同批）。

pub fn handle_early_args() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("pi-agent-desktop {}", env!("CARGO_PKG_VERSION"));
        return true;
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("pi-agent 桌面壳");
        println!("  --version    打印版本");
        println!("  --help       打印帮助");
        println!("  （CLI 子命令为骨架占位，E-06 完整实现留后续批次）");
        return true;
    }
    false
}
