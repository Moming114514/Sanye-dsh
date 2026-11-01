// 技术笔记：看过的技术视频/文章，抽成能给主人升级用的资料
export default {
  name: 'note_tech',
  flag: 'techNotes',
  description:
    '把刚看的技术视频/文章记下来——这是给主人升级用的资料库，不是闲聊记忆。记标题、3~5 个要点、里面提到的能用工具/项目/命令、链接。只看了一部分就写看了的部分，别编没看到的内容。同一个视频再记会合并。',
  define(z, agentApi) {
    return {
      shape: {
        title: z.string().describe('标题（原视频/文章标题，可精简）'),
        url: z.string().optional().describe('链接（有 BV 号会自动认出来）'),
        bv: z.string().optional().describe('B 站 BV 号，可省'),
        up: z.string().optional().describe('UP 主 / 作者 / 来源，可省'),
        summary: z.string().optional().describe('一两句话：这内容讲什么（100 字以内）'),
        points: z.array(z.string()).optional().describe('要点，3~5 条，每条一句话、能被用来做决定'),
        tools: z.array(z.string()).optional().describe('能用的东西：插件/项目/命令/链接/参数名，没有就不给'),
        tags: z.array(z.string()).optional().describe('标签：比如 dsh / 记忆 / 提示词 / 部署'),
      },
      async handler({ title, url, bv, up, summary, points, tools, tags }) {
        try {
          const r = await agentApi('/api/socialV2/tech-notes', {
            method: 'POST',
            body: JSON.stringify({ action: 'add', title, url, bv, up, summary, points, tools, tags }),
            timeoutMs: 30000,
          });
          return { content: [{ type: 'text', text: r?.ok ? `记好了（${r.updated ? '合并进已有那条' : '新的一条'}，共 ${r.total} 条）` : `没记上：${r?.error || '未知错误'}` }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `记技术笔记失败：${error?.message ?? error}` }], isError: true };
        }
      },
    };
  },
};
