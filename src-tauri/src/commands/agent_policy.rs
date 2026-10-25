use serde::{Deserialize, Serialize};
use tauri::State;

use crate::agent::risk::{
    CustomRiskRule, Disposition, RiskRuleOverride, RuleConfig, RuleKind, RuleScope, SecurityPolicy,
    RULES,
};
use crate::agent::task::AgentMode;
use crate::agent::tool_dispatcher::{decide_command, needs_human_confirmation};
use crate::config::settings::AgentModeSettings;
use crate::error::AppError;
use crate::AppState;

/// 命令命中的一条风险规则，给设置页「命令测试」展示。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRuleHit {
    pub rule_id: String,
    pub title: String,
    pub level: Disposition,
}

/// Result of evaluating a command against the current AGENT-mode policy.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandCheckResult {
    pub allowed: bool,
    pub requires_confirmation: bool,
    pub disposition: Disposition,
    pub reason: String,
    /// 决定档位的那条规则（`None` = 档位来自命令名单，或没有任何规则命中）。
    pub rule_id: Option<String>,
    /// 命中的全部风险规则（含没有决定档位、但也命中了的那些）。
    pub hits: Vec<CommandRuleHit>,
}

/// 设置页「测试命令」带来的**草稿**：用户还没点保存的规则也要能测出结果。
/// 字段缺省 = 用已保存的设置。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CheckCommandDraft {
    pub risk_rule_overrides: Option<std::collections::HashMap<String, RiskRuleOverride>>,
    pub custom_risk_rules: Option<Vec<CustomRiskRule>>,
    pub custom_protected_paths: Option<Vec<String>>,
    pub agent_mode_settings: Option<AgentModeSettings>,
}

/// 内置的命令审批系统提示词。设置页用它做默认值展示与「恢复默认」，避免前端
/// 再抄一份——两份逐字节相同的副本会各自漂移（见 `templates/approval/审批.hbs`）。
#[tauri::command]
pub async fn agent_default_approval_prompt() -> String {
    crate::agent::templates::TemplateManager.render_approval_base()
}

/// 设置页「测试命令」用的预演：这条命令在当前配置下会被怎么处置。
///
/// 它调用 [`crate::agent::tool_dispatcher::decide_command`] —— 和真正执行时
/// **同一份判定**，所以这里显示的结论就是实际会发生的事。这里以前自己抄了一份
/// 名单逻辑、而且完全不看风险评估，测出来的结论和跑起来的行为可以不一样。
#[tauri::command]
pub async fn agent_check_command(
    state: State<'_, AppState>,
    command: String,
    mode: AgentMode,
    draft: Option<CheckCommandDraft>,
) -> Result<CommandCheckResult, AppError> {
    let settings = state.settings.read().await;
    let draft = draft.unwrap_or_default();
    let mut policy = SecurityPolicy::from_app_settings(&settings);
    if let Some(paths) = &draft.custom_protected_paths {
        policy.custom_protected_paths = paths.clone();
    }
    if draft.risk_rule_overrides.is_some() || draft.custom_risk_rules.is_some() {
        policy = policy.with_rules(RuleConfig::new(
            draft
                .risk_rule_overrides
                .clone()
                .unwrap_or_else(|| settings.risk_rule_overrides.clone()),
            draft
                .custom_risk_rules
                .clone()
                .unwrap_or_else(|| settings.custom_risk_rules.clone()),
        ));
    }
    let agent_settings = draft
        .agent_mode_settings
        .as_ref()
        .unwrap_or(&settings.agent_mode_settings);
    let decision = decide_command(command.trim(), &mode, agent_settings, Some(&policy));
    // 档位本身与模式无关，但「这个模式下到底会不会弹窗」还取决于模式与
    // `auto_mode_force_approval`（Auto 的强制审批例外口）。设置页的结论必须与
    // dispatcher 静态判定一致，否则测出来和跑起来又是两回事。
    let requires_confirmation = needs_human_confirmation(
        &mode,
        Some(&decision),
        decision.disposition,
        false,
        agent_settings,
        false,
    );

    let hits = decision
        .hits
        .iter()
        .map(|h| CommandRuleHit {
            rule_id: h.rule_id.clone(),
            title: policy
                .rules
                .title_of(&h.rule_id)
                .unwrap_or_else(|| h.rule_id.clone()),
            level: h.level,
        })
        .collect();

    Ok(CommandCheckResult {
        allowed: decision.disposition != Disposition::Deny,
        requires_confirmation,
        disposition: decision.disposition,
        reason: decision.reason,
        rule_id: decision.rule_id,
        hits,
    })
}

// ──────────────────────────── 规则目录 ────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskListInfo {
    pub key: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub defaults: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskRuleInfo {
    pub id: &'static str,
    pub kind: RuleKind,
    pub scope: RuleScope,
    pub title: &'static str,
    pub description: &'static str,
    pub examples: Vec<&'static str>,
    pub default_level: Disposition,
    pub lists: Vec<RiskListInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskRuleCatalog {
    pub rules: Vec<RiskRuleInfo>,
}

/// 全部内置命令风险规则（说明、默认档位、可编辑名单的默认值）。
///
/// 只给静态目录；用户的改动在 `settings.riskRuleOverrides` / `customRiskRules` 里，
/// 由设置页自己合并。规则文案只此一份（前端不抄），所以新增规则不用改前端。
#[tauri::command]
pub async fn agent_list_risk_rules() -> RiskRuleCatalog {
    RiskRuleCatalog {
        rules: RULES
            .iter()
            .map(|r| RiskRuleInfo {
                id: r.id,
                kind: r.kind,
                scope: r.scope,
                title: r.title,
                description: r.description,
                examples: r.examples.to_vec(),
                default_level: r.default_level,
                lists: r
                    .lists
                    .iter()
                    .map(|l| RiskListInfo {
                        key: l.key,
                        label: l.label,
                        hint: l.hint,
                        defaults: l.defaults.to_vec(),
                    })
                    .collect(),
            })
            .collect(),
    }
}
