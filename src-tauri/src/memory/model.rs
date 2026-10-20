//! 长期记忆的数据形状：作用域、条目、写入操作、操作日志、复盘提示行。
//!
//! 这里只有数据与校验，不碰数据库（见 `store.rs`）也不碰提示词（见 `inject.rs`）。

use serde::{Deserialize, Serialize};

/// 标题与正文的长度上限（按字符计）。工具、复盘、整理助手、设置页共用这一处。
///
/// 记忆会进**每一次**请求的系统提示词，条目必须短：长到放不进一句话的东西，
/// 要么该拆成几条，要么本来就该去翻历史会话（`memory_recall`）。
pub const TITLE_MAX_CHARS: usize = 60;
pub const CONTENT_MAX_CHARS: usize = 600;

/// 记忆属于谁。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// 全局：关于用户这个人（偏好、习惯、禁忌），每台机器的对话都带。
    User,
    /// 一组机器的共性：键是连接的分组名。
    Group,
    /// 这台机器：键是 `SavedConnection.id`。
    Host,
}

impl Scope {
    pub fn as_str(self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Group => "group",
            Scope::Host => "host",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "user" => Some(Scope::User),
            "group" => Some(Scope::Group),
            "host" => Some(Scope::Host),
            _ => None,
        }
    }

    /// 给人（和模型）看的中文名。
    pub fn label(self) -> &'static str {
        match self {
            Scope::User => "全局",
            Scope::Group => "分组",
            Scope::Host => "这台机器",
        }
    }
}

/// 一个具体的作用域：类别 + 键（全局的键恒为空串）。
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRef {
    pub scope: Scope,
    pub key: String,
}

impl ScopeRef {
    pub fn user() -> Self {
        Self {
            scope: Scope::User,
            key: String::new(),
        }
    }

    pub fn group(name: impl Into<String>) -> Self {
        Self {
            scope: Scope::Group,
            key: name.into(),
        }
    }

    pub fn host(connection_id: impl Into<String>) -> Self {
        Self {
            scope: Scope::Host,
            key: connection_id.into(),
        }
    }
}

/// 记忆的种类：决定注入时的排序，以及「会不会过期」的口吻。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// 偏好 / 规矩：「回复用中文」「重启服务前先问我」。
    Preference,
    /// 环境事实：「nginx 配置在 /opt/nginx」。
    Fact,
    /// 经验：踩过的坑与最后管用的解法。
    Lesson,
    /// 变更记录：对机器做过的改动（带日期）。
    Change,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Preference => "preference",
            Kind::Fact => "fact",
            Kind::Lesson => "lesson",
            Kind::Change => "change",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "preference" => Some(Kind::Preference),
            "fact" => Some(Kind::Fact),
            "lesson" => Some(Kind::Lesson),
            "change" => Some(Kind::Change),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::Preference => "偏好",
            Kind::Fact => "事实",
            Kind::Lesson => "经验",
            Kind::Change => "变更",
        }
    }
}

/// 这次写入是谁发起的。
///
/// 它决定一件事：**改动要不要立刻打进已冻结的注入快照**（见 [`Source::user_initiated`]）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// 用户在记忆管理页手动改的。
    User,
    /// 对话中的 agent 经 `memory` 工具写的。
    Agent,
    /// 后台复盘写的。
    Reflection,
    /// 记忆管理页的整理助手写的（用户一句话发起）。
    Assistant,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::User => "user",
            Source::Agent => "agent",
            Source::Reflection => "reflection",
            Source::Assistant => "assistant",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "user" => Some(Source::User),
            "agent" => Some(Source::Agent),
            "reflection" => Some(Source::Reflection),
            "assistant" => Some(Source::Assistant),
            _ => None,
        }
    }

    /// 用户亲手（或一句话让整理助手）做的改动：**立刻生效**，进行中的对话下一轮
    /// 就会重新渲染注入段 —— 删掉的东西必须马上不再被模型看到。
    ///
    /// agent 与复盘写的不算：它们不改已冻结的快照（agent 刚写的东西本来就在它的
    /// 上下文里；复盘的结果留给下一次会话），这样一段对话的系统提示词保持稳定，
    /// 前缀缓存不会因为「记了一条」就整段失效。
    pub fn user_initiated(self) -> bool {
        matches!(self, Source::User | Source::Assistant)
    }
}

