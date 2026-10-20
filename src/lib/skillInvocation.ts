import type { Skill } from './types';

/**
 * 用户在输入框手动引用 skill 时，发给模型的指令正文（引用瞬间的快照）。
 *
 * 带附属资源且 skill 已启用时，补上资源清单：资源只能经该 skill 的工具 `path`
 * 参数回传（agent 在远端读不到本机配置目录），不告诉模型它们存在，正文里
 * 「见 references/a.md」就只能凭空编。工具名由后端生成（含 id 标签），这里不复刻，
 * 只让模型按描述（以「<skill 名>:」开头）认工具。未启用的 skill 没有注册成工具，
 * 提示了也读不到，所以不提示。
 */
export function expandSkillForInput(skill: Skill): string {
  const resources = skill.enabled ? skill.resources ?? [] : [];
  if (resources.length === 0) return skill.prompt;
  const list = resources.map((r) => `- ${r.path}`).join('\n');
  return `${skill.prompt}\n\n---\n\n该 skill 附带 ${resources.length} 个资源文件。正文若引用了它们，`
    + `请调用描述以「${skill.name}:」开头的 skill 工具并传入 \`path\` 参数按需读取，不要凭记忆编造其内容：\n${list}`;
}
