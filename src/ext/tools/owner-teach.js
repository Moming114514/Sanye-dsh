export default {
  name: 'qq_learn_from_owner',
  flag: 'ownerTeach',
  description:
    '主人（他在私聊里）纠正你的说法、或给你一个"应该怎么说"的示范时，用这个记下来：让他下次不用重复教。只记「该怎么说」，不记他的私人信息。每次最多记 1 条。',
  define(z, agentApi) {
    return {
      shape: {
        better: z.string().describe('他示范的、你以后该照着说的那句话（照抄他的说法，别自己改）'),
        wrong: z.string().optional().describe('你原来是怎么说的（能填就填，方便对比）'),
        why: z.string().optional().describe('他为什么这么改（一句话，比如：太干脆、像客服、别加语气词）'),
      },
      async handler({ better, wrong, why }) {
        const r = await agentApi('/api/socialV2/owner-teach', {
          method: 'POST',
          body: JSON.stringify({ action: 'add', better, wrong, why }),
        });
        if (r?.ok) return { content: [{ type: 'text', text: `记下了（共 ${r.total} 条），以后就这么说` }] };
        return { content: [{ type: 'text', text: `没记成：${r?.error || '未知错误'}` }] };
      },
    };
  },
};