/// 一条记忆。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub id: String,
    pub scope: Scope,
    pub scope_key: String,
    pub kind: Kind,
    pub title: String,
    pub content: String,
    pub pinned: bool,
    pub source: Source,
    pub source_conversation_id: Option<String>,
    pub source_message_id: Option<String>,
    /// RFC3339。
    pub created_at: String,
    pub updated_at: String,
    /// 每次改动 +1；整理助手 / 设置页带它做乐观并发校验。
    pub version: i64,
    /// 管理页的「新」标记（后台复盘 / agent 写入后置位，用户看过即清）。
    pub is_new: bool,
}

impl MemoryItem {
    pub fn scope_ref(&self) -> ScopeRef {
        ScopeRef {
            scope: self.scope,
            key: self.scope_key.clone(),
        }
    }
}

/// 新增一条记忆的请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMemory {
    pub scope: Scope,
    #[serde(default)]
    pub scope_key: String,
    pub kind: Kind,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub source_conversation_id: Option<String>,
    #[serde(default)]
    pub source_message_id: Option<String>,
}

/// 修改一条记忆（只改给了的字段）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub kind: Option<Kind>,
    /// 改作用域（整理助手「这条其实是全局的」）。
    #[serde(default)]
    pub scope: Option<ScopeRef>,
    #[serde(default)]
    pub pinned: Option<bool>,
}

impl MemoryPatch {
    pub fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.content.is_none()
            && self.kind.is_none()
            && self.scope.is_none()
            && self.pinned.is_none()
    }
}

/// 一次写入里的一个操作。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum WriteOp {
    Add {
        #[serde(flatten)]
        memory: NewMemory,
    },
    Update {
        id: String,
        /// 给了就做乐观并发校验：与库里的版本不一致 → 整批失败（别人刚改过它）。
        #[serde(default)]
        expected_version: Option<i64>,
        #[serde(flatten)]
        patch: MemoryPatch,
    },
    Delete {
        id: String,
        #[serde(default)]
        expected_version: Option<i64>,
    },
}

/// 一批写入的身份：同一批共用一个 batch id（撤销「这一次」就是撤销这一批）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchContext {
    pub batch_id: String,
    pub source: Source,
    pub conversation_id: Option<String>,
}

impl BatchContext {
    pub fn new(source: Source, conversation_id: Option<String>) -> Self {
        Self {
            batch_id: format!("b_{}", uuid::Uuid::new_v4().simple()),
            source,
            conversation_id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpKind {
    Add,
    Update,
    Delete,
}

impl OpKind {
    pub fn as_str(self) -> &'static str {
        match self {
            OpKind::Add => "add",
            OpKind::Update => "update",
            OpKind::Delete => "delete",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "add" => Some(OpKind::Add),
            "update" => Some(OpKind::Update),
            "delete" => Some(OpKind::Delete),
            _ => None,
        }
    }
}

/// 操作日志的一行：改之前、改之后各一份完整快照（撤销就是把 before 写回去）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryOpRecord {
    pub id: i64,
    pub batch_id: String,
    pub memory_id: String,
    pub op: OpKind,
    pub before: Option<MemoryItem>,
    pub after: Option<MemoryItem>,
    pub source: Source,
    pub conversation_id: Option<String>,
    pub created_at: String,
    pub reverted: bool,
}

/// 对话里那一行「📝 记住 N 条」：挂在被复盘那段的最后一条消息之后。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflectionNote {
    pub id: String,
    pub conversation_id: String,
    /// 被复盘那段的最后一条消息 id —— 前端把这一行渲染在它后面。
    pub anchor_message_id: String,
    pub batch_id: Option<String>,
    /// 第一次后台复盘：附带「这是什么、花多少、怎么关」的说明卡。
    pub intro: bool,
    pub created_at: String,
    /// 这一批里的操作（列出时联表填上；撤销过的也在，带 `reverted`）。
    #[serde(default)]
    pub ops: Vec<MemoryOpRecord>,
}

/// 校验失败的原因（直接给模型 / 用户看）。
pub type ValidationError = String;

