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
        count: z.number().optional().describe('拉多少条，默认 20，最多 40'),
      },
      async handler({ group, count }) {
        const r = await agentApi('/api/socialV2/group-recent', { method: 'POST', body: JSON.stringify({ group, count }) });
        if (!r?.ok) return { content: [{ type: 'text', text: `读群失败：${r?.error || '未知错误'}` }] };
        return { content: [{ type: 'text', text: r.lines?.length ? r.lines.join('\n') : '（没读到消息）' }] };
      },
    };
  },
};
