// sidecar-task.js — 副手模式：后台学习类任务不注入人格/记忆，只保留工具与最小输出要求。
export const DEFAULT_SIDECAR_REASONS = ['study', 'style-learn', 'style-learn-auto', 'github-learn'];

export function sidecarReasons(cfg) {
  const v = cfg?.socialV2?.tasks?.noPersona;
  return Array.isArray(v) && v.length ? v.map(String) : DEFAULT_SIDECAR_REASONS;
}

export function isSidecarTask(reason, cfg) {
  return sidecarReasons(cfg).includes(String(reason ?? ''));
}

// 最小提示词：令牌（调工具要用）+ 任务边界 + 输出要求。不含人格/记忆/日记/印象/表情/欢迎语。
export function buildSidecarPrompt(reason, key, agentToken = '') {
  return [
    agentToken ? `【会话令牌】${agentToken}（调用状态工具时请在参数中带上此令牌）` : '',
    `【副手模式】本次是后台任务（${reason}），不在和任何人聊天。`,
    '只做下面这件事：用工具取需要的数据，按任务要求整理结果；不扮演角色、不提人格与记忆、不寒暄、不主动发 QQ 消息。',
    '输出要求：纯文本，1~3 句或条目式要点；工具报错就把错误原文附上；不需要引用设定或回忆过去。',
  ].filter(Boolean).join('\n\n') + '\n';
}