/// 规整并校验标题与正文：去首尾空白、拒空、拒超长。
///
/// 超长**拒绝而不是截断**：截掉的那半句可能正是关键，模型拿到明确的错误会自己
/// 改短或拆开。
pub fn normalize_text(title: &str, content: &str) -> Result<(String, String), ValidationError> {
    let title = title.trim().to_string();
    let content = content.trim().to_string();
    if title.is_empty() {
        return Err("标题不能为空".into());
    }
    if content.is_empty() {
        return Err("内容不能为空".into());
    }
    let tc = title.chars().count();
    if tc > TITLE_MAX_CHARS {
        return Err(format!(
            "标题太长（{tc} 字，上限 {TITLE_MAX_CHARS}）：标题是一眼能认出这条的短语"
        ));
    }
    let cc = content.chars().count();
    if cc > CONTENT_MAX_CHARS {
        return Err(format!(
            "内容太长（{cc} 字，上限 {CONTENT_MAX_CHARS}）：拆成几条，或只记结论"
        ));
    }
    Ok((title, content))
}

/// 校验作用域键：全局必须为空，分组 / 机器必须非空。
pub fn validate_scope(scope: Scope, key: &str) -> Result<(), ValidationError> {
    match scope {
        Scope::User if !key.is_empty() => Err("全局记忆不该带作用域键".into()),
        Scope::Group | Scope::Host if key.trim().is_empty() => {
            Err(format!("{}记忆缺少作用域键", scope.label()))
        }
        _ => Ok(()),
    }
}

/// 查重用的规整：小写、去掉空白与常见标点。
pub fn dedup_key(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace() && !is_punct(*c))
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn is_punct(c: char) -> bool {
    c.is_ascii_punctuation()
        || matches!(
            c,
            '，' | '。'
                | '、'
                | '：'
                | '；'
                | '！'
                | '？'
                | '（'
                | '）'
                | '「'
                | '」'
                | '“'
                | '”'
                | '‘'
                | '’'
                | '《'
                | '》'
                | '【'
                | '】'
                | '—'
                | '…'
                | '·'
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rejects_empty_and_too_long() {
        assert!(normalize_text("", "x").is_err());
        assert!(normalize_text("x", "  ").is_err());
        assert!(normalize_text(&"字".repeat(TITLE_MAX_CHARS + 1), "x").is_err());
        assert!(normalize_text("x", &"字".repeat(CONTENT_MAX_CHARS + 1)).is_err());
        assert_eq!(
            normalize_text("  标题 ", " 正文\n").unwrap(),
            ("标题".to_string(), "正文".to_string())
        );
    }

    #[test]
    fn scope_key_rules() {
        assert!(validate_scope(Scope::User, "").is_ok());
        assert!(validate_scope(Scope::User, "x").is_err());
        assert!(validate_scope(Scope::Host, "").is_err());
        assert!(validate_scope(Scope::Group, "prod").is_ok());
    }

    #[test]
    fn dedup_key_ignores_case_space_and_punct() {
        assert_eq!(dedup_key("Nginx 配置，位置"), dedup_key("nginx配置位置"));
        assert_ne!(dedup_key("nginx 配置"), dedup_key("nginx 日志"));
    }

    #[test]
    fn write_op_serde_shape() {
        let op: WriteOp = serde_json::from_value(serde_json::json!({
            "op": "update", "id": "m1", "content": "新内容", "expectedVersion": 3
        }))
        .unwrap();
        assert_eq!(
            op,
            WriteOp::Update {
                id: "m1".into(),
                expected_version: Some(3),
                patch: MemoryPatch {
                    content: Some("新内容".into()),
                    ..Default::default()
                }
            }
        );
        let add: WriteOp = serde_json::from_value(serde_json::json!({
            "op": "add", "scope": "host", "scopeKey": "c1", "kind": "fact",
            "title": "t", "content": "c"
        }))
        .unwrap();
        assert!(matches!(add, WriteOp::Add { .. }));
    }

    #[test]
    fn only_user_and_assistant_are_user_initiated() {
        assert!(Source::User.user_initiated());
        assert!(Source::Assistant.user_initiated());
        assert!(!Source::Agent.user_initiated());
        assert!(!Source::Reflection.user_initiated());
    }
}
