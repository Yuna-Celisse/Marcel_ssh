//! 诊断日志落盘：让「闪退之后到底发生了什么」有处可查。
//!
//! 此前日志只写 stderr —— Windows 发布版是 GUI 子系统、根本没有控制台，崩溃后
//! 什么都留不下。这里把同一份日志**同时**写进配置目录下的 `logs/marcel.log`，并补
//! 两样崩溃现场最需要的东西：
//! - panic 钩子：panic 的线程、位置、完整回溯进日志（Rust 侧 panic 不再无声消失）；
//! - 「运行中」标记（仅桌面）：启动写、正常退出删；下次启动发现它还在，就说明上次
//!   不是正常退出（崩溃 / 被强杀 / WebView 崩溃带走进程），日志里留一条醒目的警告。
//!
//! 时序：`init` 在 `run()` 最开头（此时配置目录还不知道，只有 stderr），文件在
//! `.setup` 里拿到配置目录后经 `attach_file` 接上。接上之前的几条日志不进文件，
//! 它们只是启动前的零星输出，值得换来不去自己猜配置目录。
//!
//! 写文件**不缓冲**（`File` 直写，每条日志一次 `write_all`）：崩溃前最后几条恰恰
//! 是最有用的，缓冲区里的那几条会跟着进程一起丢。日志不得含密码 / 私钥 / API Key，
//! 这条约束与 stderr 时代一致，由调用点负责。

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

const LOG_DIR: &str = "logs";
const LOG_FILE: &str = "marcel.log";
const LOG_FILE_OLD: &str = "marcel.log.old";
/// 单个日志文件上限：超过就在**下次启动**时轮转成 `.old`（只留一代），
/// 总占用上限约 2 × 此值。不在运行中轮转：避免热路径上带锁改名。
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
#[cfg(desktop)]
const RUNNING_MARKER: &str = "running.marker";

fn sink() -> &'static Mutex<Option<File>> {
    static SINK: OnceLock<Mutex<Option<File>>> = OnceLock::new();
    SINK.get_or_init(|| Mutex::new(None))
}

/// 同时写 stderr 与日志文件的 `Write`。任何一路失败都吞掉：日志不能反过来把程序
/// 搞崩（Windows GUI 子系统下 stderr 本来就写不进去）。
struct TeeWriter;

impl Write for TeeWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let _ = io::stderr().write_all(buf);
        if let Ok(mut guard) = sink().lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.write_all(buf);
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = io::stderr().flush();
        if let Ok(mut guard) = sink().lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.flush();
            }
        }
        Ok(())
    }
}

/// 初始化日志（`run()` 最开头调用一次）并装上 panic 钩子。
pub fn init() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .target(env_logger::Target::Pipe(Box::new(TeeWriter)))
        .init();
    install_panic_hook();
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let backtrace = std::backtrace::Backtrace::force_capture();
        log::error!(
            "PANIC（线程 {}）：{info}\n{backtrace}",
            thread.name().unwrap_or("<unnamed>")
        );
        previous(info);
    }));
}

/// 拿到配置目录后把日志接到文件，并检查上次是否正常退出。
///
/// 失败只降级为「没有文件日志」，不影响启动。
pub fn attach_file(config_dir: &Path) {
    let dir = config_dir.join(LOG_DIR);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("诊断日志目录创建失败（{}）：{e}", dir.display());
        return;
    }
    let path = dir.join(LOG_FILE);
    rotate_if_large(&dir, MAX_LOG_BYTES);
    let file = match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => f,
        Err(e) => {
            log::warn!("诊断日志文件打开失败（{}）：{e}", path.display());
            return;
        }
    };
    if let Ok(mut guard) = sink().lock() {
        *guard = Some(file);
    }
    log::info!(
        "—— 启动 Marcel SSH v{}（pid {}），诊断日志：{}",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        path.display()
    );

    #[cfg(desktop)]
    {
        if let Some(prev) = take_previous_marker(&dir) {
            log::warn!(
                "上次运行没有正常退出（崩溃、被强制结束或 WebView 崩溃带走了进程）；上次启动信息：{prev}。\
                 崩溃前的日志在 {} 与 {} 里，注意看最后几条",
                LOG_FILE,
                LOG_FILE_OLD
            );
        }
        write_marker(&dir);
    }
}

/// 正常退出时调用（`RunEvent::Exit`）：删掉「运行中」标记。
pub fn mark_clean_exit(config_dir: &Path) {
    #[cfg(desktop)]
    {
        let _ = std::fs::remove_file(config_dir.join(LOG_DIR).join(RUNNING_MARKER));
        log::info!("—— 正常退出");
    }
    #[cfg(not(desktop))]
    let _ = config_dir;
}

/// 日志文件超过上限就轮转：`marcel.log` → `marcel.log.old`（覆盖旧的一代）。
fn rotate_if_large(dir: &Path, max_bytes: u64) {
    let path = dir.join(LOG_FILE);
    let Ok(meta) = std::fs::metadata(&path) else {
        return;
    };
    if meta.len() <= max_bytes {
        return;
    }
    let old = dir.join(LOG_FILE_OLD);
    let _ = std::fs::remove_file(&old);
    let _ = std::fs::rename(&path, &old);
}

/// 读走上次遗留的「运行中」标记内容（存在 = 上次没正常退出）。
#[cfg(desktop)]
fn take_previous_marker(dir: &Path) -> Option<String> {
    let path = dir.join(RUNNING_MARKER);
    let content = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    Some(content.trim().to_string())
}

#[cfg(desktop)]
fn write_marker(dir: &Path) {
    let content = format!(
        "v{} pid {} 启动于 {}",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    );
    let _ = std::fs::write(dir.join(RUNNING_MARKER), content);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotate_moves_an_oversized_log_to_old_and_replaces_the_previous_generation() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join(LOG_FILE), vec![b'x'; 100]).unwrap();
        std::fs::write(tmp.path().join(LOG_FILE_OLD), b"older").unwrap();

        rotate_if_large(tmp.path(), 50);

        assert!(!tmp.path().join(LOG_FILE).exists());
        assert_eq!(
            std::fs::read(tmp.path().join(LOG_FILE_OLD)).unwrap().len(),
            100
        );
    }

    #[test]
    fn rotate_leaves_a_small_or_missing_log_alone() {
        let tmp = tempfile::tempdir().unwrap();
        rotate_if_large(tmp.path(), 50); // 不存在：不 panic、不建文件
        assert!(!tmp.path().join(LOG_FILE).exists());

        std::fs::write(tmp.path().join(LOG_FILE), b"tiny").unwrap();
        rotate_if_large(tmp.path(), 50);
        assert!(tmp.path().join(LOG_FILE).exists());
        assert!(!tmp.path().join(LOG_FILE_OLD).exists());
    }

    #[cfg(desktop)]
    #[test]
    fn marker_left_behind_is_reported_once_then_cleared() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(take_previous_marker(tmp.path()), None, "干净退出后没有标记");

        write_marker(tmp.path());
        let prev = take_previous_marker(tmp.path()).expect("上次遗留的标记");
        assert!(prev.contains("pid"), "标记里应带启动信息：{prev}");
        assert_eq!(
            take_previous_marker(tmp.path()),
            None,
            "读走即清，只报告一次"
        );
    }
}
