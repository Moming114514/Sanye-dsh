// 人物表：群里某个人的称呼与关系
export default {
  name: 'qq_person_note',
  flag: 'people',
  description:
    '记一下群里某个人：QQ 号、你平时怎么称呼他、他跟主人什么关系（如果他说过）。只记称呼和关系，不要记隐私，不要评价人。',
  define(z, agentApi) {
    return {
      shape: {
        qq: z.string().describe('对方 QQ 号'),
        alias: z.string().optional().describe('你怎么称呼他，比如「墨鱼」「狐狐」'),
        note: z.string().optional().describe('一句关系备注，比如「主人的朋友」「常来问技术问题的」'),
      },
      async handler({ qq, alias, note }) {
        const r = await agentApi('/api/socialV2/person', { method: 'POST', body: JSON.stringify({ qq, alias, note }) });
        return { content: [{ type: 'text', text: r?.ok ? '记好了' : '没记上：' + (r?.error || '未知错误') }] };
      },
    };
  },
};
