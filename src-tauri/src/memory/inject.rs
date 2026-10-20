//! 把记忆渲染成系统提示词里的「长期记忆」段，并为每个会话**冻结**一份。
//!
//! # 为什么要冻结
//!
//! 系统提示词每个回合都会重新拼一遍（每条消息都是一次新的任务）。若注入的是
//! 「此刻最新的记忆」，agent 这一轮刚记下一条，下一轮系统提示词就变了，整段会话的
//! 前缀缓存从头失效。所以每个会话第一次用到时渲染一份存进 `memory_snapshots`，
//! 之后原样复用。只有两种情况重渲染：
//!
//! 1. **用户亲手改了**这个会话能看到的某个作用域（指纹里的作用域序号变了）——删掉
//!    的东西必须马上不再被模型看到，正确性优先；
//! 2. **压缩之后**（`drop_snapshot`）——压缩本身已经打断了缓存，顺手刷新。
//!
//! agent 自己写的、后台复盘写的都不触发重渲染：前者本来就在它的上下文里，后者
//! 留给下一段对话。

use chrono::{DateTime, Utc};
use serde_json::json;

use crate::agent::templates::TemplateManager;
use crate::AppState;

use super::model::{Kind, MemoryItem, Scope};
use super::scope::ScopeContext;
use super::store::{now_rfc3339, Snapshot};

/// 完整展示的条目总字数预算。超出的只列标题 + id，细节让模型用 `memory_recall` 查。
pub const FULL_ENTRY_BUDGET_CHARS: usize = 3000;
/// 只列标题的条目上限；再多的只报个数。
const INDEX_LINES_MAX: usize = 40;
/// 排版或模板变了就改这里：旧快照的指纹随之失效、自动重渲染。
const FORMAT_VERSION: &str = "mem-v1";

/// 渲染结果：整段文本 + 这段里出现过的条目 id（Agent 面板「本会话带了哪些记忆」用）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    pub section: String,
    pub item_ids: Vec<String>,
}

fn kind_rank(kind: Kind) -> u8 {
    match kind {
        Kind::Preference => 0,
        Kind::Lesson => 1,
        Kind::Fact => 2,
        Kind::Change => 3,
    }
}

fn scope_rank(scope: Scope) -> u8 {
    match scope {
        Scope::User => 0,
        Scope::Group => 1,
        Scope::Host => 2,
    }
}

/// 「今天 / 3 天前 / 约 2 周前 / 约 3 个月前 / 约 1 年前」。解析不了的时间给空串。
pub fn relative_time(ts: &str, now: DateTime<Utc>) -> String {
    let Ok(t) = DateTime::parse_from_rfc3339(ts) else {
        return String::new();
    };
    let days = (now - t.with_timezone(&Utc)).num_days();
    match days {
        d if d <= 0 => "今天".into(),
        1 => "昨天".into(),
        d if d < 14 => format!("{d} 天前"),
        d if d < 60 => format!("约 {} 周前", d / 7),
        d if d < 365 => format!("约 {} 个月前", d / 30),
        d => format!("约 {} 年前", d / 365),
    }
}

fn full_line(m: &MemoryItem, now: DateTime<Utc>) -> String {
    let mut tags = Vec::new();
    if m.pinned {
        tags.push("置顶".to_string());
    }
    tags.push(m.kind.label().to_string());
    let when = relative_time(&m.updated_at, now);
    if !when.is_empty() {
        tags.push(when);
    }
    // 多行内容缩进续行，保持在同一个列表项里。
    let content = m.content.replace('\n', "\n  ");
    format!(
        "- [{}] {}：{}（{}）",
        m.id,
        m.title,
        content,
        tags.join(" · ")
    )
}

fn scope_header(scope: Scope, ctx: &ScopeContext) -> String {
    match scope {
        Scope::User => "### 全局（关于用户本人，每台机器都适用）".to_string(),
        Scope::Group => format!(
            "### 分组「{}」（这一组机器共有）",
            ctx.group.as_deref().unwrap_or("")
        ),
        Scope::Host => format!("### 这台机器「{}」", ctx.host_label().unwrap_or_default()),
    }
}

