use serde::{Deserialize, Serialize};

/// 一次工具调用的处置结果 —— 风险评估的**唯一**输出。
///
/// 变体的声明顺序就是严重程度的顺序：`Allow < Approval < ForceApproval < Deny`。
/// 这个顺序是刻意的：一条命令由多个 shell 段拼成（`a; b | c`），每段各判一次，
/// 取最严的那档，所以引擎里到处是 `cmp::max`。
///
/// 它取代了旧的五档严重度（`ReadOnly` / `LowRisk` / `Moderate` / `HighRisk` /
/// `Destructive`）。旧那套算出来没有任何决策读它，只当了个 UI 标签；四档才是
/// 决策本身。老值靠下面的 `alias` 继续能读进来，三处历史数据都不用迁移：
/// SQLite 里 `tool_calls_json` 的历史记录、已安装插件 manifest 里的 `riskLevel`、
/// 以及早先版本前端收到过的字符串。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Disposition {
    /// 正常放行。
    #[serde(alias = "ReadOnly", alias = "LowRisk")]
    Allow,
    /// 请求审批。Auto 模式跳过。
    #[serde(alias = "Moderate")]
    Approval,
    /// 强制审批：**覆盖命令名单**，只要命中就必须由人点一次 —— 名单说放行也不算数
    /// （这是它与 `Approval` 的唯一差别：`Approval` 会被名单降成放行，它不会）。
    /// Auto 模式下默认与 `Approval` 一样静默执行；打开 `auto_mode_force_approval`
    /// 后，只有这一档会回到人工确认。
    #[serde(alias = "HighRisk", alias = "Destructive")]
    ForceApproval,
    /// 直接拒绝。不执行，把原因回给模型。
    Deny,
}

impl Disposition {
    /// 给用户看的中文档位名（系统通知、审批弹窗、设置页的命令测试）。
    pub fn label(&self) -> &'static str {
        match self {
            Self::Allow => "正常放行",
            Self::Approval => "请求审批",
            Self::ForceApproval => "强制审批",
            Self::Deny => "直接拒绝",
        }
    }
}

/// 定档结果，外加一句"为什么是这个档位"。
///
/// 理由不是可有可无的装饰：直接拒绝时它是回给模型的唯一线索（模型得知道自己是
/// 哪一步踩线了才改得回来），强制审批时它决定审批弹窗上那句解释。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assessment {
    pub disposition: Disposition,
    /// `Allow` 时为 `None`。
    pub reason: Option<String>,
    /// 决定这个档位的那条规则（`rules::RULES` 里的 id，或自定义规则的 id）。
    pub rule_id: Option<String>,
    /// 这条命令命中的**全部**规则（不止决定档位的那条），设置页「命令测试」据此展示。
    pub hits: Vec<RuleHit>,
}

/// 命中的一条规则及其当时的档位。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleHit {
    pub rule_id: String,
    pub level: Disposition,
}

impl Assessment {
    pub fn allow() -> Self {
        Self {
            disposition: Disposition::Allow,
            reason: None,
            rule_id: None,
            hits: Vec::new(),
        }
    }

    /// 按档位造一个带理由的结论（`Allow` 不带理由）。
    pub fn at(level: Disposition, reason: impl Into<String>) -> Self {
        if level == Disposition::Allow {
            return Self::allow();
        }
        Self {
            disposition: level,
            reason: Some(reason.into()),
            rule_id: None,
            hits: Vec::new(),
        }
    }

    pub fn approval(reason: impl Into<String>) -> Self {
        Self::at(Disposition::Approval, reason)
    }

    pub fn forced(reason: impl Into<String>) -> Self {
        Self::at(Disposition::ForceApproval, reason)
    }

    pub fn denied(reason: impl Into<String>) -> Self {
        Self::at(Disposition::Deny, reason)
    }

    /// 标明这个结论来自哪条规则。
    pub fn with_rule(mut self, rule_id: &str) -> Self {
        self.rule_id = Some(rule_id.to_string());
        self.hits = vec![RuleHit {
            rule_id: rule_id.to_string(),
            level: self.disposition,
        }];
        self
    }

    /// 取更严的那一个；同级保留先来的（先命中的理由更贴近原因）。
    /// 两边命中的规则合并到结果里（同一条规则只留一次）。
    pub fn worst(self, other: Self) -> Self {
        let (mut win, lose) = if other.disposition > self.disposition {
            (other, self)
        } else {
            (self, other)
        };
        for hit in lose.hits {
            if !win.hits.iter().any(|h| h.rule_id == hit.rule_id) {
                win.hits.push(hit);
            }
        }
        win
    }
}
