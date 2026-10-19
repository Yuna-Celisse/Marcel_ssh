//! 远端「复制 / 剪切 + 粘贴」：文件管理器内同一台服务器上的条目搬运。
//!
//! - 复制走远端 `cp -a`（数据不经本机，属性/符号链接原样保留）；
//! - 剪切优先用 SFTP `rename`（同分区原子、瞬时），跨分区失败再退到 `mv`；
//! - 目标目录已有同名条目时**绝不覆盖**，自动改名为「name (1)」「name (2)」…，
//!   并把最终名字回传给前端做提示。

use std::collections::HashSet;
use std::time::Duration;

use tauri::AppHandle;

use crate::command_exec::CommandSource;
use crate::error::AppError;
use crate::util::{shell_escape, validate_sftp_remote_path};
use crate::AppState;

/// 与压缩 / 解压共用的远端长任务上限（复制大目录可能远超默认 120s）。
const PASTE_TIMEOUT: Duration = Duration::from_secs(1800);

fn split_name(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path)
}

/// 在 `existing` 之外挑一个不冲突的名字：`a.txt` → `a (1).txt`，`dir` → `dir (1)`。
/// 点开头的隐藏文件（`.env`）整段当主名，不把 `.env` 拆成空主名 + 扩展名。
pub(crate) fn unique_name(existing: &HashSet<String>, name: &str) -> String {
    if !existing.contains(name) {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1u32..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|cand| !existing.contains(cand))
        .expect("u32 序号不会耗尽")
}

/// `dest` 是否就是 `src` 本身或位于其内部（把目录粘贴进自己会无限递归）。
pub(crate) fn is_self_or_inside(src: &str, dest: &str) -> bool {
    let src = src.trim_end_matches('/');
    let dest = dest.trim_end_matches('/');
    dest == src || dest.starts_with(&format!("{src}/"))
}

fn parent_of(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/",
        Some(i) => &trimmed[..i],
    }
}

fn join(dir: &str, name: &str) -> String {
    format!("{}/{}", dir.trim_end_matches('/'), name)
}

pub(crate) fn build_copy_cmd(src: &str, dst: &str) -> String {
    format!(
        "cp -a -- {} {} && echo OK",
        shell_escape(src),
        shell_escape(dst)
    )
}

pub(crate) fn build_move_cmd(src: &str, dst: &str) -> String {
    format!(
        "mv -- {} {} && echo OK",
        shell_escape(src),
        shell_escape(dst)
    )
}

/// 粘贴一个条目，返回它在目标目录里的最终名字。
pub(crate) async fn paste_entry(
    app: &AppHandle,
    state: &AppState,
    session_id: &str,
    src_path: &str,
    dest_dir: &str,
    cut: bool,
) -> Result<String, AppError> {
    let src = validate_sftp_remote_path(src_path)?;
    let dest_dir = validate_sftp_remote_path(dest_dir)?;
    let name = split_name(&src).to_string();
    if name.is_empty() {
        return Err(AppError::Ssh("无法粘贴根目录".into()));
    }
    if is_self_or_inside(&src, &dest_dir) {
        return Err(AppError::Ssh(format!(
            "不能把「{name}」粘贴到它自己或它的子目录里"
        )));
    }
    // 剪切后原地粘贴：什么都不用做。
    let dest_norm = match dest_dir.trim_end_matches('/') {
        "" => "/",
        d => d,
    };
    if cut && parent_of(&src) == dest_norm {
        return Ok(name);
    }

    let existing: HashSet<String> = state
        .ssh_manager
        .with_shared_sftp(session_id, |sftp| {
            let dir = dest_dir.clone();
            async move {
                let mut rd = sftp.read_dir(&dir).await?;
                let mut names = HashSet::new();
                while let Some(entry) = rd.next() {
                    names.insert(entry.file_name());
                }
                Ok(names)
            }
        })
        .await?
        .map_err(|e| AppError::Ssh(format!("读取目标目录失败: {e}")))?;
    let final_name = unique_name(&existing, &name);
    let dst = join(&dest_dir, &final_name);

    if cut {
        let renamed = state
            .ssh_manager
            .with_shared_sftp(session_id, |sftp| {
                let (a, b) = (src.clone(), dst.clone());
                async move { sftp.rename(a, b).await }
            })
            .await?;
        if renamed.is_ok() {
            return Ok(final_name);
        }
        // 跨分区等 rename 做不到的场景，退到远端 mv。
    }

    let cmd = if cut {
        build_move_cmd(&src, &dst)
    } else {
        build_copy_cmd(&src, &dst)
    };
    let output = state
        .command_exec
        .exec_simple_with_timeout(app, session_id, &cmd, CommandSource::SystemTask, PASTE_TIMEOUT)
        .await?;
    if output.lines().any(|l| l.trim() == "OK") {
        Ok(final_name)
    } else {
        let msg = output.trim();
        Err(AppError::Ssh(if msg.is_empty() {
            format!("{}失败", if cut { "移动" } else { "复制" })
        } else {
            msg.to_string()
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn unique_name_keeps_free_name() {
        assert_eq!(unique_name(&set(&["a"]), "b.txt"), "b.txt");
    }

    #[test]
    fn unique_name_inserts_counter_before_extension() {
        assert_eq!(unique_name(&set(&["a.txt"]), "a.txt"), "a (1).txt");
        assert_eq!(
            unique_name(&set(&["a.txt", "a (1).txt"]), "a.txt"),
            "a (2).txt"
        );
    }

    #[test]
    fn unique_name_handles_dirs_and_dotfiles() {
        assert_eq!(unique_name(&set(&["dir"]), "dir"), "dir (1)");
        assert_eq!(unique_name(&set(&[".env"]), ".env"), ".env (1)");
        assert_eq!(unique_name(&set(&["a.tar.gz"]), "a.tar.gz"), "a.tar (1).gz");
    }

    #[test]
    fn self_or_inside_detection() {
        assert!(is_self_or_inside("/home/a", "/home/a"));
        assert!(is_self_or_inside("/home/a", "/home/a/b"));
        assert!(is_self_or_inside("/home/a/", "/home/a/b/"));
        assert!(!is_self_or_inside("/home/a", "/home/ab"));
        assert!(!is_self_or_inside("/home/a", "/home"));
    }

    #[test]
    fn commands_are_quoted_and_end_with_ok_marker() {
        let c = build_copy_cmd("/a b/it's", "/x/y");
        assert!(c.starts_with("cp -a -- "));
        assert!(c.ends_with("&& echo OK"));
        assert!(!c.contains("/a b/it's"));
        assert!(build_move_cmd("/a", "/b").starts_with("mv -- "));
    }

    #[test]
    fn parent_of_paths() {
        assert_eq!(parent_of("/a/b"), "/a");
        assert_eq!(parent_of("/a"), "/");
        assert_eq!(split_name("/a/b/"), "b");
    }
}