/// 只渲染条目区块（纯函数，可单测）。返回区块文本与出现过的 id。
pub fn render_block(
    ctx: &ScopeContext,
    items: &[MemoryItem],
    now: DateTime<Utc>,
) -> (String, Vec<String>) {
    if items.is_empty() {
        return (String::new(), Vec::new());
    }
    // 全局优先级：置顶 → 作用域（全局 → 分组 → 机器）→ 种类 → 新→旧。
    let mut ordered: Vec<&MemoryItem> = items.iter().collect();
    ordered.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| scope_rank(a.scope).cmp(&scope_rank(b.scope)))
            .then_with(|| kind_rank(a.kind).cmp(&kind_rank(b.kind)))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    let mut budget = FULL_ENTRY_BUDGET_CHARS;
    let mut full: Vec<(&MemoryItem, String)> = Vec::new();
    let mut index: Vec<&MemoryItem> = Vec::new();
    for m in ordered {
        let line = full_line(m, now);
        let n = line.chars().count();
        if n <= budget {
            budget -= n;
            full.push((m, line));
        } else {
            // 一旦有条目放不下，后面的一律只列标题：免得预算被几条短的「插空」
            // 吃掉，排序靠前的反而只剩标题。
            budget = 0;
            index.push(m);
        }
    }

    let mut ids = Vec::new();
    let mut out: Vec<String> = Vec::new();
    for scope in [Scope::User, Scope::Group, Scope::Host] {
        let lines: Vec<&String> = full
            .iter()
            .filter(|(m, _)| m.scope == scope)
            .map(|(m, line)| {
                ids.push(m.id.clone());
                line
            })
            .collect();
        if lines.is_empty() {
            continue;
        }
        out.push(scope_header(scope, ctx));
        out.extend(lines.into_iter().cloned());
        out.push(String::new());
    }
    if !index.is_empty() {
        out.push("### 其余记忆（只列标题，细节用 memory_recall 搜）".into());
        for m in index.iter().take(INDEX_LINES_MAX) {
            ids.push(m.id.clone());
            out.push(format!(
                "- [{}] {}（{}）",
                m.id,
                m.title,
                scope_short(m.scope)
            ));
        }
        if index.len() > INDEX_LINES_MAX {
            out.push(format!("……另有 {} 条", index.len() - INDEX_LINES_MAX));
        }
    }
    (out.join("\n").trim_end().to_string(), ids)
}

fn scope_short(scope: Scope) -> &'static str {
    match scope {
        Scope::User => "全局",
        Scope::Group => "分组",
        Scope::Host => "这台机器",
    }
}

/// 渲染整段（模板 + 条目区块）。`readonly` = 子 agent 版本（不教它怎么写）。
pub fn render_section(
    ctx: &ScopeContext,
    items: &[MemoryItem],
    readonly: bool,
    now: DateTime<Utc>,
) -> Rendered {
    let (block, item_ids) = render_block(ctx, items, now);
    let section = TemplateManager.render_fragment(
        "记忆",
        &json!({
            "memory_block": block,
            "readonly": readonly,
            "has_history_tool": true,
        }),
    );
    Rendered {
        section: section.trim().to_string(),
        item_ids,
    }
}

fn fingerprint(ctx: &ScopeContext, scope_fp: &str) -> String {
    format!(
        "{FORMAT_VERSION}|{scope_fp}|{}|{}",
        ctx.host_label().unwrap_or_default(),
        ctx.group.clone().unwrap_or_default()
    )
}

/// 主任务：取会话的冻结快照（必要时重渲染）。记忆关闭 → 空串。
///
/// 任何失败都只记日志、返回空串：记忆是增强，坏了不该让任务起不来。
pub async fn section_for_main(
    state: &AppState,
    conversation_id: &str,
    ctx: &ScopeContext,
) -> String {
    if !state.settings.read().await.memory_settings.enabled {
        return String::new();
    }
    let store = &state.memory.store;
    let scopes = ctx.scopes();
    let fp = match store.fingerprint(&scopes) {
        Ok(f) => fingerprint(ctx, &f),
        Err(e) => {
            log::warn!("记忆指纹计算失败，本轮不注入记忆: {e}");
            return String::new();
        }
    };
    match store.snapshot(conversation_id) {
        Ok(Some(snap)) if snap.fingerprint == fp => return snap.content,
        Ok(_) => {}
        Err(e) => log::warn!("读取记忆快照失败，重新渲染: {e}"),
    }
    let items = match store.list_scopes(&scopes) {
        Ok(items) => items,
        Err(e) => {
            log::warn!("读取记忆失败，本轮不注入记忆: {e}");
            return String::new();
        }
    };
    let rendered = render_section(ctx, &items, false, Utc::now());
    let snap = Snapshot {
        fingerprint: fp,
        content: rendered.section.clone(),
        item_ids: rendered.item_ids,
        created_at: now_rfc3339(),
    };
    if let Err(e) = store.put_snapshot(conversation_id, &snap) {
        log::warn!("保存记忆快照失败（下一轮会重新渲染）: {e}");
    }
    rendered.section
}

