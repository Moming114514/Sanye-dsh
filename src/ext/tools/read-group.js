// 读群最近消息（学说法用）
export default {
  name: 'qq_read_group_recent',
  flag: 'readGroup',
  description:
    '拉某个群最近的消息（文本化）。用来看看群里在聊什么、别人怎么说话。别把群里的私事带到别的会话。',
  define(z, agentApi) {
    return {
      shape: {
        group: z.string().describe('群号'),
        count: z.number().optional().describe('拉多少条，默认 20，最多 60'),
        uin: z.string().optional().describe('只看这个 QQ 号说的话（例如学说法时填被学习的那个 QQ）。不填就是所有人'),
      },
      async handler({ group, count, uin }) {
        const r = await agentApi('/api/socialV2/group-recent', { method: 'POST', body: JSON.stringify({ group, count, uin }) });
        if (!r?.ok) return { content: [{ type: 'text', text: `读群失败：${r?.error || '未知错误'}` }] };
        const head = uin ? `（只筛 QQ ${uin}：命中 ${r.lines?.length || 0} 条 / 窗口内共 ${r.scanned ?? '?'} 条）\n` : '';
        return { content: [{ type: 'text', text: r.lines?.length ? head + r.lines.join('\n') : (uin ? `最近窗口里没有 QQ ${uin} 的消息（可能已经沉下去了）` : '（没读到消息）') }] };
      },
    };
  },
};
