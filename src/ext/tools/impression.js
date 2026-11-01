// 印象库：她对人/事的看法（不是事实清单）
export default {
  name: 'qq_impression',
  flag: 'impressions',
  description:
    '记「我对他的看法」——不是事实清单，是你自己攒下来的感觉（比如「他嘴上说没事的时候多半在硬撑」）。记忆卡记发生了什么事，这里记你怎么看这个人。看法可以改、可以删，别写成评价表，也别一次记一堆。',
  define(z, agentApi) {
    return {
      shape: {
        action: z.enum(['add', 'list', 'forget']).optional().describe('add 记一条（默认），list 看看现在有什么，forget 删一条'),
        text: z.string().optional().describe('一句话，30 字以内，说一个具体的感觉（add 时给）'),
        about: z.enum(['he', 'world', 'me']).optional().describe('说的是谁：he=他（默认），world=外面的事，me=我自己'),
        confidence: z.enum(['guess', 'sure']).optional().describe('guess=还不确定（默认），sure=很确定了'),
        id: z.string().optional().describe('list 返回的 id，要删时给'),
      },
      async handler({ action, text, about, confidence, id }) {
        const r = await agentApi('/api/socialV2/impression', { method: 'POST', body: JSON.stringify({ action: action || 'add', text, about, confidence, id }) });
        const items = Array.isArray(r?.items) ? r.items : [];
        if (action === 'list' || items.length) {
          const lines = items.length ? items.map((it) => `- ${it.text}（${it.about === 'he' ? '他' : it.about === 'me' ? '我自己' : '外面的事'}）`).join('\n') : '（还没有）';
          return { content: [{ type: 'text', text: `${r?.ok ? '好' : '没成：' + (r?.error || '未知')}\n我现在的看法：\n${lines}` }] };
        }
        return { content: [{ type: 'text', text: r?.ok ? '记下了，这个看法先存着' : `没记上：${r?.error || '未知错误'}` }] };
      },
    };
  },
};
