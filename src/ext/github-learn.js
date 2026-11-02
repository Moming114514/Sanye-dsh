// 每周从 GitHub 高星项目里学 3 条可复用的做法（替代 B 站视频学习）。
// 只读公开 API，不 clone、不运行别人的代码。
import fs from 'node:fs';
import path from 'node:path';

const STATE_DIR = process.env.SURFCORE_STATE_DIR || path.join(process.env.HOME || '/home/dsh', '.dsh', 'surfcore', 'state');
const FILE = path.join(STATE_DIR, 'github-learn.json');

const DEFAULT_TOPICS = [
  'llm-agent', 'chatbot', 'qq-bot', 'agent-memory', 'prompt-engineering',
  'rag', 'mcp', 'onebot',
];

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { seen: {}, lastAt: 0 };
  }
}

function saveState(st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 1));
  fs.renameSync(tmp, FILE);
}

function ymd(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function api(url) {
  const r = await fetch(url, {
    headers: {
      'user-agent': 'surfcore-github-learn',
      accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export default function createGithubLearn({ cfg = {}, deliverPrompt, log = () => {} } = {}) {
  const conf = Object.assign({
    enabled: true,
    minStars: 800,
    weekday: 1,        // 1 = 周一（兼容旧配置）
    weekdays: [1],     // 支持多天，如 [1,4]
    hour: 10,
    maxChars: 6000,
    topics: DEFAULT_TOPICS,
  }, cfg?.socialV2?.githubLearn || {});

  let busy = false;

  async function pickRepo(st) {
    const topics = (conf.topics && conf.topics.length ? conf.topics : DEFAULT_TOPICS);
    for (const t of topics) {
      const q = encodeURIComponent(`topic:${t} stars:>=${conf.minStars} pushed:>2026-01-01`);
      let list;
      try {
        list = await api(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=10`);
      } catch (e) {
        log(`[GitHub学] 搜索失败（${t}）：${e.message}`);
        continue;
      }
      for (const it of (list.items || [])) {
        const key = it.full_name;
        if (st.seen[key]) continue;
        return it;
      }
    }
    return null;
  }

  async function readReadme(fullName) {
    const j = await api(`https://api.github.com/repos/${fullName}/readme`);
    const buf = Buffer.from(String(j.content || '').replace(/\s+/g, ''), 'base64');
    return buf.toString('utf8').slice(0, conf.maxChars);
  }

  async function tick() {
    if (!conf.enabled || busy) return;
    const now = new Date();
    const days = Array.isArray(conf.weekdays) && conf.weekdays.length ? conf.weekdays : [conf.weekday];
    if (!days.includes(now.getDay()) || now.getHours() < conf.hour) return;
    const st = loadState();
    if (st.lastDay === ymd(now)) return;
    busy = true;
    try {
      const repo = await pickRepo(st);
      if (!repo) {
        log('[GitHub学] 没有新仓库可选，跳过本周');
        return;
      }
      const readme = await readReadme(repo.full_name).catch(() => '');
      if (!readme) {
        log('[GitHub学] README 读取失败：' + repo.full_name);
        return;
      }
      st.seen[repo.full_name] = ymd(now);
      st.lastDay = ymd(now);
      st.lastRepo = repo.full_name;
      saveState(st);

      const task = [
        '这周从 GitHub 学一个项目（不是让你夸它，是找能用的做法）。',
        `仓库：${repo.full_name}（${repo.stargazers_count} 星）`,
        `简介：${repo.description || '（无）'}`,
        '',
        '下面它的 README 节选：',
        readme,
        '',
        '要做的事（按顺序）：',
        '1) 找出 1~3 个「能用到我们自己身上」的具体做法（架构、提示词、缓存、记忆、工具调用都算）；',
        '2) 每条用 note_tech 记一条：title=做法名，body=一句话说明 + 为什么值得抄 + 我们哪里能改；',
        '3) 最后给他发一句话总结（不超过两行），说明这次学到了什么、值不值得跟进。',
        '如果这项目对我们的情况完全没用，就直接说"这个不适用"，不要硬凑。',
      ].join('\n');

      await deliverPrompt(task, { reason: 'github-learn' });
      log(`[GitHub学] 已派发：${repo.full_name}（${repo.stargazers_count}★）`);
    } catch (e) {
      log('[GitHub学] 失败：' + e.message);
    } finally {
      busy = false;
    }
  }

  return {
    id: 'githubLearn',
    title: 'GitHub 每周一学',
    tick,
  };
}
