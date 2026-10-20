import type { AgentAttachments } from '@/hooks/useAgentAttachments';
import SkillChips from './SkillChips';

interface Props {
  attachments: AgentAttachments;
  mobile?: boolean;
}

/** 输入区上方的 skill 标签行；发送时由草稿 store 一并展开进模型输入。 */
export default function DraftSkillChips({ attachments, mobile = false }: Props) {
  if (attachments.skills.length === 0) return null;
  return (
    <div className="mb-2 min-w-0">
      <SkillChips skills={attachments.skills} mobile={mobile} onRemove={attachments.removeSkill} />
    </div>
  );
}
