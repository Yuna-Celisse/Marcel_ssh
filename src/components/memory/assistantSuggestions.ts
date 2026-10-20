/** 几个起手式：空对话里点一下就开始。启动器（设置页的卡片）和对话里的空状态共用。 */
export function assistantSuggestions(focusLabel: string | null): { label: string; prompt: string }[] {
  const where = focusLabel ?? '各台机器';
  const scope = focusLabel ? `${focusLabel}的` : '';
  return [
    {
      label: '从历史会话里整理',
      prompt: `翻一翻${where}以前的会话，把值得长期记住的习惯、环境事实和经验整理进记忆；已经记过的不要重复。`,
    },
    {
      label: '合并重复、删掉过时的',
      prompt: `检查${scope}记忆：合并重复的，删掉已经过时或互相矛盾的，标题改得一眼能认出来。`,
    },
    {
      label: '查查有没有记了不该记的',
      prompt: `检查${scope}记忆里有没有密码、密钥、token 这类不该保存的内容；有的话删掉，或者改成只记它放在哪里。`,
    },
  ];
}
