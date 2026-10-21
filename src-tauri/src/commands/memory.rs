//! 长期记忆的前端命令：记忆管理页（列表、增删改、置顶、撤销、整理助手）、对话里的
//! 记忆卡片与复盘提示行（撤销）、Agent 面板「本会话带了哪些记忆」、删连接确认框。
//!
//! 这里的写入一律是**用户发起**的（`Source::User`，整理助手是 `Source::Assistant`）：
//! 进行中对话的注入快照会在下一轮刷新，删掉的东西立刻不再被模型看到。

use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use crate::error::AppError;
use crate::memory::assistant::{AssistantReply, AssistantTurn};
use crate::memory::inject::{carried_tiers, Carried};
use crate::memory::model::{BatchContext, MemoryOpRecord, ReflectionNote, WriteOp};
use crate::memory::reflect::emit_changed;
use crate::memory::store::{ScopeSummary, StoreError};
use crate::memory::{MemoryItem, ScopeRef, Source};
use crate::AppState;

fn store_err(e: StoreError) -> AppError {
    AppError::Other(e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryOverview {
    pub items: Vec<MemoryItem>,
    pub summaries: Vec<ScopeSummary>,
}

/// 管理页：全部记忆 + 各作用域计数（几百条的量级，前端自己筛）。
#[tauri::command]
pub async fn memory_overview(state: State<'_, AppState>) -> Result<MemoryOverview, AppError> {
    let store = &state.memory.store;
    Ok(MemoryOverview {
        items: store.list_all().map_err(store_err)?,
        summaries: store.scope_summaries().map_err(store_err)?,
    })
}

/// 管理页的增删改 / 置顶（一批，全有或全无）。
#[tauri::command]
pub async fn memory_apply(
    state: State<'_, AppState>,
    ops: Vec<WriteOp>,
) -> Result<Vec<MemoryOpRecord>, AppError> {
    let ctx = BatchContext::new(Source::User, None);
    let records = state.memory.store.apply(&ctx, &ops).map_err(store_err)?;
    emit_changed(state.inner(), Source::User, None);
    Ok(records)
}

/// 撤销一步（对话里的记忆卡片、复盘提示行里的单条）。
#[tauri::command]
pub async fn memory_revert_op(
    state: State<'_, AppState>,
    op_id: i64,
) -> Result<MemoryOpRecord, AppError> {
    let rec = state.memory.store.revert_op(op_id).map_err(store_err)?;
    emit_changed(state.inner(), Source::User, rec.conversation_id.as_deref());
    Ok(rec)
}

/// 整批撤销（整理助手的「撤销这次」、复盘提示行的「全部撤销」、删连接后的反悔）。
#[tauri::command]
pub async fn memory_revert_batch(
    state: State<'_, AppState>,
    batch_id: String,
) -> Result<Vec<MemoryOpRecord>, AppError> {
    let recs = state
        .memory
        .store
        .revert_batch(&batch_id)
        .map_err(store_err)?;
    emit_changed(state.inner(), Source::User, None);
    Ok(recs)
}

/// 查一批的当前状态（前端卡片据此显示「已撤销」）。
#[tauri::command]
pub async fn memory_batch_ops(
    state: State<'_, AppState>,
    batch_id: String,
) -> Result<Vec<MemoryOpRecord>, AppError> {
    state
        .memory
        .store
        .ops_for_batch(&batch_id)
        .map_err(store_err)
}

/// 用户看过了：清掉「新」标记。
#[tauri::command]
pub async fn memory_mark_seen(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    state.memory.store.mark_seen(&ids).map_err(store_err)
}

/// 对话里的复盘提示行（加载会话时取）。
#[tauri::command]
pub async fn memory_reflection_notes(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Vec<ReflectionNote>, AppError> {
    state
        .memory
        .store
        .notes_for_conversation(&conversation_id)
        .map_err(store_err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InjectedMemories {
    /// 这段对话带着的记忆（仍存在的那些）。
    pub items: Vec<MemoryItem>,
    /// 已冻结（对话开始过）。`false` = 还没开始，列出的是「开始时会带上的」。
    pub frozen: bool,
    /// 冻结之后被删掉的条数（快照里还有，但库里已经没了——下一轮就不再带）。
    pub removed_since: usize,
    /// 这台机器（含分组、全局）现在有、但这段对话没带上的条数：冻结之后才记下的。
    /// 下一段对话（或压缩上下文）起才会带上。未冻结时恒为 0。
    pub pending: usize,
    /// 管理页里有、但属于别的机器 / 分组，不会带进这段对话的条数。
    pub elsewhere: usize,
    /// 每条实际让模型看到多少（完整 / 只有标题）。不在表里的 = 预算放不下、没带。
    pub carried: HashMap<String, Carried>,
    /// 属于这台机器、却因为提示词放不下（连标题行都超过上限）没带的老条目数。
    /// 模型仍能用 `memory_recall` 搜到它们。
    pub left_out: usize,
    pub enabled: bool,
}

/// Agent 面板「本会话带了 N 条记忆」：告诉用户这次到底让模型看到了什么。
#[tauri::command]
pub async fn memory_conversation_injected(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
    session_id: Option<String>,
) -> Result<InjectedMemories, AppError> {
    let enabled = state.settings.read().await.memory_settings.enabled;
    let store = &state.memory.store;
    let ctx = match session_id.as_deref() {
        Some(sid) => crate::memory::scope::for_session(state.inner(), sid).await,
        None => crate::memory::scope::ScopeContext::global_only(),
    };
    let visible = store.list_scopes(&ctx.scopes()).map_err(store_err)?;
    let total = store.list_all().map_err(store_err)?.len();
    let elsewhere = total.saturating_sub(visible.len());
    if let Some(cid) = conversation_id.as_deref() {
        let snap = store.snapshot(cid).map_err(store_err)?;
        // 快照已经不能原样用了（手动改过记忆 / 换了分组 / 缓存早就冷了）：下一轮会重渲染，
        // 所以这里列的是「下一轮会带上的」，不是那份旧快照——否则管理页里明明有，这里还写「没有」。
        let current_fp =
            crate::memory::inject::current_fingerprint(store, &ctx).map_err(store_err)?;
        if let Some(snap) = snap
            .filter(|s| crate::memory::inject::snapshot_usable(s, &current_fp, chrono::Utc::now()))
        {
            let mut items = Vec::new();
            for id in &snap.item_ids {
                if let Some(m) = store.get(id).map_err(store_err)? {
                    items.push(m);
                }
            }
            let removed_since = snap.item_ids.len() - items.len();
            let carried = carried_tiers(&snap.content, &snap.item_ids);
            // 只数冻结之后才记下的：预算放不下、没进快照的老条目不算「新记的」。
            let pending = visible
                .iter()
                .filter(|m| !snap.item_ids.contains(&m.id) && m.created_at > snap.created_at)
                .count();
            let left_out = visible
                .iter()
                .filter(|m| !snap.item_ids.contains(&m.id) && m.created_at <= snap.created_at)
                .count();
            return Ok(InjectedMemories {
                items,
                frozen: true,
                removed_since,
                pending,
                elsewhere,
                carried,
                left_out,
                enabled,
            });
        }
    }
    // 还没开始（或快照作废）：用和注入同一个渲染函数预演一遍，弹层说的就是模型下一轮会收到的。
    let (block, ids) = crate::memory::inject::render_block(&ctx, &visible, chrono::Utc::now());
    let carried = carried_tiers(&block, &ids);
    let left_out = visible.len() - carried.len().min(visible.len());
    let items = visible
        .into_iter()
        .filter(|m| carried.contains_key(&m.id))
        .collect();
    Ok(InjectedMemories {
        items,
        frozen: false,
        removed_since: 0,
        pending: 0,
        elsewhere,
        carried,
        left_out,
        enabled,
    })
}

/// 删连接确认框：这台机器有几条记忆（0 条时不显示那个复选框）。
#[tauri::command]
pub async fn memory_count_for_connection(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<usize, AppError> {
    state
        .memory
        .store
        .count_scope(&ScopeRef::host(connection_id))
        .map_err(store_err)
}

/// 删除一整个作用域（管理页「清空这台机器 / 这个已删除连接的记忆」）。返回 batch id 供撤销。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteScopeResult {
    pub batch_id: String,
    pub count: usize,
}

#[tauri::command]
pub async fn memory_delete_scope(
    state: State<'_, AppState>,
    scope: ScopeRef,
) -> Result<DeleteScopeResult, AppError> {
    let (batch_id, count) = state.memory.store.delete_scope(&scope).map_err(store_err)?;
    if count > 0 {
        emit_changed(state.inner(), Source::User, None);
    }
    Ok(DeleteScopeResult { batch_id, count })
}

/// 整理助手：跑一次请求（进度经 `memory-assistant-progress` 事件推送）。
#[tauri::command]
pub async fn memory_assistant_run(
    state: State<'_, AppState>,
    run_id: String,
    history: Vec<AssistantTurn>,
    prompt: String,
    focus: Option<ScopeRef>,
    model_id: Option<String>,
) -> Result<AssistantReply, AppError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(AppError::Other("请先说说要怎么整理".into()));
    }
    crate::memory::assistant::run(
        state.inner(),
        &run_id,
        history,
        prompt,
        focus,
        model_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn memory_assistant_cancel(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<bool, AppError> {
    Ok(state.memory.assistant.cancel(&run_id))
}
