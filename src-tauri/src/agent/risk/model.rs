use super::checker::{is_listing_only, is_mkfs, is_read_only_system_query};
use super::disposition::Assessment;
use super::parser::ParsedSegment;
use super::rules::RuleConfig;

/// 单段命令的**基础档位**：只看命令名与 `sudo` 包裹，不看路径参数。
///
/// 命令名单（系统级命令、磁盘工具、按名字杀进程）和每条规则的档位都来自规则表
/// （[`super::rules`]，用户可改），这里只负责「命令名命中了哪条规则」。
///
/// 返回 `Allow` 不代表"这条命令随便跑" —— 它只表示**这一层没有意见**，档位交给
/// 后面的命令名单去定（白名单命中就放行、黑名单命中就要审批）。所以这里刻意不再
/// 分"低风险 / 中风险"：那两级算出来也没人拿它做不同的决定，只是徒增维护点。
///
/// `Approval` 默认只有一个来源 —— sudo 包装的保底档。它与 `Allow` 的差别
/// 是普通模式下必问一次，Auto 模式跳过。
pub fn base_assessment(parsed: &ParsedSegment, rules: &RuleConfig) -> Assessment {
    let base = parsed.base_cmd.as_str();
    // sudo 包装只**保底**抬到「请求审批」：Auto 模式跳过这档，普通模式要人点头。
    // 里面的命令照常逐条评估取最严 —— `sudo systemctl restart nginx` 被系统级命令
    // 抬回强制审批，`sudo rm -rf /` 走灾难判定直接拒绝；sudo 自己只贡献这一档，
    // 判据是"里面跑了什么"，不是"有没有 sudo"。`-n` 只是非交互（要密码就失败），
    // 不改变提权这件事本身，也不额外加重。
    let mut worst = if parsed.sudo_wrapped {
        rules.verdict_default("sudo_wrapper", &[])
    } else {
        Assessment::allow()
    };
    // 命令位置是个变量（`$CMD` / `${CMD}`，含 `bash -c "$CMD"` 递归进来的段）：
    // 展开成什么运行时才知道，静态判定评的是假命令。直接拒绝并要求写明原文。
    // 参数位置的变量（`echo $HOME`）不在此列。
    if base.starts_with('$') {
        // 与 policy.rs 里「包装却没有内层」那一支措辞不同，规则表里放的是后者；这里就地写。
        worst = worst.worst(rules.verdict_with(
            "command_in_variable",
            "命令写在了变量里（$…），展开后的内容无法静态判定 —— 请把要执行的命令原文写出来",
            &[],
        ));
    }
    // 按名字批量杀进程：命中面由名字匹配决定（`pkill -f ssh` 连自己的 SSH 会话都能
    // 一起带走），而且几乎总有更精确的替代 —— 理由里写明替代写法，模型会照着换。
    if rules.list_has("name_based_kill_commands", base) {
        worst = worst.worst(rules.verdict_default("name_based_kill", &[("命令", base)]));
    }
    if rules.list_has("system_level_commands", base) {
        // `systemctl status` / `service x status` / 裸 `mount` / `crontab -l` 这类
        // 查询形态什么也不改，别把它们和 `restart` / `umount` 一起抬档。
        if !is_read_only_system_query(base, &parsed.args, rules) {
            worst = worst.worst(rules.verdict_default("system_level_commands", &[("命令", base)]));
        }
    } else if is_mkfs(base) || rules.list_has("disk_commands", base) {
        // `fdisk -l` / `parted --list` 只是把分区表打出来看，没有写盘动作。
        if !is_listing_only(base, &parsed.args, rules) {
            worst = worst.worst(rules.verdict_default("disk_tools", &[("命令", base)]));
        }
    }
    worst
}
