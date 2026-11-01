// 欠着的事：记「答应过的事」，可带到点提醒
export default {
  name: 'qq_loop',
  flag: 'loops',
  description:
    '记「欠着的事」：答应过的事、他说了明天/回头/记得/等我之类的事、还没做完的事。他要你到点提醒，就带上 due（比如「明天9:00」）。做完就把它划掉。只记状态，不记人设、不记事实。每次最多一条，短一点。',
  define(z, agentApi) {
    return {
      shape: {
        action: z.enum(['add', 'done', 'list']).optional().describe('add 记一条（默认），done 划掉，list 看清单'),
        text: z.string().optional().describe('事情本身（add / done 时给），一句话，20 字以内最好'),
        id: z.string().optional().describe('list 返回的 id，用 id 划掉更准'),
        due: z.string().optional().describe('要到点提醒的时间，例如 明天9:00 / 今晚20:00 / +2h / 10-31 20:00；不给就只是记着'),
      },
      async handler({ action, text, id, due }) {
        const r = await agentApi('/api/socialV2/loop', { method: 'POST', body: JSON.stringify({ action: action || 'add', text, id, due, by: 'self' }) });
        const items = Array.isArray(r?.items) ? r.items : [];
        if (action === 'list' || items.length) {
          const lines = items.length ? items.map((it) => `- ${it.text}`).join('\n') : '（空的）';
          return { content: [{ type: 'text', text: `${r?.ok ? '好' : '没成：' + (r?.error || '未知')}\n现在欠着的事：\n${lines}` }] };
        }
        return { content: [{ type: 'text', text: r?.ok ? '记好了' : `没记上：${r?.error || '未知错误'}` }] };
      },
    };
  },
};
