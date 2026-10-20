// GUI 内托管的 MCP HTTP 服务（桌面与 Android 共用）。
//
// ── 为什么是进程级单例，而不是 AppState 上的一个字段 ──
//
// HTTP 服务独占一个端口，「同进程内跑两个」没有语义。状态只有「在跑（哪个端口 /
// 令牌）」和「没跑」两种，一个进程级槽位就够，不必扩 AppState。
//
// Android 注意：服务只在进程存活期间有效，重启 App 后是「没跑」。进程被系统回收的
// 风险由前端在服务开着时持有前台保活服务来压低（`mobileBridge.holdForeground`），
// 这里不感知平台。

use std::sync::OnceLock;

use parking_lot::Mutex;

use super::http_transport::{HttpConfig, HttpRuntimeInfo, HttpServerHandle};
use super::McpServer;
use crate::error::AppError;

static RUNTIME: OnceLock<Mutex<Option<HttpServerHandle>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<HttpServerHandle>> {
    RUNTIME.get_or_init(|| Mutex::new(None))
}

/// 当前状态：在跑则给出绑定地址 / 端口 / 令牌 / URL，没跑则 `None`。
pub fn status() -> Option<HttpRuntimeInfo> {
    slot().lock().as_ref().map(HttpServerHandle::info)
}

/// 启动服务。
///
/// 已经在跑时先停掉旧的：能走到「再启一次」说明用户在改配置（换端口/换绑定），
/// 语义上就是重启。不先停会撞端口占用，而且旧句柄一旦被丢弃就再也停不掉了。
pub async fn start(server: &McpServer, cfg: HttpConfig) -> Result<HttpRuntimeInfo, AppError> {
    // 先把旧的取出来，**不能持锁跨 await**（parking_lot 的锁跨 await 会死锁）
    let previous = slot().lock().take();
    if let Some(prev) = previous {
        prev.stop().await;
    }

    let handle = super::http_transport::start_http_server(server, cfg).await?;
    let info = handle.info();
    *slot().lock() = Some(handle);
    Ok(info)
}

/// 停止服务。返回「之前是否在跑」。
///
/// 幂等：本来就没跑时不报错、只返回 `false`——用户连点两次停止按钮不该看到
/// 一个红色错误。UI 靠返回值决定要不要刷状态，而不是靠错误分支。
pub async fn stop() -> bool {
    let previous = slot().lock().take();
    match previous {
        Some(handle) => {
            handle.stop().await;
            true
        }
        None => false,
    }
}