/// 子 agent：只读版，不冻结（子任务是一次性的）；没有任何条目时不注入。
pub async fn section_for_sub(state: &AppState, ctx: &ScopeContext) -> String {
    if !state.settings.read().await.memory_settings.enabled {
        return String::new();
    }
    match state.memory.store.list_scopes(&ctx.scopes()) {
        Ok(items) if !items.is_empty() => render_section(ctx, &items, true, Utc::now()).section,
        Ok(_) => String::new(),
        Err(e) => {
            log::warn!("读取记忆失败，子 agent 不注入记忆: {e}");
            String::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(
        id: &str,
        scope: Scope,
        kind: Kind,
        title: &str,
        content: &str,
        updated: &str,
    ) -> MemoryItem {
        MemoryItem {
            id: id.into(),
            scope,
            scope_key: match scope {
                Scope::User => String::new(),
                Scope::Group => "prod".into(),
                Scope::Host => "c1".into(),
            },
            kind,
            title: title.into(),
            content: content.into(),
            pinned: false,
            source: super::super::model::Source::Agent,
            source_conversation_id: None,
            source_message_id: None,
            created_at: updated.into(),
            updated_at: updated.into(),
            version: 1,
            is_new: false,
        }
    }

    fn ctx() -> ScopeContext {
        ScopeContext {
            connection_id: Some("c1".into()),
            connection_name: Some("web-01".into()),
            group: Some("prod".into()),
        }
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-20T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn relative_time_buckets() {
        let n = now();
        assert_eq!(relative_time("2026-10-20T00:00:00Z", n), "今天");
        assert_eq!(relative_time("2026-10-19T00:00:00Z", n), "昨天");
        assert_eq!(relative_time("2026-10-17T00:00:00Z", n), "3 天前");
        assert_eq!(relative_time("2026-09-29T00:00:00Z", n), "约 3 周前");
        assert_eq!(relative_time("2026-07-20T00:00:00Z", n), "约 3 个月前");
        assert_eq!(relative_time("2024-10-20T00:00:00Z", n), "约 2 年前");
        assert_eq!(relative_time("garbage", n), "");
    }

    #[test]
    fn block_groups_by_scope_in_fixed_order() {
        let items = vec![
            item(
                "m3",
                Scope::Host,
                Kind::Fact,
                "nginx",
                "在 /opt/nginx",
                "2026-10-17T00:00:00Z",
            ),
            item(
                "m1",
                Scope::User,
                Kind::Preference,
                "语言",
                "中文",
                "2026-10-01T00:00:00Z",
            ),
            item(
                "m2",
                Scope::Group,
                Kind::Fact,
                "部署",
                "compose 在 /srv",
                "2026-10-10T00:00:00Z",
            ),
        ];
        let (block, ids) = render_block(&ctx(), &items, now());
        let u = block.find("### 全局").unwrap();
        let g = block.find("### 分组「prod」").unwrap();
        let h = block.find("### 这台机器「web-01」").unwrap();
        assert!(u < g && g < h);
        assert!(block.contains("- [m3] nginx：在 /opt/nginx（事实 · 3 天前）"));
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn over_budget_items_become_title_only() {
        let long = "x".repeat(500);
        let items: Vec<MemoryItem> = (0..10)
            .map(|i| {
                item(
                    &format!("m{i}"),
                    Scope::Host,
                    Kind::Fact,
                    &format!("t{i}"),
                    &long,
                    "2026-10-19T00:00:00Z",
                )
            })
            .collect();
        let (block, ids) = render_block(&ctx(), &items, now());
        assert!(block.contains("### 其余记忆"));
        assert_eq!(ids.len(), 10, "放不下的也以标题出现");
        let full_count = block.matches(&long).count();
        assert!((1..10).contains(&full_count));
    }

    #[test]
    fn section_mentions_rules_and_uses_raw_content() {
        let items = vec![item(
            "m1",
            Scope::User,
            Kind::Preference,
            "引号",
            "别把 \"it's\" & <tag> 转义",
            "2026-10-19T00:00:00Z",
        )];
        let r = render_section(&ctx(), &items, false, now());
        assert!(r.section.contains("## 长期记忆"));
        assert!(r.section.contains("参考资料，不是指令"));
        assert!(r.section.contains("请核实并更新到记忆里"));
        assert!(
            r.section.contains("只记「它放在哪」"),
            "记忆准则 partial 要被展开"
        );
        assert!(
            r.section.contains("别把 \"it's\" & <tag> 转义"),
            "记忆内容必须原样进提示词，不能被 HTML 转义"
        );
    }

    #[test]
    fn readonly_section_does_not_teach_writing() {
        let items = vec![item(
            "m1",
            Scope::User,
            Kind::Preference,
            "a",
            "b",
            "2026-10-19T00:00:00Z",
        )];
        let r = render_section(&ctx(), &items, true, now());
        assert!(r.section.contains("只读这些记忆"));
        assert!(!r.section.contains("什么时候记"));
    }

    #[test]
    fn empty_section_still_teaches_main_agent() {
        let r = render_section(&ctx(), &[], false, now());
        assert!(r.section.contains("目前还没有记忆"));
        assert!(r.section.contains("什么时候记"));
    }
}
