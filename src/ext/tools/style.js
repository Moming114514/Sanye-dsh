// 表达样本：学别人怎么说话（只记框架）
export default {
  name: 'qq_style_note',
  flag: 'styleNote',
  description:
    '记一条「表达样本」：别人说得好的一句话，只记句式和语气，用来学说话方式。不要照搬别人的角色设定。每次最多记 2 条。',
  define(z, agentApi) {
    return {
      shape: {
        text: z.string().describe('原话（可略微精简，别改意思）'),
        from: z.string().optional().describe('谁说的（昵称，可省）'),
        why: z.string().optional().describe('好在哪（一句话，比如：接得快、不端着）'),
        uin: z.string().optional().describe('说话人的 QQ 号，能填就填（用来确认是不是该学的那个人）'),
      },
      async handler({ text, from, why, uin }) {
        const r = await agentApi('/api/socialV2/style-note', { method: 'POST', body: JSON.stringify({ text, from, why, uin, source: 'qq' }) });
        return { content: [{ type: 'text', text: r?.ok ? `记住了（共 ${r.total} 条）` : `没记住：${r?.error || '未知错误'}` }] };
      },
    };
  },
};
