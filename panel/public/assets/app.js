'use strict';
// 三叶面板 · 前端（零依赖）
// ★ 加一页 = 在 PAGES 里加一个 { id, title, render }
// ★ 加一个功能 = 在 /opt/her/features.json 加一行（页面自动出现，不用改这里）

const PAGES = [
  { id: 'overview', title: '概览', render: pageOverview },
  { id: 'commands', title: '命令', render: pageCommands },
  { id: 'people', title: '人', render: pagePeople },
  { id: 'settings', title: '设置', render: pageSettingsHub },
  { id: 'group-rules', title: '群规则', render: pageGroupRules }, // P2-A
  { id: 'safe', title: '安全', render: pageSafe }, // 频率 + 敏感话题
  { id: 'cost', title: '花费', render: pageCost },
  { id: 'health', title: '健康', render: pageHealth },
  { id: 'personality', title: '性格', render: pagePersonality },
  { id: 'maintenance', title: '维护', render: pageMaintenance },
  { id: 'memory', title: '记忆', render: pageMemoryHub },
  { id: 'style', title: '学说话', render: pageStyle }, // STYLE_GATE_PATCH
  { id: 'talk', title: '说话', render: pageTalk }, // P2-B
  { id: 'decisions', title: '决策记录', render: pageDecisions }, // P1
  { id: 'plugins', title: '插件', render: pagePlugins }, // P3-1：清单来自 /api/plugins
];

// NAV_GROUPS（W4）：按 5 层体系分组（感知/判断/表达/记忆/运维）+ 诊断
// 组名是灰字不可点；手机端由 CSS 隐藏组名，仍是原来的横向导航

// P2-B 第3段：目标导航（3 组 12 项）；state._legacyNav / localStorage her.legacyNav=1 可恢复旧入口
const NAV_GROUPS = [
  { title: '现在', ids: ['overview', 'decisions', 'cost', 'health'] },
  { title: '她', ids: ['personality', 'talk', 'memory', 'group-rules', 'people'] },
  { title: '系统', ids: ['settings', 'commands', 'maintenance'] },
];
function navGroups() {
  return NAV_GROUPS; // A3：导航定稿 12 项，回滚开关已删除
}

// PAGE_ADJUST（B 批）：每页第一张卡之前的一行说明——这页到底能调什么
const PAGE_ADJUST = {
  talk: '说话：人味指标、学到的说法、她的看法、她说的话。',
  health: '只读：自检、诊断、媒体与通道健康。',
  personality: '只读：当前角色与人格文件大小。',
  maintenance: '旧页面入口都在这里，只是没放进主导航。',

  'group-rules': '一屏看完每个群：在不在白名单、怎么回、发言量、只回谁、抽样多少；改完 60 秒内生效，白名单增删建议重启一次。',
  decisions: '每一条「要不要回」的判决都在这里：哪层拦的、分数多少、最后回没回。只读，不改任何判断。',
  overview: '只读：今天的量——花费、她刚说的、欠着的事、自检结果。',
  entry: '入口通道的状态；改通道要去「设置」。',
  features: '全站的开关都在这里：拨完按右侧标记判断是「立即」还是「需重启」。',
  commands: '命令清单；前缀规则见页首（私聊 / 和 #，群里只能 # 和 ！）。',
  people: '按群看今天谁在说话、给谁打过标记；标记只影响她对那个人的态度。',
  utter: '她最近说过的话；可以删掉不想留的句子。',
  settings: '功能开关 / 待生效与重启 / 工具档，三个 Tab 都在这里。',
  access: '白名单与准入：加/删群、加/删私聊。静音与学习模式已挪到「群规则」。',
  safe: '敏感话题守门；省钱模式在花费页，群频率与按群规则在「群规则」页。',
  cost: '省钱模式与花费曲线；改额度在「设置」里。',
  memory: '只读为主：心情、记忆体检、记忆星海三个 Tab。',
  impr: '她对人的看法；可以删掉一条看法。',
  style: '她的说话框架；可以加一条、关掉一条。',
  starmap: '记忆星海的 3D 视图；只读，拖拽旋转、滚轮缩放。',
  memhealth: '记忆体检：查重复、过期、孤儿；只读，发现问题再去「记忆与情绪」处理。',
  diag: '排障用的日志、备份、服务状态；不改变任何业务设置。',
  plugins: '只读：装了哪些扩展、各挂几个钩子、迁到第几波；改开关去「功能开关」。',
};

const MOOD_CN = { calm: '平静', happy: '开心', curious: '好奇', focused: '专注', excited: '兴奋', proud: '得意' }; // MOOD_CN_6（TASK-W2 #2）

let TOKEN = localStorage.getItem('her.token') || '';
// 允许启动器用 #t=<口令> 直接带进来（本地 127.0.0.1 使用，读完即从地址栏抹掉）
(() => {
  const m = /(?:^|[#&])t=([^&]+)/.exec(location.hash || '');
  // 取 page 参数要在抹掉 URL 之前
  try { const _qp0 = new URLSearchParams(location.search).get('page'); if (_qp0) window.__dshPage = _qp0; } catch {}
  try { const _st0 = new URLSearchParams(location.search).get('starT'); if (_st0 != null && _st0 !== '') window.__dshStarT = Number(_st0); } catch {} // starT_EARLY
  if (m) { TOKEN = decodeURIComponent(m[1]); localStorage.setItem('her.token', TOKEN); history.replaceState(null, '', location.pathname); }
})();
let state = { names: { group: {}, private: {} }, namesLoaded: false, // NAMES_UI
  page: 'overview', overview: null, features: [], logs: [], logName: 'bridge', filterOnlyOff: false, q: '' };
// 允许 ?page=starmap 直接落到某页（调试 / 截图用；正常点击导航不受影响）
if (window.__dshPage) state.page = window.__dshPage;

// ---------- 基础 ----------
const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
function loopWhen(x) { // LOOP_TIME_FMT：欠事的时间原来是原始毫秒
  const raw = x.due || x.at || x.atMs || '';
  if (!raw) return '';
  const n = typeof raw === 'number' ? raw : (/^\d+$/.test(String(raw)) ? Number(raw) : NaN);
  if (!Number.isFinite(n)) return String(raw);
  const d = new Date(n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
async function api(path, { method = 'GET', body, okAny = false } = {}) {
  const url = method === 'GET' ? path + (path.includes('?') ? '&' : '?') + '_t=' + Date.now() : path; // CACHEBUST：刷新必须拿最新
  const r = await fetch(url, { method, cache: 'no-store', headers: { 'content-type': 'application/json', 'x-her-token': TOKEN }, body: body ? JSON.stringify(body) : null });
  if (r.status === 401) { showGate(); throw new Error('401'); }
  const j = await r.json().catch(() => ({ ok: false }));
  // okAny：/api/selfcheck 的 ok:false 是「自检有项不正常」，payload 本身有效，不该当请求失败丢掉
  if (!j.ok && !okAny) throw new Error(j.error || '请求失败');
  return j;
}
function showGate() { $('#tokenGate').classList.remove('hidden'); }
const fmtCny4 = (v) => (typeof v !== 'number' ? '—' : '¥' + v.toFixed(4)); // PREC4
const fmtCny = (v) => (typeof v !== 'number' ? '—' : (v >= 1 ? '¥' + v.toFixed(2) : '¥' + v.toFixed(4))); // PREC4：小于 1 元的都显示 4 位
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

// ---------- 页面 ----------
function qqStatusCard() {
  const mode = state.qqmode || 'open';
  const st = state.qqstats || {};
  const fr = state.friends || {};
  const MODES = [
    ['open', '全开', '群里按规则回（@ / 名字 / 关键词 / 概率）', '#5cb8ff'],
    ['owneronly', '只听主人', '群里只回你，别人说话一律不理', '#ffd479'],
    ['privateonly', '只跟我私聊', '群里完全不接话，只回你的私聊（调试用）', '#7ee0c8'],
    ['off', '关机', '什么都不回，也不烧 token', '#ff8a8a'],
  ];
  const setMode = async (m) => {
    const out = await api('/api/qqmode', { method: 'POST', body: { mode: m } });
    state.qqmode = out.mode;
    await loadOverview();
    loadNames().catch(() => {}); // 全局拉一次群名/昵称，其他页直接用
    rerender();
  };
  const groups = (st.groups || []).slice(0, 6);
  const senders = st.senders || [];
  const wakes = st.wakes || {};
  const pending = (fr.pending || []).slice(0, 6);
  const frlog = (fr.log || []).slice(-6);
  return h('div', { class: 'card', style: 'margin-bottom:12px' },
    h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap' },
      h('h3', { style: 'margin:0' }, 'QQ 状态'),
      h('span', { class: 'muted', style: 'font-size:12px' },
        '现在：' + (mode === 'open' ? '全开' : mode === 'owneronly' ? '只听主人' : mode === 'privateonly' ? '只跟我私聊' : '关机')),
    ),
    h('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' },
      ...MODES.map(([m, label, desc, color]) => h('button', {
        class: 'btn ' + (mode === m ? '' : 'ghost'),
        title: desc,
        style: 'padding:8px 16px;' + (mode === m ? `border-color:${color};color:${color}` : ''),
        onclick: () => setMode(m),
      }, label)),
    ),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' },
      MODES.find((x) => x[0] === mode)?.[2] || ''),

    h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px' },
      h('div', {},
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, '今天各群（收到 / 她发 / 唤醒）'),
        groups.length ? h('table', { class: 'tbl' },
          h('tbody', {}, ...groups.map((g) => h('tr', {},
            h('td', { style: 'font-size:12.5px' }, String(g.name || g.gid).slice(0, 14)),
            h('td', { class: 'muted', style: 'font-size:12px;text-align:right' }, `${g.recv} / ${g.send} / ${wakes['group:' + g.gid] || 0}`),
          )))) : h('div', { class: 'muted', style: 'font-size:12px' }, '今天还没有群消息'),
        h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' },
          `私聊：收到 ${(st.private || {}).recv || 0} · 她发 ${(st.private || {}).send || 0}`),
      ),
      h('div', {},
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, '今天谁说得最多'),
        senders.length ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
          ...senders.map((s) => h('span', { class: 'chip' }, `${s.name} ${s.n}`))) :
          h('div', { class: 'muted', style: 'font-size:12px' }, '还没有数据'),
        h('div', { class: 'muted', style: 'font-size:12px;margin:12px 0 6px' }, '好友申请'),
        pending.length ? h('div', {}, ...pending.map((p) => h('div', { style: 'font-size:12.5px;line-height:1.7' },
          `${p.userId || p.qq || '?'} ${p.nickname || ''}${p.msg ? '：' + String(p.msg).slice(0, 20) : ''}`))) :
          h('div', { class: 'muted', style: 'font-size:12px' }, '没有待处理'),
        frlog.length ? h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:6px;line-height:1.6' },
          ...frlog.map((l) => h('div', {}, String(l).slice(0, 60)))) : null,
      ),
    ),
  );
}

const SC_CACHE = 'her.selfcheck.last';
function scCached() {
  try { const j = JSON.parse(localStorage.getItem(SC_CACHE) || 'null'); return (j && j.items && j.items.length) ? j : null; } catch { return null; }
}
async function loadSelfcheck(force) {
  if (state.selfcheck && !force) return;
  try {
    const j = await api('/api/selfcheck', { okAny: true });
    state.selfcheck = j;
    state.selfcheckErr = '';
    if (j && j.items && j.items.length) { try { localStorage.setItem(SC_CACHE, JSON.stringify(j)); } catch {} }
  } catch (e) {
    const last = scCached();
    state.selfcheckErr = (e && e.message) || '读取失败';
    state.selfcheck = last || { ok: null, items: [], error: state.selfcheckErr };
  }
  rerender();
}

let mediaLoading = false;
async function loadMediaStats() {
  if (mediaLoading) return;
  mediaLoading = true;
  try {
    state.media = await api('/api/media-stats', { okAny: true });
    state.mediaErr = '';
  } catch (e) {
    state.mediaErr = (e && e.message) || '读取失败';
  } finally {
    mediaLoading = false;
    rerender();
  }
}

function mediaStatsCard() {
  const m = state.media;
  if (!m) { loadMediaStats(); return h('div', { class: 'card muted' }, '正在读媒体统计…'); }
  const withMedia = Number(m.withMedia || 0);
  const looked = Number(m.looked || 0);
  const failed = Number(m.failed || 0);
  const rate = withMedia ? Math.round((looked / withMedia) * 100) : 0;
  const reasons = Object.entries(m.reasons || {}).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const card = h('div', { class: 'card' },
    h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap' },
      h('h3', { style: 'margin:0' }, '媒体（今天）'),
      h('span', { class: 'muted', style: 'font-size:12px' }, (m.day || '—') + (state.mediaErr ? ' · 这次没读到' : '')),
    ),
    h('div', { class: 'chips', style: 'margin-top:10px' },
      h('span', { class: 'chip' }, '有图 ', h('b', {}, String(withMedia))),
      h('span', { class: 'chip' }, '看了 ', h('b', {}, String(looked)), h('span', { class: 'muted' }, ' (' + rate + '%)')),
      h('span', { class: 'chip' }, '失败 ', h('b', { style: failed ? 'color:var(--warn)' : '' }, String(failed))),
    ),
    h('div', { class: 'muted', style: 'margin-top:8px;font-size:12px' },
      failed ? '有失败：她看图时可能拿不到画面。' : '没有失败，看图链路正常。'),
  );
  if (failed > 0) {
    card.append(h('div', { style: 'margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(234,179,8,.12);color:var(--warn);font-size:12.5px;line-height:1.6' },
      '失败原因：' + (reasons.length ? reasons.map(([k, v]) => k + '×' + v).join('，') : '见日志 [media]'),
      h('span', { style: 'margin-left:8px' }, h('a', { href: '#diag', style: 'color:var(--warn);text-decoration:underline' }, '看最近错误'))),
    );
  }
  return card;
}

function selfcheckCard() {
  const sc = state.selfcheck;
  if (!sc) { loadSelfcheck(); return h('div', { class: 'card muted' }, '正在自检…'); }
  if (!sc.items || !sc.items.length) {
    return h('div', { class: 'card' },
      h('div', { class: 'muted' }, (state.selfcheckErr || sc.error || '还没跑过自检（每天会自动跑）')),
      h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn ghost', onclick: () => { state.selfcheck = null; loadSelfcheck(true); } }, '重新读一次')));
  }
  const stale = state.selfcheckErr ? ` · 这次没读到（${state.selfcheckErr}），下面是上次数据` : '';
  const bad = sc.items.filter((i) => !i.ok);
  const color = bad.length ? 'var(--bad)' : 'var(--ok)';
  const when = sc.at ? new Date(sc.at).toLocaleString('zh-CN', { hour12: false }) : '';
  return h('div', { class: 'card' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
      h('h3', { style: 'margin:0' }, '自检'),
      h('span', { style: `color:${color};font-size:12.5px` }, bad.length ? `⚠️ ${bad.length} 项异常` : '✅ 全部正常')),
    h('div', { class: 'muted', style: 'font-size:12px;margin:6px 0 10px' }, (when ? '上次自检 ' + when : '') + stale),
    h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 14px' },
      ...sc.items.map((i) => h('div', { style: 'font-size:12.5px;display:flex;gap:6px' },
        h('span', { style: `color:${i.ok ? 'var(--ok)' : 'var(--bad)'}` }, i.ok ? '●' : '✗'),
        h('span', {}, i.name),
        h('span', { class: 'muted', style: 'margin-left:auto;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, i.detail || '')))),
  );
}


// ---------- P2-B：Tab 容器 + 卡片级隐藏 ----------
function tabbed(key, defs) {
  const wrap = h('div', {});
  state._tab = state._tab || {};
  const cur = Math.min(state._tab[key] || 0, defs.length - 1);
  const bar = h('div', { class: 'tabs' });
  defs.forEach((d, i) => {
    bar.append(h('button', { class: 'tabs-btn' + (i === cur ? ' on' : ''), onclick: () => { state._tab[key] = i; rerender(); } }, d.title));
  });
  wrap.append(bar);
  try {
    wrap.append(defs[cur].render());
  } catch (e) {
    wrap.append(h('div', { class: 'card warn' }, '这块没加载出来：' + (e && e.message ? e.message : e)));
  }
  return wrap;
}
function findCardByTitle(root, needle) {
  const cards = [...root.querySelectorAll('.card')];
  return cards.find((c) => {
    const t = c.querySelector('h3, .card-h');
    return t && String(t.textContent || '').includes(needle);
  }) || null;
}
function hideCardsIn(root, needles) {
  for (const n of needles) {
    const c = findCardByTitle(root, n);
    if (c) c.style.display = 'none';
  }
  return root;
}

function pageOverview() {
  const d = state.overview || {};
  const hlt = d.health || {};
  const svc = Object.entries(hlt.services || {});
  const cost = d.cost || {};
  const ratio = cost.cap ? Math.min(1, (cost.today || 0) / cost.cap) : 0;
  const by = cost.by || {};
  const mood = Object.entries(d.mood || {}).filter(([k]) => MOOD_CN[k]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const wrap = h('div', {});
  wrap.append(qqStatusCard());
  wrap.append(h('div', { style: 'margin:12px 0' }, selfcheckCard()));
  wrap.append(h('div', { style: 'margin:12px 0' }, mediaStatsCard()));

  wrap.append(h('div', { class: 'grid g4' },
    h('div', { class: 'card' },
      h('h3', {}, '今日花费'),
      h('div', { class: 'big' }, fmtCny(cost.today), h('small', {}, '/ ¥' + (cost.cap ?? '—'))),
      h('div', { class: 'bar', style: 'margin:10px 0 8px' }, h('i', { style: `width:${(ratio * 100).toFixed(1)}%` })),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, 'QQ ', h('b', {}, fmtCny(by.qq?.cost))),
        h('span', { class: 'chip' }, 'B站 ', h('b', {}, fmtCny(by.bili?.cost))),
        h('span', { class: 'chip' }, '其它 ', h('b', {}, fmtCny(by.other?.cost))),
      ),
      h('div', { class: 'muted', style: 'margin-top:8px;font-size:12px' },
        `额度 ¥${cost.baseCap ?? '—'}${cost.extra ? ' + 加油 ¥' + cost.extra : ''} = ¥${cost.cap ?? '—'}，降级线 ¥${cost.line ?? '—'} · `) ,
      h('div', { style: `font-size:12px;color:${cost.downgraded ? 'var(--warn)' : 'var(--ok)'}` },
        cost.downgraded ? '● 已进入省钱模式（群里只认 @、主动搭话停）' : '○ 正常（谷时能多聊）'),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '运行'),
      h('div', { class: 'kv' }, h('span', {}, 'QQ / 模式'), h('span', {}, (() => {
        const M = { reserved2: '工作中', full: '全开', off: '关机', pet: '桌宠模式' };
        const raw = String(d.status?.mode || '?');
        return (M[raw] || raw) + (d.status?.paused ? ' · 已暂停' : '');
      })())),
      h('div', { class: 'kv' }, h('span', {}, '桥接'), h('span', {}, (hlt.bridgePid || []).join(',') || '没在跑')),
      h('div', { class: 'kv' }, h('span', {}, 'NapCat'), h('span', {}, hlt.napcat || '未运行')),
      h('div', { class: 'kv' }, h('span', {}, '白名单'), h('span', {}, `群 ${(d.status?.allowGroups || []).length} · 私聊 ${(d.status?.allowPrivate || []).length}`)),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '她现在的心情'),
      ...(mood.length ? mood.map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, MOOD_CN[k] || k), h('span', {}, String(Math.round(v))))) : [h('div', { class: 'muted' }, '没有数据')]),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '记着的东西'),
      h('div', { class: 'kv' }, h('span', {}, '欠着的事'), h('span', {}, (d.loops || []).length + ' 条')),
      h('div', { class: 'kv' }, h('span', {}, '学说法样本'), h('span', {}, (d.style?.total ?? 0) + ' 条')),
      h('div', { class: 'kv' }, h('span', {}, '服务'), h('span', {}, svc.filter(([, v]) => v === 'active').length + '/' + svc.length + ' active')),
    ),
  ));

  wrap.append(h('div', { class: 'grid g2', style: 'margin-top:14px' },
    h('div', { class: 'card' },
      h('h3', {}, '最近她说的'),
      ...(d.sends || []).length
        ? d.sends.slice(0, 6).map((l) => h('div', { class: 'kv', style: 'align-items:flex-start' },
            h('span', { class: 'mono', style: 'font-size:11.5px;flex:0 0 92px;color:#7f8b99' }, (l.match(/^\S+\s+\S+/) || [''])[0]),
            h('span', { style: 'flex:1' }, l.replace(/^\S+\s+\S+\s+/, '').slice(0, 160))))
        : [h('div', { class: 'muted' }, '日志里还没抓到发送记录')],
    ),
    h('div', { class: 'card' },
      h('h3', {}, '端口 & 服务'),
      ...Object.entries(hlt.ports || {}).map(([p, up]) => h('div', { class: 'kv' }, h('span', {}, '端口 ' + p), h('span', { style: up ? 'color:var(--ok)' : 'color:var(--bad)' }, up ? '在听' : '没听'))),
      ...svc.map(([n, v]) => h('div', { class: 'kv' }, h('span', {}, n), h('span', { style: v === 'active' ? 'color:var(--ok)' : 'color:var(--bad)' }, v))),
    ),
  ));
  // P2-B 2.2：概览只留四块（花费 / 她刚说的 / 待办与提醒 / 健康红绿灯）
  hideCardsIn(wrap, ['QQ 状态', '媒体', '运行', '她现在的心情', '端口', '记着的东西', '最近她说的']);
  const _sends = (d.sends || []).slice(0, 3);
  // A2：把原始发送日志解析成「群名 · 内容」
  const _sendRows = _sends.length
    ? _sends.map((l) => {
        const str = String(l);
        const tm = (str.match(/^(\d\d-\d\d)\s+(\d\d:\d\d)/) || []);
        const m = str.match(/发送 -> (群聊|私聊)\s+(?:\[(.*?)\((\d+)\)\]\s*(?:\[(.*?)\((\d+)\)\])?|\((\d+)\))\s*([\s\S]*)$/);
        let who = '', text = str;
        if (m) {
          const kind = m[1] === '群聊' ? 'group' : 'private';
          const id = m[3] || m[6] || '';
          const fallback = m[2] || '';
          const row = (state.names && state.names[kind] && state.names[kind][id]) || null;
          const nm = (row && (row.name || row)) || fallback || id;
          who = nm + ' · ';
          text = m[7] || '';
        } else {
          text = str.replace(/^.*?\[info\]\s*/, '').replace(/^\S+\s+\S+\s+/, '').trim();
        }
        const short = text.slice(0, 60) + (text.length > 60 ? '…' : '');
        return h('div', { class: 'kv', style: 'align-items:flex-start' },
          h('span', { class: 'mono', style: 'font-size:11.5px;flex:0 0 64px;color:#7f8b99' }, (tm[1] || '') + ' ' + (tm[2] || '')),
          h('span', { style: 'flex:1' }, who + short));
      })
    : [h('div', { class: 'muted' }, '日志里还没抓到发送记录')];
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('h3', {}, '她刚说的'),
    ..._sendRows));
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('h3', {}, '待办与提醒'),
    h('div', { class: 'kv' }, h('span', {}, '她记着要做的事'), h('span', {}, ((d.loops || []).length) + ' 条')),
    h('div', { class: 'kv' }, h('span', {}, '定时提醒'), h('span', {}, ((d.reminders || []).length) + ' 条'))));
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px' },
    h('a', { href: '#health', style: 'color:var(--accent)' }, '健康红绿灯 →'),
    h('a', { href: '#cost', style: 'color:var(--accent)' }, '花费明细 →'),
    h('a', { href: '#group-rules', style: 'color:var(--accent)' }, '群规则 →'),
    h('a', { href: '#talk', style: 'color:var(--accent)' }, '说话 →'),
    h('a', { href: '#settings', style: 'color:var(--accent)' }, '设置 →')));
  return wrap;
}

function pageCommands() {
  const wrap = h('div', {});
  if (!state.cmds) {
    loadCmds().catch(() => {}).finally(rerender);
    wrap.append(h('div', { class: 'card' }, [h('div', { class: 'muted' }, '正在读命令表…')]));
    return wrap;
  }
  const groups = {};
  for (const it of state.cmds) (groups[it.g] = groups[it.g] || []).push(it);
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'card-title' }, '命令大全'),
    h('div', { class: 'muted', style: 'margin-bottom:10px' },
      '复制命令发给她（要带斜杠）。自然语言两条只在私聊、且是主人的时候生效。'),
  ]));
  for (const [g, arr] of Object.entries(groups)) {
    wrap.append(h('div', { class: 'card' }, [
      h('div', { class: 'card-title' }, g),
      h('table', { class: 'tbl-fit nowrap-tbl' }, [
        h('thead', {}, h('tr', {}, h('th', {}, '命令'), h('th', {}, '说明'))),
        h('tbody', {}, ...arr.map((it) => h('tr', {}, h('td', { style: 'font-family:monospace' }, it.cmd), h('td', {}, it.desc)))),
      ]),
    ]));
  }
  return wrap;
}

function loadCmds() {
  return api('/api/commands').then((d) => { state.cmds = (d && d.items) || []; });
}

function pageFeatures() {
  const wrap = h('div', {});
  const bar = h('div', { class: 'toolbar' },
    h('input', { type: 'text', id: 'feat-q', placeholder: '搜索功能名…', value: state.q, oninput: (e) => { state.q = e.target.value; rerenderKeepFocus(); } }),
    h('label', { class: 'muted', style: 'display:flex;gap:6px;align-items:center' },
      h('input', { type: 'checkbox', checked: state.filterOnlyOff ? 'checked' : null, onchange: (e) => { state.filterOnlyOff = e.target.checked; rerender(); } }), '只看关着的'),
    h('span', { class: 'muted', style: 'margin-left:auto' }, '改动会写配置并自动备份'),
  );
  wrap.append(bar);
  wrap.append(h('div', { class: 'muted', style: 'font-size:12.5px;margin:2px 0 10px;line-height:1.8' },
    '绿色「立即」= 拨完马上生效；橙色「需重启」= 要先重启对应服务（桥接：本页下方「设置」页底部有「重启桥接」；面板自己：systemctl restart her-console）。'));
  if (!state.plugins) loadPlugins();
  const _mods = state.plugins || [];
  wrap.append(h('div', { class: 'card' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' },
      h('h3', { style: 'margin:0' }, '插件清单'),
      h('span', { class: 'muted', style: 'font-size:12px' }, _mods.length ? `${_mods.length} 个模块 · 来自 /api/plugins` : '正在读…')),
    h('div', { class: 'muted', style: 'font-size:12px;margin:6px 0 8px' }, '开关管「开不开」，这里看「装了哪些模块、各挂几个钩子、迁到第几波」。新增扩展会自动出现在下表。'),
    ...(_mods.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((m) => h('div', { class: 'kv' },
      h('span', {}, m.title || m.id),
      h('span', { class: 'muted', style: 'font-size:12px' }, `W${m.wave || '?'} · ${m.migrated ? '已迁移' : '未迁移'} · ${(m.hooks || []).length} 钩子 · ${(m.routes || []).length} 路由`)))),
    h('div', { style: 'margin-top:8px' }, h('a', { href: '#plugins', class: 'muted', style: 'font-size:12px' }, '看完整清单 →'))));

  const groups = {};
  for (const f of state.features) {
    if (state.q && !(f.name + f.id + (f.hint || '')).toLowerCase().includes(state.q.toLowerCase())) continue;
    if (state.filterOnlyOff && f.kind !== 'bool') continue;
    if (state.filterOnlyOff && f.value !== false) continue;
    (groups[f.group] = groups[f.group] || []).push(f);
  }
  if (!Object.keys(groups).length) wrap.append(h('div', { class: 'card muted' }, '没有匹配的功能'));
  for (const [g, items] of Object.entries(groups)) {
    const table = h('table', { class: 'tbl-fit nowrap-tbl' },
      h('thead', {}, h('tr', {}, h('th', { style: 'width:38%' }, g), h('th', { style: 'width:110px' }, '状态'), h('th', { style: 'width:92px' }, '生效'), h('th', {}, '说明'))),
      h('tbody', {}, ...items.map((f) => h('tr', {},
        h('td', {}, f.name, f.path ? h('div', { class: 'mono muted', style: 'font-size:11px' }, f.path) : null),
        h('td', {}, f.kind === 'bool'
          ? h('label', { class: 'sw' }, h('input', { type: 'checkbox', checked: f.value !== false ? 'checked' : null, onchange: (e) => toggleFeature(f, e.target.checked) }), h('i'))
          : h('span', { class: 'muted' }, f.value == null ? '—' : String(f.value))),
        h('td', {}, h('span', { class: 'tag ' + (f.effect === 'hot' ? 'hot' : 'bridge') }, f.effect === 'hot' ? '立即' : (f.effect === 'dsh' ? '重启面板' : '需重启'))),
        h('td', { class: 'muted', style: 'font-size:12px' }, f.hint || ''),
      ))),
    );
    wrap.append(h('div', { class: 'card', style: 'margin-bottom:14px' }, table));
  }
  return wrap;
}

// HEALTH_CARD：通道健康卡
function healthDot(ok) {
  return h('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:' + (ok ? 'var(--ok)' : '#ff6b6b') });
}
function healthCard() {
  if (!state.health) {
    if (!state.healthLoading) {
      state.healthLoading = true;
      fetch('/api/health', { headers: { 'x-her-token': TOKEN } })
        .then((r) => r.json())
        .then((j) => { state.health = j; })
        .catch(() => { state.health = { error: '面板连不上 /api/health' }; })
        .finally(() => { state.healthLoading = false; rerender(); });
    }
    return h('div', { class: 'card' }, h('h3', {}, '通道健康'), h('div', { class: 'muted', style: 'font-size:12.5px' }, '正在检测…'));
  }
  const d = state.health;
  if (d.error) return h('div', { class: 'card' }, h('h3', {}, '通道健康'), h('div', { class: 'muted' }, d.error));
  const u = d.units || {};
  const alive = (c) => c !== '000' && c !== '' && String(c)[0] !== '5';
  const row = (ok, name, val) => h('tr', {},
    h('td', {}, healthDot(ok), name),
    h('td', { class: 'mono', style: 'font-size:12px' }, val));
  const chip = (name, st) => h('span', { class: 'tag ' + (st === 'active' || st === 'running' ? 'ok' : 'warn'), style: 'margin-right:6px' }, name + ' ' + st);
  return h('div', { class: 'card' },
    h('h3', {}, '通道健康', h('span', { class: 'muted', style: 'font-size:11.5px;font-weight:400;margin-left:8px' }, d.at ? new Date(d.at).toLocaleTimeString() : '')),
    h('table', { class: 'tbl-fit nowrap-tbl' }, h('tbody', {},
      row(alive(d.dsh), '云端 DSH（3080）', d.dsh === '401' ? '401 正常（要口令）' : String(d.dsh)),
      row(alive(d.bridge), '桥接控制台（3100）', d.bridge === '401' ? '401 正常（要口令）' : String(d.bridge)),
      row(!!d.onebot, 'OneBot 连接（3001）', d.onebot ? '已连接' : '未连接（QQ 可能掉线）'),
      row(u.wdTimer === 'active', '看门狗定时器', (u.wdTimer || '?') + (d.wdTrigger ? ' · 最近一次巡检 ' + String(d.wdTrigger).replace(/\s+/, ' ').slice(0, 19) : '')),
    )),
    h('div', { style: 'margin-top:10px;font-size:12px;line-height:1.9' },
      chip('DSH', u.web), chip('桥接', u.bridge), chip('面板', u.panel), chip('ASR', u.asr), chip('SnowLuma', u.snowluma), chip('NapCat', u.napcat)),
    h('div', { class: 'muted mono', style: 'margin-top:8px;font-size:11px;white-space:pre-wrap' }, '看门狗最近一条：' + (d.wdLast || '（无日志）')),
    h('button', {
      class: 'btn', style: 'margin-top:8px;padding:6px 14px',
      onclick: () => { state.health = null; rerender(); },
    }, '重新检测'),
  );
}


function pageCost() {
  const c = state.cost;
  const wrap = h('div', {});
  // P2-B 1.2：省钱模式从安全页挪到这里（克隆安全页的卡，去掉隐藏标记）
  try {
    const _safe = pageSafe();
    const _eco = findCardByTitle(_safe, '省钱模式（少说话）');
    if (_eco) { _eco.style.display = ''; _eco.style.marginBottom = '14px'; wrap.append(_eco); }
  } catch (e) {}
  if (!c) {
    wrap.append(h('div', { class: 'card muted' }, '正在算账…'));
    if (!state.costLoading) { state.costLoading = true; loadCost().finally(() => { state.costLoading = false; rerender(); }); }
    return wrap;
  }
  const pct = (v) => ((v || 0) * 100).toFixed(1) + '%';
  // 用到当天上限 80% 就在最上面横一条红条，别等超了才发现
  const capNow = c.limitCny ? (c.daily?.total?.cost || 0) / c.limitCny : 0;
  if (capNow >= 0.8) {
    wrap.append(h('div', {
      class: 'card',
      style: 'border:1px solid #ff6b6b;background:rgba(255,80,80,.08);color:#ffb3b3;margin-bottom:8px',
    }, `⚠ 今天已经花了 ${fmtCny(c.daily?.total?.cost)}，用了上限（${fmtCny(c.limitCny)}）的 ${(capNow * 100).toFixed(0)}%。`
      + '要收着点就跟她说一句「今天省着点」，或者去设置里把每日额度调低；真要放宽就调高（改完点「重启桥接」）。'));
  }
  const card = (title, ...kids) => h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', {}, title), ...kids);

  // ① 三个窗口 + 缓存
  wrap.append(h('div', { class: 'grid g4' },
    ...['today', 'week', 'month'].map((k) => {
      const label = k === 'today' ? '近 24 小时' : k === 'week' ? '近 7 天' : '近 30 天';
      const v = c[k] || {};
      return h('div', { class: 'card' },
        h('h3', {}, label),
        h('div', { class: 'big' }, fmtCny(v.cost)),
        h('small', {}, (v.tokens || 0).toLocaleString() + ' tok · ' + (v.turns || 0) + ' 轮 · ' + (v.steps || 0) + ' 步'),
      );
    }),
    h('div', { class: 'card' },
      h('h3', {}, '昨天'),
      h('div', { class: 'big' }, fmtCny(c.yesterday?.cost)),
      h('small', {}, (c.yesterday?.tokens || 0).toLocaleString() + ' tok · ' + (c.yesterday?.turns || 0) + ' 轮'),
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:4px' }, (() => {
        const y = c.yesterday?.cost || 0;
        const t = c.today?.cost || 0;
        if (!y) return '昨天没有记录';
        const d = (t - y) / y * 100;
        return (d >= 0 ? '今天比昨天 +' : '今天比昨天 ') + d.toFixed(0) + '%';
      })()),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '缓存命中'),
      h('div', { class: 'big' }, pct(c.today?.cacheRate)),
      h('small', {}, `命中 ${(c.today?.cacheHit || 0).toLocaleString()} / 新增 ${(c.today?.cacheMiss || 0).toLocaleString()}`)),
  ));

  // ② 今天构成
  const d = c.daily || {};
  const total = d.total?.cost || 0;
  const row = (name, cost, tok, cap) => {
    const p = total > 0 ? (cost / total) * 100 : 0;
    return h('div', { style: 'margin:8px 0' },
      h('div', { class: 'kv', style: 'padding:0 0 4px' },
        h('span', {}, name + (cap ? `（上限 ${fmtCny(cap)}）` : '')),
        h('span', {}, `${fmtCny(cost)} · ${(tok || 0).toLocaleString()} tok`)),
      h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(1, p).toFixed(1)}%` })));
  };
  const todayTotal = c.daily?.total || {};
  // 按当前速度外推今天，再跟近 7 天日均比——直接拿「半天花的钱」比「整天均值」会误报
  const hoursNow = (() => { const d = new Date(); return Math.max(1, d.getHours() + d.getMinutes() / 60); })();
  const todayCost = c.daily?.total?.cost || 0; // 只算今天 00:00 起，不能用 24 小时滚动值
  const pace = (todayCost / hoursNow) * 24;
  const spike = (c.avg7 || 0) > 0 && pace > (c.avg7 || 0) * 2;
  wrap.append(card('今天的钱花在哪',
    spike ? h('div', { class: 'muted', style: 'font-size:12px;color:#ffd479;margin-bottom:6px' },
      `⚠ 按现在这个速度，今天大约 ${fmtCny(pace)}，是近 7 天日均（${fmtCny(c.avg7)}）的 ${(pace / (c.avg7 || 1)).toFixed(1)} 倍`) : null,
    h('div', { class: 'kv', style: 'padding:0 0 8px' },
      h('span', { class: 'muted' }, '今天 00:00 起'),
      h('span', {}, `${fmtCny(todayTotal.cost)} · ${(todayTotal.tokens || 0).toLocaleString()} tok`)),
    row('QQ', d.qq?.cost, d.qq?.tokens, c.limits?.qq?.cny),
    row('B站', d.bili?.cost, d.bili?.tokens),
    row('其它（后台学习等）', d.other?.cost, d.other?.tokens),
  ));

  // ③ 24 小时 + 7 天
  const bars = (buckets, fmt) => {
    const mx = Math.max(...buckets.map((b) => b.cost || 0), 0.0001);
    const total = buckets.reduce((a, b) => a + (b.cost || 0), 0);
    const avg = total / Math.max(1, buckets.length);
    const pick = state.barPick; // BAR_PICK：手机点柱子看数值
    return h('div', { class: 'spark-wrap' },
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' },
        pick ? `${pick.label} · ${fmtCny(pick.cost)} · ${pick.tok} tok` : '点一下柱子看那一格的数值（手机也能点）'),
      h('div', { class: 'spark' }, ...buckets.map((b) => h('div', {
        class: 'spark-bar' + (b.tier === 'peak' ? ' peak' : ''),
        title: fmt(b.t) + ` ¥${(b.cost || 0).toFixed(4)} · ${(b.tokens || 0).toLocaleString()} tok`,
        style: `height:${Math.max(6, ((b.cost || 0) / mx) * 100)}%`,
        onclick: () => {
          const lab = fmt(b.t);
          state.barPick = (pick && pick.label === lab) ? null
            : { label: lab, cost: b.cost || 0, tok: (b.tokens || 0).toLocaleString() };
          rerender();
        },
      }))),
      h('div', { class: 'spark-avg', style: `bottom:${Math.min(96, (avg / mx) * 100)}%` },
        h('b', {}, '平均 ' + fmtCny(avg))),
    );
  };
  wrap.append(card('最近 24 小时（每格 1 小时，红=高峰时段）',
    bars(c.series?.h24 || [], (t) => new Date(t).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }))));
  wrap.append(card('最近 30 天（每天）',
    bars(c.series?.d30 || [], (t) => new Date(t).toLocaleDateString('zh-CN'))));

  // DIAG_UI：诊断卡（数据来自 /api/diagnose，纯聚合不调用模型）
  if (!state.diag && !state.diagLoading) {
    state.diagLoading = true;
    fetch('/api/diagnose', { headers: { 'x-her-token': TOKEN } })
      .then((r) => r.json()).then((j) => { state.diag = j && j.ok ? j : null; })
      .catch(() => { state.diag = null; })
      .finally(() => { state.diagLoading = false; rerender(); });
  }
  const dg = state.diag;
  if (dg) {
    const sp = dg.split || {};
    const item = (label, val, sub) => h('div', { style: 'flex:1 1 180px;min-width:180px' },
      h('div', { class: 'muted', style: 'font-size:12px' }, label),
      h('div', { style: 'font-size:19px;margin-top:2px' }, val),
      sub ? h('div', { class: 'muted', style: 'font-size:11.5px' }, sub) : null);
    wrap.append(h('div', { class: 'card', style: 'margin-top:12px' },
      h('h3', {}, '诊断（最近 200 步）'),
      h('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px' },
        item('缓存命中率', sp.hitRate + '%', '越高越省，97% 以上算好'),
        item('未命中花了', fmtCny(sp.missCost), '占这段花费 ' + sp.missShare + '%'),
        item('命中率提到 99%', '每天约省 ' + fmtCny(dg.saveIfHit99), '按每天 ' + fmtCny(dg.day && dg.day.cost) + ' 折算'),
        item('每轮均价', fmtCny(dg.day && dg.day.perTurn), '近 24 小时 ' + ((dg.day && dg.day.turns) || 0) + ' 轮'),
      ),
      h('div', { class: 'muted', style: 'font-size:12px;margin:6px 0 4px' }, '最贵的几步（几乎都是缓存整个失效的那一步）'),
      (() => {
        const rows = (dg.top || []).map((r) => h('tr', {},
          h('td', {}, fmtCny(r.cost)),
          h('td', { class: 'mono', style: 'font-size:11.5px' }, r.key),
          h('td', {}, (r.miss || 0).toLocaleString()),
          h('td', {}, (r.hit || 0).toLocaleString()),
          h('td', { class: 'muted' }, r.turn + '/' + r.step)));
        return h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '花费'), h('th', {}, '会话'), h('th', {}, '新内容'), h('th', {}, '命中'), h('th', {}, '轮/步'))),
          h('tbody', {}, ...rows));
      })(),
      h('div', { class: 'muted', style: 'font-size:12px;margin:8px 0 4px' }, '按会话'),
      (() => {
        const lines = (dg.byKey || []).map((k) => h('div', {},
          k.key + ' — ' + k.steps + ' 步 / ' + fmtCny(k.cost) + ' / 新内容 ' + (k.miss || 0).toLocaleString()));
        return h('div', { class: 'muted', style: 'font-size:12px;line-height:1.8' }, ...lines);
      })(),
    ));
  }
  // ③ 预估每天（吃透所有功能后的估算，不是承诺）
  const es = c.estimate || null;
  if (es) {
    wrap.append(card('每天大概花多少（估算）',
      h('div', { class: 'kv', style: 'padding:0 0 6px' },
        h('span', { class: 'muted' }, '实测：近 7 天有记录的'),
        h('b', {}, `${fmtCny(es.low)} ~ ${fmtCny(es.high)}`),
      ),
      h('div', { class: 'kv', style: 'padding:0 0 10px' },
        h('span', { class: 'muted' }, '按全部功能估算，普通一天大约'),
        h('b', { style: 'color:#7cc7ff' }, fmtCny(es.total)),
      ),
      h('table', { class: 'tbl' },
        h('thead', {}, h('tr', {}, h('th', {}, '项目'), h('th', {}, '按什么算'), h('th', { class: 'num' }, '每天约'))),
        h('tbody', {}, ...(es.items || []).map((it) => h('tr', {},
          h('td', {}, it.name),
          h('td', { class: 'muted', style: 'font-size:11.5px' }, it.note),
          h('td', { class: 'num' }, fmtCny(it.cny)),
        ))),
      ),
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:8px;line-height:1.6' },
        `每轮平均 ${fmtCny(es.perTurn)}（近 7 天 ${es.turns7} 轮均值）。`
        + `上限现在显示为 ${c.limitCny ? fmtCny(c.limitCny) : '不限'}，它读的是配置里的 socialV2.tokenGuard.maxDailyCostCNY：`
        + '在面板/QQ 设置里改会立刻生效并跟着变；手动改 config.json 要重启桥接才生效。'
        + '要临时放宽，直接说「今天放宽到 20」让她改，或者你去设置里改——改完这行数字会变。'),
    ));
  }

  // ③.5 长周期（来自每日快照，不受账本淘汰影响）
  if ((c.history || []).length >= 2) {
    const hist = c.history; // COST_H_SHADOW_FIX：这里原来叫 h，把全局的 h() 建元素函数遮蔽了，整页报「h is not a function」
    const mx = Math.max(...hist.map((x) => x.total?.cost || 0), 0.0001);
    wrap.append(card(`长周期（每天合计，已记录 ${hist.length} 天）`,
      h('div', { class: 'spark' }, ...hist.map((x) => h('div', {
        class: 'spark-bar',
        title: `${x.day} ¥${(x.total?.cost || 0).toFixed(3)} · ${(x.total?.tokens || 0).toLocaleString()} tok`,
        style: `height:${Math.max(6, ((x.total?.cost || 0) / mx) * 100)}%`,
      }))),
    ));
  }

  // ④ 明细（GROUP_BY_TURN：按「一次回复」聚合，点开看每一步）
  const stepList = (c.recent || []).slice(0, 200);
  const gmap = new Map();
  const glist = [];
  stepList.forEach((e) => {
    const key = String(e.key || e.sid || '?');
    const gid = key + '#' + String(e.turn ?? '');
    let g = gmap.get(gid);
    if (!g) {
      g = { key: key, turn: e.turn, t: Number(e.time || e.t || e.at || 0), steps: [], cost: 0, tokens: 0, miss: 0 };
      gmap.set(gid, g);
      glist.push(g);
    }
    g.steps.push(e);
    g.cost += Number(e.cost || 0);
    g.tokens += Number(e.tokens || e.total || 0);
    g.miss += Number(e.cacheMiss || 0);
    const tt = Number(e.time || e.t || e.at || 0);
    if (tt && (!g.t || tt < g.t)) g.t = tt;
  });
  const gshown = glist.slice(0, 12);
  const sessName = (k) => String(k || '?').replace('private:', '私聊 ').replace('group:', '群 ');
  const fmtHM = (t) => new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  const mkDetail = (g) => {
    const body = h('tbody', {});
    g.steps.forEach((s) => {
      body.append(h('tr', {},
        h('td', { class: 'muted' }, String(s.step ?? '-')),
        h('td', { class: 'num muted' }, Number(s.tokens || s.total || 0).toLocaleString()),
        h('td', { class: 'num muted' }, Number(s.cacheHit || 0).toLocaleString()),
        h('td', { class: 'num muted' }, Number(s.cacheMiss || 0).toLocaleString()),
        h('td', { class: 'num muted' }, Number(s.output || 0).toLocaleString()),
        h('td', { class: 'num' }, fmtCny(s.cost)),
      ));
    });
    const inner = h('table', { class: 'tbl', style: 'margin:2px 0 8px' });
    inner.append(h('thead', {}, h('tr', {},
      h('th', {}, '步'), h('th', { class: 'num' }, '上下文'), h('th', { class: 'num' }, '命中'),
      h('th', { class: 'num' }, '未命中'), h('th', { class: 'num' }, '输出'), h('th', { class: 'num' }, '花费'))));
    inner.append(body);
    const td = h('td', { colspan: 6, style: 'padding:0 0 0 18px' });
    td.append(inner);
    return h('tr', { style: 'display:none' }, td);
  };

  const csvBtn = h('button', {
    class: 'btn ghost', style: 'padding:5px 12px;font-size:12px',
    onclick: async () => {
      try {
        const r = await fetch('/api/cost.csv', { headers: { 'x-her-token': TOKEN } });
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'cost-' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('导出好了');
      } catch (e) { toast('导出失败：' + e.message); }
    },
  }, '导出 CSV（每步原始数据）');

  const gtbody = h('tbody', {});
  gshown.forEach((g) => {
    const detail = mkDetail(g);
    const row = h('tr', { style: 'cursor:pointer' },
      h('td', { class: 'muted', style: 'font-size:12px' }, fmtHM(g.t)),
      h('td', { style: 'font-size:12.5px' }, sessName(g.key)),
      h('td', { class: 'muted', style: 'font-size:12px' }, String(g.turn ?? '-')),
      h('td', { class: 'num muted' }, g.steps.length + ' 步 ▾'),
      h('td', { class: 'num muted' }, g.miss.toLocaleString()),
      h('td', { class: 'num', style: g.cost > 0.3 ? 'color:#ff8a8a;font-weight:600' : '' }, fmtCny(g.cost)),
    );
    row.onclick = () => { detail.style.display = detail.style.display === 'none' ? '' : 'none'; };
    gtbody.append(row);
    gtbody.append(detail);
  });

  const gtable = h('table', { class: 'tbl' });
  gtable.append(h('thead', {}, h('tr', {},
    h('th', {}, '时间'), h('th', {}, '会话'), h('th', {}, '轮'),
    h('th', { class: 'num' }, '步数'), h('th', { class: 'num' }, '新内容 token'), h('th', { class: 'num' }, '这次回复合计'))));
  gtable.append(gtbody);

  wrap.append(card('最近的花费明细（一次回复 = 说一次话，点开看每一步）',
    h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-bottom:6px' }, csvBtn),
    gshown.length ? gtable : h('div', { class: 'muted' }, '还没有明细'),
  ));

  // ⑤ 进程
  wrap.append(card('进程资源（平均 CPU / 常驻内存）',
    h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, '服务'), h('th', { class: 'num' }, 'PID'), h('th', { class: 'num' }, 'CPU'), h('th', { class: 'num' }, '内存'), h('th', {}, '运行'))),
      h('tbody', {}, ...(c.procs || []).map((p) => h('tr', {},
        h('td', {}, p.name),
        h('td', { class: 'num muted' }, p.pid ? String(p.pid) : '—'),
        h('td', { class: 'num' }, (p.cpu || 0).toFixed(1) + '%'),
        h('td', { class: 'num' }, typeof p.rssMB === 'number' ? p.rssMB + ' MB' : String(p.rssMB || '—')),
        h('td', { class: 'muted', style: 'font-size:12px' }, String(p.uptime || '')),
      )))),
  ));

  // ⑥ 存储
  const st = c.store || {};
  wrap.append(card('存的东西',
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px' },
      ...(st.counts ? Object.entries(st.counts).map(([k, v]) => h('span', { class: 'chip' },
        ({ memories: '记忆', stickers: '表情', styleSamples: '学样', impressions: '看法', loops: '欠事', people: '人物' }[k] || k) + ' ' + v)) : [])),
    h('table', { class: 'tbl' },
      h('tbody', {},
        ...(st.dirs || []).map((x) => h('tr', {}, h('td', {}, x.name), h('td', { class: 'num' }, (x.bytes / 1048576).toFixed(1) + ' MB'))),
        ...(st.logs || []).filter((x) => x.bytes > 0).map((x) => h('tr', {}, h('td', { class: 'muted' }, '日志 ' + x.name), h('td', { class: 'num muted' }, (x.bytes / 1048576).toFixed(2) + ' MB'))),
      )),
  ));
  return wrap;
}

function pageImpr() {
  const wrap = h('div', {});
  const data = state.impr;
  const reload = async () => { state.impr = await api('/api/impr'); rerender(); };
  if (!data) {
    wrap.append(h('div', { class: 'card muted' }, '正在取她的看法…'));
    if (!state.imprLoading) { state.imprLoading = true; api('/api/impr').then((d) => { state.impr = d; }).catch(() => {}).finally(() => { state.imprLoading = false; rerender(); }); }
    return wrap;
  }
  const items = (data.items || []).slice().sort((a, b) => (b.at || 0) - (a.at || 0));
  const add = async () => {
    const el = $('#imprText');
    const text = (el?.value || '').trim();
    if (!text) { toast('先写一句'); return; }
    try { await api('/api/impr', { method: 'POST', body: { action: 'add', text } }); el.value = ''; toast('记下了'); await reload(); }
    catch (e) { toast('没记上：' + e.message); }
  };
  const del = async (id) => {
    try { await api('/api/impr', { method: 'POST', body: { action: 'forget', id } }); toast('删掉了'); await reload(); }
    catch (e) { toast('删不掉：' + e.message); }
  };
  wrap.append(h('div', { class: 'card' },
    h('h3', {}, `她眼里的你（${items.length} / ${data.max || 50}）`),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' },
      '这些是「看法」不是「设定」：她可以说、可以改，也可以跟记忆卡对不上。写得太满她会开始念评价表，留一半给她自己长。'),
    h('div', { style: 'display:flex;gap:8px' },
      h('input', { id: 'imprText', placeholder: '一句话，30 字以内，比如：他嘴上说没事的时候多半在硬撑', style: 'flex:1;padding:9px 11px;border-radius:9px;border:1px solid var(--line);background:#0d1219;color:#e8f1ff' }),
      h('button', { class: 'btn', onclick: add }, '加一条')),
  ));
  wrap.append(h('div', { class: 'card', style: 'margin-top:12px' },
    items.length ? h('table', { class: 'tbl' },
      h('tbody', {}, ...items.map((it) => h('tr', {},
        h('td', {}, it.text),
        h('td', { class: 'muted', style: 'font-size:12px;width:90px' }, it.about === 'he' ? '他' : it.about === 'me' ? '我自己' : '外面的事'),
        h('td', { class: 'muted', style: 'font-size:12px;width:70px' }, it.confidence === 'sure' ? '确定' : '觉得'),
        h('td', { class: 'muted', style: 'font-size:12px;width:110px' }, new Date(it.at || 0).toLocaleDateString('zh-CN')),
        h('td', { style: 'width:60px' }, h('button', { class: 'btn ghost', style: 'padding:4px 10px', onclick: () => del(it.id) }, '删')),
      )))) : h('div', { class: 'muted' }, '还没有——她会在相处里慢慢攒，你也可以在这里加。'),
  ));
  return wrap;
}


function pageStyle() { // STYLE_GATE_PATCH
  const wrap = h('div', {});
  const data = state.style;
  const reload = async () => { state.style = await api('/api/style'); rerender(); };
  if (!data) {
    wrap.append(h('div', { class: 'card muted' }, '正在取学说话样本…'));
    if (!state.styleLoading) { state.styleLoading = true; api('/api/style').then((d) => { state.style = d; }).catch(() => {}).finally(() => { state.styleLoading = false; rerender(); }); }
    return wrap;
  }
  const c = data.counts || {};
  async function styleShort(id) {
    try {
      const rr = await api('/api/style-short', { method: 'POST', body: { id } });
      if (rr && rr.ok) { toast('短句：' + rr.short); await reload(); }
      else toast('拆短句失败：' + ((rr && rr.error) || '未知'));
    } catch (e) { toast('拆短句失败：' + e.message); }
  }

  const setStatus = async (id, status) => {
    try { await api('/api/style', { method: 'POST', body: { action: 'set', id, status } }); toast(status === 'active' ? '收下了' : status === 'retired' ? '扔掉了' : '放回候选'); await reload(); }
    catch (e) { toast('没改成：' + e.message); }
  };
  const row = (s, kind) => h('tr', {},
    h('td', {}, (s.short ? '「' + String(s.short).slice(0, 30) + '」 ' : '') + String(s.text || '').slice(0, 70)),
    h('td', { class: 'muted', style: 'font-size:12px;width:70px' }, s.kind === 'framework' ? '框架' : s.kind === 'quote' ? '话术/梗' : '噪声'),
    h('td', { class: 'muted', style: 'font-size:12px;width:110px' }, s.why ? String(s.why).slice(0, 20) : '—'),
    h('td', { class: 'muted', style: 'font-size:12px;width:80px' }, String(Object.keys(s.hits || {}).length) + ' 人复用'),
    h('td', { style: 'width:150px;white-space:nowrap' },
      kind !== 'candidate' ? h('button', { class: 'btn ghost', style: 'padding:4px 9px;margin-right:4px', onclick: () => setStatus(s.id, 'candidate') }, '候选') : null,
      kind !== 'active' ? h('button', { class: 'btn ghost', style: 'padding:4px 9px;margin-right:4px', onclick: () => setStatus(s.id, 'active') }, '收下') : null,
      kind !== 'retired' ? h('button', { class: 'btn ghost', style: 'padding:4px 9px;margin-right:4px', onclick: () => setStatus(s.id, 'retired') }, '扔掉') : null,
      h('button', { class: 'btn ghost', style: 'padding:4px 9px', onclick: () => styleShort(s.id) }, '拆短句'),
    ));

  wrap.append(h('div', { class: 'card' },
    h('h3', {}, `学说话（正式 ${c.active || 0} · 候选 ${c.candidate || 0} · 已丢 ${c.retired || 0}）`),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' },
      '她学来的说法先放「候选」，不进提示词。只有同一句式在群里被 ≥2 个不同的人用过，才自动转「正式」；14 天没人用就自动丢掉。你在这里点一下可以直接改判——这层只是添头，平时不用管。'),
    h('div', { class: 'muted', style: 'font-size:12px' }, '判定规则：长度 8~80 字 · 不含梗/口头禅 · 不含链接/@/表情 · 不是整段复述。'),
  ));

  const scfg = (data.cfg || {});
  const saveStyleCfg = async () => {
    const qq = ($('#stl-qq')?.value || '').trim();
    const gs = ($('#stl-groups')?.value || '').split(/[,，\s]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean);
    try {
      await api('/api/style', { method: 'POST', body: { action: 'setcfg', targetQQ: qq, groups: gs, exemptEconomy: !!($('#stl-exempt')?.checked) } });
      toast('已写入配置，点「重启桥接」才生效');
      state.style = await api('/api/style');
      rerender();
    } catch (e) { toast('没存上：' + e.message, 3800); }
  };
  wrap.append(h('div', { class: 'card', style: 'margin-top:12px' },
    h('h3', {}, '学谁 · 在哪学'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' },
      '只学这一个人说话（按 QQ 号认人，最准）；群号可以写多个，用逗号隔开。'
      + '改完要点「重启桥接」才生效——顶栏「待生效」会亮。'),
    h('div', { class: 'toolbar', style: 'flex-wrap:wrap;gap:10px;align-items:center' },
      h('span', { class: 'muted', style: 'font-size:12px' }, '只学谁（QQ 号）'),
      h('input', { type: 'text', id: 'stl-qq', value: scfg.targetQQ || '', style: 'width:150px' }),
      h('span', { class: 'muted', style: 'font-size:12px' }, '在哪学（群号，逗号分隔）'),
      h('input', { type: 'text', id: 'stl-groups', value: (scfg.groups || []).join(', '), style: 'width:210px' }),
      h('span', { class: 'muted', style: 'font-size:12px' }, '省钱模式也照学'),
      h('input', { type: 'checkbox', id: 'stl-exempt', checked: scfg.exemptEconomy !== false }),
      h('button', { class: 'btn', onclick: saveStyleCfg }, '保存'),
      h('button', { class: 'btn ghost', onclick: async () => {
        try { await api('/api/bridge/restart', { method: 'POST', body: {} }); toast('正在重启桥接，约 10 秒'); }
        catch (e) { toast('重启失败：' + e.message, 3800); }
      } }, '重启桥接'),
      h('button', { class: 'btn', onclick: async () => {
        try { const r = await api('/api/style-now', { method: 'POST', body: {} }); toast(r.hint || '已通知她去学'); }
        catch (e) { toast('没发出去：' + e.message, 3800); }
      } }, '立刻学一轮'),
    ),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' },
      '当前：' + (scfg.targetQQ ? ('只学 QQ ' + scfg.targetQQ) : '未设置') + ' · 群 ' + ((scfg.groups || []).join('、') || '未设置')
      + ' · 严格过滤' + (scfg.strictTarget ? '开' : '关') + ' · 省钱模式也照学' + (scfg.exemptEconomy === false ? '关' : '开') + ' · 每天 ' + ((scfg.rounds || []).length) + ' 轮，每轮 ' + (scfg.perRound ?? 2) + ' 条'),
  ));

  const section = (title, list, kind, hint) => h('div', { class: 'card', style: 'margin-top:12px' },
    h('h3', {}, `${title}（${(list || []).length}）`),
    hint ? h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, hint) : null,
    (list || []).length
      ? h('table', { class: 'tbl' }, h('tbody', {}, ...list.map((s) => row(s, kind))))
      : h('div', { class: 'muted' }, '空的'),
  );

  wrap.append(h('div', { class: 'card', style: 'margin-top:12px' },
    h('h3', {}, '我看上了，加一条'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, '把一句话粘进来，直接进「正式」（会立刻进提示词）。只放你认可的说法。'),
    h('div', { class: 'toolbar', style: 'gap:10px;align-items:center;flex-wrap:wrap' },
      h('input', { type: 'text', id: 'stl-add', placeholder: '比如：这我得先看看，别急着下结论', style: 'width:420px' }),
      h('button', { class: 'btn', onclick: async () => {
        const text = ($('#stl-add')?.value || '').trim();
        if (!text) return toast('先写一句');
        try { const r = await api('/api/style-add', { method: 'POST', body: { text } }); toast(r.duplicated ? '这句已经有了' : '加进去了'); $('#stl-add').value = ''; await reload(); }
        catch (e) { toast('没加成：' + e.message, 3800); }
      } }, '加进样本'),
    )));

  wrap.append(h('div', { class: 'card', style: 'margin-top:12px' },
    h('h3', {}, '批量导入（聊天记录粘进来）'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' },
      '把 QQ 里节选的聊天记录整段粘进来，每行一句；自动只挑 6~120 字的行，去重后进「候选」。最多一次 40 行。'),
    h('textarea', { id: 'stl-bulk', rows: '6', placeholder: '一句一行，比如：\n这我得先看看，别急着下结论\n感觉这个版本能用，但心里没底', style: 'width:100%;resize:vertical' }),
    h('div', { class: 'toolbar', style: 'gap:10px;margin-top:8px' },
      h('button', { class: 'btn', onclick: async () => {
        const text = ($('#stl-bulk')?.value || '').trim();
        if (!text) return toast('先粘点东西');
        try {
          const r = await api('/api/style-bulk', { method: 'POST', body: { text } });
          toast(`导入：新增 ${r.added}，重复 ${r.dup}，被拒 ${r.bad}`);
          $('#stl-bulk').value = '';
          await reload();
        } catch (e) { toast('导入失败：' + e.message, 3800); }
      } }, '导入到候选'),
    )));

  wrap.append(section('候选（等验证）', data.candidates, 'candidate', '有人在群里第二次用同一个句式，它就会自己转正。'));
  wrap.append(section('正式（会进提示词）', data.active, 'active', '注入私聊/群提示词，最多 6 条、每条 80 字以内。'));
  if ((data.retired || []).length) wrap.append(section('已丢弃（最近 20 条）', data.retired, 'retired', '梗、口头禅、太长、过期没复用的都在这，留着方便你捞回来。'));
  return wrap;
}

function pageTalk() {
  return tabbed('talk', [
    { title: '人味指标', render: () => { const w = h('div', {}); w.append(humanStatsCard()); return w; } },
    { title: '学到的说法', render: pageStyle },
    { title: '她的看法', render: pageImpr },
    { title: '她说的话', render: pageUtter },
  ]);
}

async function loadPersona() {
  try { state.persona = await api('/api/persona'); } catch (e) { state.persona = { ok: false, error: String(e && e.message || e) }; }
  rerender();
}
function pagePersonality() {
  const wrap = h('div', {});
  if (!state.persona) { loadPersona(); wrap.append(h('div', { class: 'card muted' }, '正在读人格卡…')); return wrap; }
  const p = state.persona || {};
  if (!p.ok) { wrap.append(h('div', { class: 'card warn' }, '读不到人格卡：' + (p.error || '未知错误'))); return wrap; }
  wrap.append(h('div', { class: 'card' },
    h('h3', {}, '当前角色'),
    h('div', { class: 'kv' }, h('span', {}, '角色 ID'), h('span', {}, p.id || '—')),
    h('div', { class: 'muted', style: 'margin-top:8px;font-size:12.5px' },
      '人格是她的底座，面板只显示不修改；改人格要走仓库里的人格卡文件，改完约 ¥0.1 重建一次缓存。')));
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('h3', {}, '人格文件'),
    ...(p.files || []).map((f) => h('div', { class: 'kv' },
      h('span', {}, f.name),
      h('span', {}, `${f.chars} 字 · ${f.lines} 行 · ${(f.bytes / 1024).toFixed(1)} KB`))),
    (p.files || []).length ? null : h('div', { class: 'muted' }, '没有找到 persona.md / persona.tone.md')));
  return wrap;
}

function pageHealth() {
  return tabbed('health', [
    { title: '自检', render: () => {
      const w = h('div', {});
      w.append(h('div', { style: 'margin-bottom:14px' }, selfcheckCard()));
      w.append(h('div', { style: 'margin-bottom:14px' }, mediaStatsCard()));
      w.append(healthCard());
      return w;
    } },
    { title: '诊断', render: pageDiag },
  ]);
}

function pageMaintenance() {
  const links = [
    ['入口（通道状态）', 'entry'],
    ['白名单（旧页直接编辑）', 'access'],
    ['安全（敏感词守门）', 'safe'],
    ['记忆与情绪（旧）', 'memory-old'],
    ['记忆体检（旧）', 'memhealth'],
    ['记忆星海（旧）', 'starmap'],
    ['学说话（旧）', 'style'],
    ['她的看法（旧）', 'impr'],
    ['她说的话（旧）', 'utter'],
  ];
  return h('div', {},
    h('div', { class: 'card' },
      h('h3', {}, '旧页面入口'),
      h('div', { class: 'muted', style: 'margin-bottom:10px;font-size:12.5px' },
        '这些页面没有删除，只是收进了维护区；点进去可以照常使用。'),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
        ...links.map(([t, id]) => h('a', { class: 'chip', href: '#' + id, style: 'text-decoration:none' }, t)))),
    h('div', { class: 'card', style: 'margin-top:14px' },
      h('h3', {}, '回滚'),
      h('div', { class: 'muted', style: 'font-size:12.5px' },
        '想看旧版导航：在浏览器控制台执行 localStorage.setItem("her.legacyNav","1") 后刷新；删除该键恢复。）')));
}

function pageSettingsHub() {
  return tabbed('settings', [
    { title: '功能开关', render: pageFeatures },
    { title: '待生效与重启', render: () => pendingSettingsCard() },
    { title: '工具档', render: pagePlugins },
  ]);
}

function pendingSettingsCard() {
  const wrap = h('div', {});
  const items = (state.pending && state.pending.items) || [];
  const card = h('div', { class: 'card' }, h('h3', {}, '待生效的改动'));
  if (!items.length) card.append(h('div', { class: 'muted' }, '没有待生效改动'));
  for (const it of items) card.append(h('div', { class: 'kv' }, h('span', {}, String(it.path)), h('span', {}, String(it.to))));
  card.append(h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async () => { await api('/api/restart-bridge', 'POST', {}); toast('已请求重启桥接'); } }, '立即重启让它们生效')));
  wrap.append(card);
  return wrap;
}

function pageMemoryHub() {
  return tabbed('memory', [
    { title: '心情', render: () => hideCardsIn(pageMemory(), ['学到的说法（最近）', '学到的说法']) },
    { title: '体检', render: pageMemHealth },
    { title: '星海', render: pageStarmap },
  ]);
}
function pageMemory() {
  const d = state.overview || {};
  const wrap = h('div', {});
  state.mood = state.mood || d.mood || null; // MOODBUBBLE_UI
  const mood = Object.entries(d.mood || {}).filter(([k]) => MOOD_CN[k]).sort((a, b) => b[1] - a[1]);
  wrap.append(h('div', { class: 'grid g2' },
    h('div', { class: 'card' },
      h('h3', {}, '情绪（当前分数）'),
      ...mood.slice(0, 12).map(([k, v]) => h('div', { style: 'margin:6px 0' },
        h('div', { class: 'kv', style: 'padding:0 0 4px' }, h('span', {}, MOOD_CN[k] || k), h('span', {}, String(Math.round(v)))),
        h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, v).toFixed(1)}%` })))),
    ),
    h('div', { class: 'card' },
      h('h3', {}, '学到的说法（最近）'),
      (() => {
        const all = d.style?.samples || [];
        if (!all.length) return h('div', { class: 'muted' }, '还没有样本');
        const PER = 6;
        const pages = Math.ceil(all.length / PER);
        const cur = Math.min(pages - 1, Math.max(0, state.samplePage || 0));
        const chunk = all.slice(Math.max(0, all.length - (cur + 1) * PER), all.length - cur * PER).reverse();
        return h('div', {},
          ...chunk.map((s) => h('div', { style: 'padding:6px 0;border-bottom:1px solid var(--line)' },
            h('div', {}, s.text),
            h('div', { class: 'muted', style: 'font-size:12px' }, (s.why || '') + (s.source ? ' · ' + s.source : '')))),
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-top:8px' },
            h('span', { class: 'muted', style: 'font-size:12px' }, `共 ${all.length} 条 · 第 ${cur + 1}/${pages} 页`),
            h('div', {},
              h('button', { class: 'btn ghost', style: 'font-size:12px;padding:3px 10px;margin-right:6px', disabled: cur === 0 ? 'disabled' : null, onclick: () => { state.samplePage = cur - 1; rerender(); } }, '上一页'),
              h('button', { class: 'btn ghost', style: 'font-size:12px;padding:3px 10px', disabled: cur >= pages - 1 ? 'disabled' : null, onclick: () => { state.samplePage = cur + 1; rerender(); } }, '下一页'))),
        );
      })(),
    ),
  ));
  // MOODSTAR_UI：照 surfcore 原版画法——所有情绪按角度均分、半径=16+分×1.02、颜色 hsl(270-分×2.2)
  if (state.mood) {
    const mv = (state.mood.values && Object.keys(state.mood.values).length ? state.mood.values : state.mood) || {};
    const list = Object.entries(MOOD_CN).map(([id, zh]) => ({ id, zh, v: Number(mv[id] || 0) })).filter((m) => m.v >= 3);
    const curId = state.mood.current || '';
    const curZh = MOOD_CN[curId] || '平静';
    const W = 260, C = W / 2;
    const svg = [];
    svg.push(`<circle cx="${C}" cy="${C}" r="${C - 1}" fill="none" stroke="rgba(255,255,255,0.10)"/>`);
    svg.push(`<circle cx="${C}" cy="${C}" r="${((C - 1) * 0.66).toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4"/>`);
    list.forEach((m, i) => {
      const ang = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      const rad = 20 + m.v * 1.35;
      const x = C + Math.cos(ang) * rad, y = C + Math.sin(ang) * rad;
      const isCur = m.id === curId;
      const col = isCur ? '#ffd166' : `hsl(${Math.round(270 - m.v * 2.2)},75%,62%)`;
      svg.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${col}" data-emo="${m.id}"><title>${m.zh} ${Math.round(m.v)}</title></circle>`);
      if (m.v >= 55) svg.push(`<text x="${(x + 7).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="10" fill="rgba(255,255,255,0.55)">${m.zh}</text>`);
    });
    svg.push(`<text x="${C}" y="${C + 4}" text-anchor="middle" font-size="12" fill="rgba(255,255,255,0.9)">${curZh}</text>`);

    const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sv.setAttribute('viewBox', `0 0 ${W} ${W}`);
    sv.setAttribute('width', String(W));
    sv.setAttribute('height', String(W));
    sv.style.cssText = 'display:block;margin:6px auto';
    sv.innerHTML = svg.join('');
    // MOODREAD_UI（B 批）：心情只读——不响应点击，也不提供 ± 按钮

    const top6 = list.slice().sort((x, y) => y.v - x.v).slice(0, 6);
    const rows = h('div', { style: 'display:flex;flex-wrap:wrap;gap:10px 18px;font-size:12px;justify-content:center' },
      ...top6.map((m) => h('div', { style: 'display:flex;align-items:center;gap:6px' },
        h('span', { style: 'width:52px;opacity:.85' }, m.zh),
        h('span', { style: 'width:34px;text-align:center' }, String(Math.round(m.v))))));

    const sinceH = state.mood.since ? Math.max(1, Math.round((Date.now() - Number(state.mood.since)) / 3600000)) : 1;
    const card = h('div', { className: 'card', style: 'margin-top:10px' },
      h('div', { className: 'card-h' }, '今天的感觉（心情）'),
      h('div', { className: 'muted', style: 'font-size:12px;margin:2px 0 2px' }, '心情是她的，只能看不能调。'),
      h('div', { className: 'muted', style: 'font-size:12px;margin:2px 0 6px' }, `现在：${curZh} · 已经 ${sinceH} 小时 · 越靠外分越高（只读）`),
      sv, rows);
    wrap.append(card);
  }

  return wrap;
}

// ---------- 插件清单（P3-1） ----------
// 数据来自 /api/plugins（桥接读 docs/generated/manifests.json，再用运行实例补 routes）。
// 下面是生成时的快照：接口挂了就用它，页面不会变空。
const PLUGIN_FALLBACK = [
  {"id": "blackbox", "title": "黑箱静默", "kind": "core", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "bot-detect", "title": "机器识别", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "channel", "title": "通道能力探测", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "github-learn", "title": "GitHub 学习", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "memory-card", "title": "记忆卡片上限", "kind": "core", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "memory-scope", "title": "记忆可见范围", "kind": "core", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "profile", "title": "档案与好友", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "qzone-watch", "title": "空间巡查", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "qzone", "title": "QQ 空间", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "related-memory", "title": "相关记忆", "kind": "core", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "reminders", "title": "提醒与汇报", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "sticker-frames", "title": "表情帧", "kind": "core", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "style-learn", "title": "学说话任务", "kind": "tool", "hooks": [], "routes": [], "order": null, "migrated": false, "wave": 2},
  {"id": "owner-only", "title": "只听主人", "kind": "hook", "hooks": ["wakeGate", "onGroupMessage"], "routes": [], "order": 10, "migrated": true, "wave": 1},
  {"id": "mute", "title": "静音名单", "kind": "hook", "hooks": ["wakeGate", "routes", "stateKey"], "routes": ["/api/socialV2/mute"], "order": 20, "migrated": true, "wave": 1},
  {"id": "learnmode", "title": "学习模式", "kind": "hook", "hooks": ["wakeGate", "routes", "onGroupMessage", "stateKey"], "routes": ["/api/socialV2/learnmode"], "order": 30, "migrated": true, "wave": 1},
  {"id": "economy", "title": "省钱模式", "kind": "hook", "hooks": ["wakeGate", "routes", "stateKey"], "routes": ["/api/socialV2/economy"], "order": 40, "migrated": true, "wave": 1},
  {"id": "group-rate", "title": "群聊频率", "kind": "hook", "hooks": ["wakeGate", "routes", "stateKey"], "routes": ["/api/socialV2/grouprate"], "order": 50, "migrated": true, "wave": 1},
  {"id": "attention", "title": "该不该接话", "kind": "hook", "hooks": ["promptBlock", "wakeGate", "routes", "onGroupMessage"], "routes": ["/api/socialV2/attention"], "order": 60, "migrated": true, "wave": 1},
  {"id": "advice", "title": "建议收集", "kind": "hook", "hooks": ["routes", "onGroupMessage"], "routes": ["/api/socialV2/advice"], "order": 70, "migrated": true, "wave": 1},
  {"id": "people", "title": "人群档案", "kind": "hook", "hooks": ["routes"], "routes": ["/api/socialV2/people", "/api/socialV2/people-mark"], "order": 80, "migrated": true, "wave": 1},
  {"id": "utterances", "title": "她说的话", "kind": "hook", "hooks": ["routes"], "routes": ["/api/socialV2/utterances", "/api/socialV2/utterance-mark"], "order": 90, "migrated": true, "wave": 1},
  {"id": "safe-talk", "title": "敏感话题", "kind": "hook", "hooks": ["wakeGate", "routes", "onGroupMessage", "onPrivateMessage", "stateKey"], "routes": ["/api/socialV2/safetalk"], "order": 100, "migrated": true, "wave": 1},
  {"id": "promises", "title": "欠事捕获", "kind": "hook", "hooks": ["afterSend"], "routes": [], "order": 110, "migrated": true, "wave": 1},
  {"id": "impressions", "title": "她的看法", "kind": "hook", "hooks": ["promptBlock", "routes", "stateKey"], "routes": ["/api/socialV2/impression"], "order": 120, "migrated": true, "wave": 1},
  {"id": "owner-teach", "title": "主人教的说法", "kind": "hook", "hooks": ["promptBlock", "routes", "stateKey"], "routes": ["/api/socialV2/owner-teach"], "order": 130, "migrated": true, "wave": 1},
  {"id": "tech-notes", "title": "技术笔记", "kind": "hook", "hooks": ["promptBlock", "routes", "stateKey"], "routes": ["/api/socialV2/tech-notes"], "order": 140, "migrated": true, "wave": 1},
  {"id": "style", "title": "学说话", "kind": "hook", "hooks": ["promptBlock", "routes", "onGroupMessage", "onPrivateMessage"], "routes": ["/api/socialV2/style-list", "/api/socialV2/style-candidate", "/api/socialV2/style-note"], "order": 150, "migrated": true, "wave": 1},
  {"id": "loops", "title": "欠事与人物", "kind": "hook", "hooks": ["routes"], "routes": ["/api/socialV2/person", "/api/socialV2/loop"], "order": 160, "migrated": true, "wave": 1},
  {"id": "stickers", "title": "贴纸待办", "kind": "core", "hooks": [], "routes": [], "order": 170, "migrated": true, "wave": 1},
];
const PLUGIN_HOOK_LABEL = { promptBlock: '提示词', wakeGate: '唤醒闸门', onGroupMessage: '群消息', onPrivateMessage: '私聊', afterSend: '发送后', stateKey: '状态键', routes: '路由' };

async function loadPlugins(force) {
  if (state.plugins && !force) return state.plugins;
  try {
    const j = await api('/api/plugins');
    if (!j || !Array.isArray(j.modules)) throw new Error((j && j.error) || '清单格式不对');
    state.plugins = j.modules;
    state.pluginsAt = j.at ? new Date(j.at).toLocaleString('zh-CN', { hour12: false }) : '';
    state.pluginsErr = '';
    state.pluginsFallback = false;
  } catch (e) {
    state.plugins = PLUGIN_FALLBACK;
    state.pluginsAt = '';
    state.pluginsErr = (e && e.message) || '读取失败';
    state.pluginsFallback = true;
  }
  rerender();
  return state.plugins;
}

function pluginTable(mods) {
  return h('table', { class: 'tbl-fit nowrap-tbl plugins-tbl' },
    h('thead', {}, h('tr', {},
      h('th', {}, '标题'), h('th', { style: 'width:64px' }, 'wave'), h('th', { style: 'width:86px' }, 'migrated'),
      h('th', { style: 'width:70px' }, '钩子'), h('th', { style: 'width:70px' }, '路由'), h('th', {}, '钩子明细'))),
    h('tbody', {}, ...mods.map((m) => h('tr', {},
      h('td', {}, m.title || m.id, h('div', { class: 'mono muted', style: 'font-size:11px' }, m.id)),
      h('td', {}, 'W' + (m.wave || '?')),
      h('td', {}, m.migrated ? h('span', { style: 'color:var(--ok)' }, '是') : h('span', { class: 'muted' }, '否')),
      h('td', {}, String((m.hooks || []).length)),
      h('td', {}, String((m.routes || []).length)),
      h('td', { class: 'mono muted', style: 'font-size:11px' }, (m.hooks || []).map((x) => PLUGIN_HOOK_LABEL[x] || x).join(' · '))))));
}

function pagePlugins() {
  const wrap = h('div', {});
  if (!state.plugins) { loadPlugins(); wrap.append(h('div', { class: 'card muted' }, '正在读插件清单…')); return wrap; }
  const mods = state.plugins.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const w1 = mods.filter((m) => m.wave === 1).length;
  const w2 = mods.filter((m) => m.wave === 2).length;
  wrap.append(h('div', { class: 'toolbar' },
    h('span', { class: 'muted' }, `共 ${mods.length} 个模块 · wave1 ${w1} · wave2 ${w2}`),
    h('span', { class: 'muted', style: 'margin-left:auto;font-size:12px' }, state.pluginsAt ? '清单时间 ' + state.pluginsAt : ''),
    h('button', { class: 'btn ghost', onclick: () => loadPlugins(true) }, '刷新清单')));
  if (state.pluginsFallback) {
    wrap.append(h('div', { class: 'card', style: 'border-color:var(--warn)' },
      h('div', { style: 'color:var(--warn);font-size:12.5px' }, `读 /api/plugins 失败（${state.pluginsErr}），下面是面板内置快照，可能过期；点「刷新清单」重试。`)));
  }
  wrap.append(h('div', { class: 'card' }, pluginTable(mods)));
  return wrap;
}

// ---------- 记忆星海（3D 星海，可拖动旋转 / 缩放 / 飞行聚焦 / 时间流动） ----------
const starCam = { yaw: 0.6, pitch: -0.22, dist: 2.45, yawT: null, pitchT: null, distT: 2.45, vx: 0, vy: 0, auto: true };
let starSel = null;
let starAnim = 0;
let starFlow = 0; // 0 = 正常布局，1 = 按时间铺开
// STARTIME_PATCH：时间轴——拖到 0.5 就只看前半段长出来的星（视频里那种「记忆一点点长出来」）
let starT = (window.__dshStarT == null) ? 1 : Math.max(0, Math.min(1, Number(window.__dshStarT)));
let starCutCache = { t: -1, n: -1, cut: Infinity };
function starCutoff() {
  if (starT >= 0.999) return Infinity;
  const recs = (state.mem && state.mem.records) || [];
  if (starCutCache.t === starT && starCutCache.n === recs.length) return starCutCache.cut;
  const ts = recs.map((r) => Date.parse(r.createdAt || r.lastSeenAt || '') || 0).filter((x) => x > 0).sort((a, b) => a - b);
  const cut = ts.length ? ts[Math.min(ts.length - 1, Math.floor(starT * (ts.length - 1)))] : Infinity;
  starCutCache = { t: starT, n: recs.length, cut };
  return cut;
}

const STAR_CLARITY = {
  vivid: { color: '#8ef0b0', cn: '鲜明' },
  clear: { color: '#5cb8ff', cn: '清楚' },
  fuzzy: { color: '#9aa8bd', cn: '模糊' },
  faded: { color: '#5a6474', cn: '快忘' },
};

// 星海风格：只改观感（背景 / 星尘 / 连线 / 高亮色），不改任何功能
const STAR_THEMES = {
  deep: {
    id: 'deep', cn: '深海', accent: '#5cb8ff',
    bg0: 'rgba(36,74,140,0.40)', bg1: 'rgba(16,30,60,0.62)', bg2: 'rgba(5,8,16,0.97)',
    dust: '#bcd6ff', ring: 'rgba(120,170,255,0.10)',
    core: 'rgba(140,200,255,0.20)', core0: 'rgba(140,200,255,0)', edge: '120,175,255',
  },
  dusk: {
    id: 'dusk', cn: '暮紫', accent: '#b98cff',
    bg0: 'rgba(78,44,120,0.42)', bg1: 'rgba(30,20,56,0.64)', bg2: 'rgba(8,5,16,0.97)',
    dust: '#d8c4ff', ring: 'rgba(170,130,255,0.12)',
    core: 'rgba(190,150,255,0.20)', core0: 'rgba(190,150,255,0)', edge: '170,140,255',
  },
  mono: {
    id: 'mono', cn: '极夜', accent: '#cfd8e6',
    bg0: 'rgba(52,58,70,0.36)', bg1: 'rgba(20,24,32,0.66)', bg2: 'rgba(4,5,8,0.98)',
    dust: '#cfd8e6', ring: 'rgba(150,165,190,0.10)',
    core: 'rgba(200,215,235,0.16)', core0: 'rgba(200,215,235,0)', edge: '170,185,205',
  },
  sakura: {
    id: 'sakura', cn: '樱雾', accent: '#ff9cc8',
    bg0: 'rgba(120,52,90,0.38)', bg1: 'rgba(46,24,44,0.62)', bg2: 'rgba(12,6,12,0.97)',
    dust: '#ffd0e2', ring: 'rgba(255,150,190,0.12)',
    core: 'rgba(255,170,205,0.20)', core0: 'rgba(255,170,205,0)', edge: '255,160,200',
  },
};
function starTheme() { return STAR_THEMES[state.starTheme] || STAR_THEMES.deep; }

function starHash(s) { let x = 2166136261; for (let i = 0; i < s.length; i += 1) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0) / 4294967295; }

// 预渲染发光小球（每个颜色一张，避免每帧创建渐变）
const starSprites = new Map();
function starSprite(color) {
  if (starSprites.has(color)) return starSprites.get(color);
  const S = 96;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const gd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gd.addColorStop(0, color);
  gd.addColorStop(0.07, color);
  gd.addColorStop(0.20, color + 'cc');
  gd.addColorStop(0.42, color + '40');
  gd.addColorStop(0.72, color + '0d');
  gd.addColorStop(1, color + '00');
  g.fillStyle = gd;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
  starSprites.set(color, cv);
  return cv;
}

// 把记忆摆成球：重要的靠内圈，Fibonacci 均匀撒点 + 抖动
function starLayout(recs) {
  const n = recs.length || 1;
  const GA = Math.PI * (3 - Math.sqrt(5));
  const now = Date.now();
  const ages = recs.map((r) => {
    const t = Date.parse(r.lastSeenAt || r.createdAt || '') || 0;
    return t ? Math.min(1, Math.max(0, (now - t) / (1000 * 60 * 60 * 24 * 45))) : 0.5;
  });
  return recs.map((r, i) => {
    const imp = Math.max(0, Math.min(100, r.importance || 0));
    const base = 0.52 + ((100 - imp) / 100) * 1.02;
    const jr = 0.92 + starHash(r.id || r.title || String(i)) * 0.20;
    const y = 1 - ((i + 0.5) / n) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = GA * i + starHash((r.id || '') + 'a') * 0.9;
    const rr = base * jr;
    return {
      r,
      age: ages[i],
      tw: starHash((r.id || '') + 'c'),
      x: Math.cos(th) * rad * rr,
      y: (y * 0.82 + (starHash((r.id || '') + 'b') - 0.5) * 0.1) * rr,
      z: Math.sin(th) * rad * rr,
    };
  });
}

function starEdges(pts, maxPerGroup = 22) {
  const byTag = new Map();
  for (const p of pts) {
    const tags = (p.r.tags && p.r.tags.length) ? p.r.tags : ['untagged'];
    for (const t of tags) {
      if (!byTag.has(t)) byTag.set(t, []);
      const arr = byTag.get(t);
      if (arr.length < maxPerGroup) arr.push(p);
    }
  }
  const edges = [];
  for (const [, arr] of byTag) for (let i = 0; i < arr.length - 1; i += 1) edges.push([arr[i], arr[i + 1]]);
  return edges;
}

// 背景（星尘 + 环 + 暗角），按尺寸缓存
let starbgCache = { key: '', cv: null };
function starBackdrop(W, H) {
  const th = starTheme();
  const key = W + 'x' + H + th.id;
  if (starbgCache.key === key) return starbgCache.cv;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 24;

  const bg = g.createRadialGradient(cx, cy, 8, cx, cy, Math.max(W, H) * 0.75);
  bg.addColorStop(0, th.bg0);
  bg.addColorStop(0.42, th.bg1);
  bg.addColorStop(1, th.bg2);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  for (let i = 0; i < 260; i += 1) {
    const x = Math.random() * W, y = Math.random() * H, rr = Math.random() * 1.2 + 0.2;
    g.globalAlpha = 0.12 + Math.random() * 0.5;
    g.fillStyle = th.dust;
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;

  // 星云（低透明度大团块，'lighter' 叠出深海感）
  g.globalCompositeOperation = 'lighter';
  const neb = [
    [W * 0.24, H * 0.30, Math.max(W, H) * 0.46, th.accent, 0.13],
    [W * 0.78, H * 0.66, Math.max(W, H) * 0.42, '#8b7bff', 0.09],
    [W * 0.56, H * 0.14, Math.max(W, H) * 0.32, '#2ee6c4', 0.06],
  ];
  for (const [nx, ny, nr, col, al] of neb) {
    const ng = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
    ng.addColorStop(0, col + 'ff');
    ng.addColorStop(0.45, col + '33');
    ng.addColorStop(1, col + '00');
    g.globalAlpha = al;
    g.fillStyle = ng;
    g.beginPath(); g.arc(nx, ny, nr, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  for (const k of [0.42, 0.68, 0.94]) {
    g.strokeStyle = th.ring;
    g.lineWidth = 1;
    g.beginPath(); g.ellipse(cx, cy, R * k, R * k * 0.92, 0, 0, Math.PI * 2); g.stroke();
  }

  const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.15);
  core.addColorStop(0, th.core);
  core.addColorStop(1, th.core0);
  g.fillStyle = core; g.beginPath(); g.arc(cx, cy, R * 0.15, 0, Math.PI * 2); g.fill();

  starbgCache = { key, cv };
  return cv;
}

function pageStarmap() {
  const wrap = h('div', {});
  if (!state.mem) {
    if (state.memGaveUp) {
      wrap.append(h('div', { class: 'card', style: 'text-align:center;padding:36px 20px' },
        h('div', { style: 'font-size:34px;margin-bottom:8px' }, '🫧'),
        h('h3', { style: 'margin:0 0 8px' }, '记忆没能读出来'),
        h('div', { class: 'muted', style: 'margin-bottom:14px' }, state.memError || '网络或服务那边慢了一下，重试通常就好。'),
        h('button', {
          class: 'btn',
          onclick: () => { state.memGaveUp = false; memFails = 0; loadMem().then(() => rerender()).catch(() => rerender()); },
        }, '重新读一次')));
      // CHIPROW：把筛选那一排挪到画布上方的工具条里（只移 DOM 节点，不改原渲染顺序）
  try {
    const chipRow = wrap.querySelector('[data-chiprow="1"]');
    const bar = flowBtn && flowBtn.parentElement;
    if (chipRow && bar && chipRow.parentElement !== bar) {
      chipRow.style.marginTop = '0';
      chipRow.style.padding = '0';
      chipRow.style.border = '0';
      chipRow.style.background = 'transparent';
      bar.appendChild(chipRow);
    }
  } catch {}

  return wrap;
    }
    kickMem();
    wrap.append(h('div', { class: 'card muted' }, '正在读记忆…'));
    return wrap;
  }
  const d = state.mem;
  const all = d.records || [];
  const seen = all.filter((r) => (state.starForgot ? true : !r.forgotten));
  // 记忆很多时分层抽样：重要的全画，琐碎的两条抽一条（否则糊成一片）
  let recs = seen;
  if (seen.length > 700) {
    const keep = seen.filter((r) => r.pinned || (r.importance || 0) >= 55);
    const rest = seen.filter((r) => !(r.pinned || (r.importance || 0) >= 55)).filter((_, i) => i % 2 === 0);
    recs = [...keep, ...rest];
  }
  const nForgot = all.filter((r) => r.forgotten).length;

  // 空状态：没有可画的星时给出口，别让人对着黑屏发呆
  if (!recs.length) {
    wrap.append(h('div', { class: 'card', style: 'text-align:center;padding:40px 20px' },
      h('div', { style: 'font-size:38px;margin-bottom:10px' }, '🌌'),
      h('h3', { style: 'margin:0 0 8px' }, all.length ? '当前筛选下没有星' : '还没有记下任何事'),
      h('div', { class: 'muted', style: 'margin-bottom:16px' },
        all.length ? `一共 ${all.length} 条，但都被筛掉了（淡忘 ${nForgot} 条）。` : '等她聊过几次，这里就会亮起来。'),
      h('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
        state.starForgot ? h('button', { class: 'btn', onclick: () => { state.starForgot = false; rerender(); } }, '只看记着的') : null,
        state.starTag ? h('button', { class: 'btn ghost', onclick: () => { state.starTag = null; rerender(); } }, '清掉标签筛选') : null,
        h('button', { class: 'btn ghost', onclick: () => { state.memGaveUp = false; memFails = 0; loadMem().then(() => rerender()).catch(() => rerender()); } }, '重新读一次')),
    ));
    return wrap;
  }

  const pts = starLayout(recs);
  // 操作完（钉住/忘掉/合并）把镜头和选中状态停回同一颗星
  if (state.pendingSelId) {
    const hit = pts.find((o) => o.r && o.r.id === state.pendingSelId);
    state.pendingSelId = null;
    if (hit) { starSel = hit; }
  }
  const edges = starEdges(pts);

  // ——— 顶部统计 ———
  wrap.append(h('div', { class: 'grid g3', style: 'margin-bottom:12px' },
    h('div', { class: 'card' }, h('div', { class: 'muted' }, '共记下'), h('div', { class: 'big' }, String(d.total))),
    h('div', { class: 'card' }, h('div', { class: 'muted' }, '清晰度（鲜明/清楚/模糊）'),
      h('div', { class: 'big', style: 'font-size:22px' }, `${d.byClarity.vivid || 0} / ${d.byClarity.clear || 0} / ${d.byClarity.fuzzy || 0}`)),
    h('div', { class: 'card' },
      h('div', { class: 'muted' }, '视角'),
      h('div', { style: 'font-size:12px;line-height:1.9' },
        h('div', {}, '拖动 = 旋转 · 滚轮 = 缩放（范围更大）'),
        h('div', {}, '点星 = 聚焦并看详情 · 双指/滚轮可拉得很近'))),
  ));

  // ——— 工具条 ———
  const flowBtn = h('button', {
    class: 'btn ghost', style: 'font-size:12px;padding:5px 10px',
    onclick: () => { state.starFlow = !state.starFlow; flowBtn.textContent = state.starFlow ? '时间铺开：开' : '时间铺开：关'; starCam.distT = Math.max(starCam.distT, 4.2); },
  }, state.starFlow ? '时间铺开：开' : '时间铺开：关');

  const searchInput = h('input', {
    class: 'inp', placeholder: '搜记忆（标题 / 内容 / 标签）…回车直接飞到第一条', value: state.starQ || '', style: 'flex:1;min-width:180px',
    oninput: (e) => { state.starQ = e.target.value; paintResults(); },
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const first = lastHits[0];
      if (!first) { toast('没有命中，换个词试试', 2500); return; }
      const hit = pts.find((o) => o.r && o.r.id === first.id);
      if (hit) { starSel = hit; flyTarget(); renderDetail(); holder.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else toast('这条不在当前星图里（可能被筛选或淡忘了）', 3000);
    },
  });
  wrap.append(h('div', { class: 'card', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px' },
    searchInput,
    h('span', { class: 'muted', id: 'starcount', style: 'font-size:12px' }, ''),
    flowBtn,
    h('button', {
      class: 'btn ghost',
      style: 'font-size:12px;padding:5px 10px' + (state.starForgot ? ';border-color:#9aa8bd;color:#dce6f5;background:rgba(154,168,189,.14)' : ''),
      title: state.starForgot ? '点一下收起：星图和搜索里不再出现已淡忘的记忆' : '点一下把已淡忘的记忆也纳入星图和搜索',
      onclick: () => { state.starForgot = !state.starForgot; rerender(); },
    }, `已淡忘 ${nForgot} · ${state.starForgot ? '显示中' : '隐藏中'}`),
    h('button', {
      class: 'btn ghost', style: 'font-size:12px;padding:5px 10px',
      onclick: () => { starCam.yawT = 0.6; starCam.pitchT = -0.22; starCam.distT = 2.45; starSel = null; },
    }, '回到正面'),
  ));

  // ——— 时间轴（STARTIME_PATCH） ———
  const tlab = () => (starT >= 0.999 ? '全部记忆' : ('只看到 ' + new Date(starCutoff()).toLocaleDateString('zh-CN')));
  wrap.append(h('div', { class: 'card', style: 'margin-top:10px;display:flex;gap:12px;align-items:center;padding:9px 14px' },
    h('span', { class: 'muted', style: 'font-size:12px;white-space:nowrap' }, '时间轴'),
    h('input', {
      type: 'range', min: '0', max: '1', step: '0.01', value: String(starT),
      style: 'flex:1;min-width:160px;accent-color:#5cb8ff',
      oninput: (e) => {
        starT = Number(e.target.value);
        const el = document.getElementById('startlab'); if (el) el.textContent = tlab();
      },
    }),
    h('span', { class: 'muted', id: 'startlab', style: 'font-size:12px;white-space:nowrap;min-width:112px;text-align:right' }, tlab()),
    h('button', { class: 'btn ghost', style: 'font-size:12px;padding:4px 9px', onclick: () => { starT = 1; rerender(); } }, '拉到底'),
  ));

  // ——— 星海风格（只改观感） ———
  state.starTheme = state.starTheme || (() => { try { return localStorage.getItem('starTheme') || 'deep'; } catch { return 'deep'; } })();
  wrap.append(h('div', { class: 'card', style: 'margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 14px' },
    h('span', { class: 'muted', style: 'font-size:12px' }, '星海风格'),
    ...Object.values(STAR_THEMES).map((t) => h('span', {
      class: 'chip',
      style: 'cursor:pointer' + (starTheme().id === t.id ? ';border-color:' + t.accent + ';color:' + t.accent : ''),
      onclick: () => { state.starTheme = t.id; try { localStorage.setItem('starTheme', t.id); } catch {} rerender(); },
    }, t.cn)),
    h('span', { class: 'muted', style: 'font-size:11.5px;margin-left:4px' }, '只改观感，不影响用法'),
  ));

  // ——— 画布 ———
  const holder = h('div', { style: 'position:relative;margin-top:12px;border-radius:18px;overflow:hidden;border:1px solid var(--line);box-shadow:0 18px 50px -30px #000 inset' });
  const canvas = h('canvas', { id: 'starcanvas', style: 'display:block;width:100%;height:clamp(430px, calc(100vh - 430px), 900px);cursor:grab;touch-action:none' });
  const tip = h('div', {
    style: 'position:absolute;pointer-events:none;padding:5px 9px;border-radius:9px;background:rgba(8,14,26,.94);border:1px solid rgba(120,170,255,.35);font-size:12px;color:#dbe7ff;display:none;max-width:300px;line-height:1.5',
  });
  const legend = h('div', {
    style: 'position:absolute;left:14px;bottom:12px;display:flex;gap:12px;font-size:11.5px;color:#9fb4d6;background:rgba(6,10,20,.55);padding:6px 10px;border-radius:10px;border:1px solid rgba(120,170,255,.16)',
  },
  h('span', { style: 'color:#8ef0b0' }, '● 鲜明'),
  h('span', { style: 'color:#5cb8ff' }, '● 清楚'),
  h('span', { style: 'color:#9aa8bd' }, '● 模糊'),
  h('span', { style: 'color:#ffd479' }, '○ 钉住'),
  h('span', { style: 'color:#7f95bb' }, '只展示'),
  h('span', { style: 'color:#7f8ea8' }, '中心=重要')); // DISPLAYONLY_UI
  const zoomTag = h('div', { style: 'position:absolute;right:14px;bottom:12px;font-size:11.5px;color:#9fb4d6;background:rgba(6,10,20,.55);padding:6px 10px;border-radius:10px;border:1px solid rgba(120,170,255,.16)' }, '');
  // CHIPROW2：三个筛选 chip 挂在画布右上角（图例那一层，一定渲染）
  const starChips = h('div', { style: 'position:absolute;right:14px;top:12px;display:flex;gap:8px;flex-wrap:wrap;z-index:2' },
    ...[['pinned', '* 只看钉住', '#ffd479'], ['week', '近 7 天', '#5cb8ff'], ['display', '只展示区', '#7f95bb']].map(([id, label, color]) =>
      h('span', {
        class: 'chip',
        style: 'cursor:pointer;background:rgba(6,10,20,.72)' + (state.starOnly === id ? `;border-color:${color};color:${color}` : ''),
        onclick: () => { state.starOnly = state.starOnly === id ? null : id; rerender(); },
      }, label)));
  holder.append(canvas, tip, legend, zoomTag, starChips);

  // 投影对象是 { p, sx, sy, … }，真正的记忆挂在 p.r 上；这里两种形态都兼容
  const starSelRec = () => (starSel ? (starSel.r || (starSel.p && starSel.p.r) || null) : null);

  // 选中一颗星后，浮在星图底部的操作条（不挡内容、不用往下滚）
  const selBar = h('div', {
    style: 'position:absolute;left:10px;right:10px;top:10px;display:none;gap:8px;align-items:center;padding:8px 12px;border-radius:12px;background:rgba(8,14,26,.72);border:1px solid rgba(120,170,255,.28);backdrop-filter:blur(6px);box-shadow:0 8px 24px rgba(0,0,0,.35)',
  });
  holder.append(selBar);
  // 极简 HUD 角标（纯装饰，不接事件）
  const hudCorner = (css) => h('div', { style: 'position:absolute;width:16px;height:16px;pointer-events:none;border:0 solid rgba(150,200,255,0.32);' + css });
  holder.append(
    hudCorner('left:10px;top:10px;border-left-width:1px;border-top-width:1px'),
    hudCorner('right:10px;top:10px;border-right-width:1px;border-top-width:1px'),
  );
  const selBtn = (label, fn, gold) => h('button', {
    class: 'btn ' + (gold ? '' : 'ghost'),
    style: 'font-size:12.5px;padding:5px 12px;white-space:nowrap' + (gold ? ';border-color:rgba(255,212,121,.5);color:#ffd479' : ''),
    onclick: fn,
  }, label);
  const paintSelBar = () => {
    selBar.innerHTML = '';
    const r = starSelRec();
    if (!r) { selBar.style.display = 'none'; return; }
    selBar.style.display = 'flex';
    selBar.append(
      h('span', { style: 'color:#8b9bb4;font-size:12px;white-space:nowrap' }, '选中'),
      h('div', { style: 'flex:1;min-width:0;font-size:13px;color:#e6efff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, String(r.title || r.text || '').slice(0, 50)),
      selBtn(r.pinned ? '取消钉住' : '钉住', () => doPost('/api/mem/pin', { id: r.id, pinned: !r.pinned }), r.pinned),
      selBtn('忘掉', () => { if (confirm('放进暂存区（30 天内可恢复）。确定？')) doPost('/api/mem/forget', { id: r.id }); }),
      h('button', { class: 'btn ghost', style: 'font-size:12px;padding:5px 10px', title: '取消选中', onclick: () => { starSel = null; renderDetail(); } }, '✕'),
    );
  };
  wrap.append(holder);

  // ——— 手动教她一句 ———
  const teachInput = h('textarea', {
    class: 'inp', rows: 2,
    placeholder: '想让她牢牢记住的一句话（例：我怕黑，晚上别关灯 / 我下周三面试，别在那天烦我）',
    style: 'flex:1;min-width:240px;resize:vertical;line-height:1.6',
  });
  const teachBtn = h('button', {
    class: 'btn', style: 'white-space:nowrap',
    onclick: async () => {
      const text = String(teachInput.value || '').trim();
      if (!text) { toast('先写一句再教她', 2500); return; }
      teachBtn.disabled = true;
      try {
        const out = await api('/api/mem/add', { method: 'POST', body: { text, importance: 85 } });
        if (!out.ok) { alert(out.error || '没记住'); return; }
        teachInput.value = '';
        toast('记住啦，已经进记忆卡', 3000);
        state.mem = null;
        await loadMem();
        rerender();
      } catch (e) {
        alert('没记住：' + ((e && e.message) || '网络问题'));
      } finally { teachBtn.disabled = false; }
    },
  }, '让她记住');
  wrap.append(h('div', { class: 'card', style: 'margin-top:10px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;padding:10px 14px' },
    h('div', { style: 'flex:1;min-width:240px' },
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:4px' }, '教她记住：写进去就进记忆卡，立刻注入提示词（不用等她整理）'),
      teachInput),
    teachBtn));

  // ——— 搜索候选 / 结果列表（输入即时出候选，不再只靠星海变暗） ———
  const resultCard = h('div', { class: 'card', style: 'margin-top:10px;display:none;max-height:44vh;overflow:auto' });
  wrap.append(resultCard);

  // ——— 标签筛选 ———
  const tagList = Object.entries(d.byTag || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (true) { // CHIPROW：没有标签的记忆也要能筛「只展示区」
    wrap.append(h('div', { 'data-chiprow': '1', class: 'card', style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 14px;margin-top:10px' },
      h('span', {
        class: 'chip', style: 'cursor:pointer' + (state.starOnly === 'pinned' ? ';border-color:#ffd479;color:#ffd479' : ''),
        onclick: () => { state.starOnly = state.starOnly === 'pinned' ? null : 'pinned'; rerender(); },
      }, '★ 只看钉住'),
      h('span', {
        class: 'chip', style: 'cursor:pointer' + (state.starOnly === 'week' ? ';border-color:#5cb8ff;color:#dff0ff' : ''),
        onclick: () => { state.starOnly = state.starOnly === 'week' ? null : 'week'; rerender(); },
      }, '近 7 天'),
      h('span', {
        class: 'chip', style: 'cursor:pointer' + (state.starOnly === 'display' ? ';border-color:#7f95bb;color:#cfe0ff' : ''),
        onclick: () => { state.starOnly = state.starOnly === 'display' ? null : 'display'; rerender(); },
      }, '只展示区'),
      ...(state.starOnly || state.starTag || state.starGroup
        ? [h('span', {
          class: 'chip', style: 'cursor:pointer;border-color:#ff9b9b;color:#ff9b9b',
          onclick: () => { state.starOnly = null; state.starTag = null; state.starGroup = null; rerender(); },
        }, '清空筛选')]
        : []),
      h('span', { class: 'muted', style: 'font-size:12px;margin-left:6px' }, '标签：'),
      h('span', {
        class: 'chip', style: 'cursor:pointer' + (state.starTag ? '' : ';border-color:#5cb8ff'),
        onclick: () => { state.starTag = null; rerender(); },
      }, '全部'),
      ...tagList.map(([t, n]) => h('span', {
        class: 'chip', style: 'cursor:pointer' + (state.starTag === t ? ';border-color:#5cb8ff;color:#dff0ff' : ''),
        onclick: () => { state.starTag = state.starTag === t ? null : t; rerender(); },
      }, `${t} ${n}`)),
    ));
  }


  // ——— 详情 ———
  const detail = h('div', { class: 'card', style: 'margin-top:12px' });
  wrap.append(detail);

  const doPost = async (path, body) => {
    const keepId = starSelRec() ? starSelRec().id : null;
    const out = await api(path, { method: 'POST', body });
    if (!out.ok) { alert(out.error || '失败'); return; }
    state.mem = null;
    state.pendingSelId = keepId; // 改完把镜头停回原来那颗星，按钮状态才是新的
    await loadMem();
    rerender();
  };

  const renderDetail = () => {
    detail.innerHTML = '';
    paintSelBar();
    if (!starSelRec()) {
      detail.append(h('div', { class: 'muted' }, '点任意一颗星 → 镜头会飞过去，下面显示这条记忆的全文；也可以钉住或让她忘掉。'));
      return;
    }
    const r = starSelRec();
    const meta = STAR_CLARITY[r.clarity] || STAR_CLARITY.fuzzy;
    const act = (label, fn, ghost) => h('button', { class: 'btn ' + (ghost ? 'ghost' : ''), style: 'font-size:13px;padding:6px 12px;margin-right:8px;margin-top:4px', onclick: fn }, label);
    detail.append(
      h('div', { style: 'display:flex;gap:10px;align-items:baseline;flex-wrap:wrap' },
        h('h3', { style: 'margin:0' }, r.title || '(无标题)'),
        h('span', { style: 'font-size:12px;color:' + meta.color }, '● ' + meta.cn),
        r.forgotten ? h('span', { style: 'font-size:12px;color:#8b9bb4' }, '（已淡忘）') : null,
        r.pinned ? h('span', { style: 'font-size:12px;color:#ffd479' }, '★ 已钉住') : null,
      ),
      h('div', { style: 'margin-top:10px;white-space:pre-wrap;line-height:1.85;font-size:14px' }, r.text),
      h('div', { class: 'muted', style: 'margin-top:10px;font-size:12px' },
        `重要度 ${r.importance} · 被想起 ${r.recall} 次 · ${r.speaker || '—'}${r.groupId ? ' · 群 ' + r.groupId : ''}`),
      h('div', { class: 'muted', style: 'font-size:12px' },
        `记于 ${String(r.createdAt).replace('T', ' ').slice(0, 16)} · 最近提到 ${String(r.lastSeenAt).replace('T', ' ').slice(0, 16)}`),
      r.tags && r.tags.length ? h('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' }, ...r.tags.map((t) => h('span', { class: 'tagx' }, t))) : null,
      h('div', { style: 'margin-top:12px' },
        r.forgotten
          ? act('恢复这条（重新记起来）', () => doPost('/api/mem/forget', { id: r.id, restore: true }))
          : act(r.pinned ? '取消钉住' : '钉住（不让它变淡）', () => doPost('/api/mem/pin', { id: r.id, pinned: !r.pinned })),
        r.forgotten ? null : act('让她忘掉这条', () => { if (confirm('这条会变淡并从星海移出（可恢复）。确定？')) doPost('/api/mem/forget', { id: r.id }); }, true),
        act('看完整原文', async () => {
          const t = detail.querySelector('[data-full]');
          if (t) { t.remove(); return; }
          const box = h('div', { 'data-full': '1', class: 'muted', style: 'margin-top:10px;font-size:13px;white-space:pre-wrap;line-height:1.7;border-left:2px solid rgba(120,170,255,.3);padding-left:10px' }, `id: ${r.id}\n正在取全文…`);
          detail.append(box);
          try {
            const j = await api('/api/mem/item?id=' + encodeURIComponent(r.id));
            box.textContent = `id: ${r.id}\n` + ((j && j.record && j.record.text) || r.text);
          } catch (e) {
            box.textContent = '全文没取到：' + ((e && e.message) || '网络问题') + '\n先看这段：\n' + r.text;
          }
        }, true),
      ),
      h('div', { class: 'muted', style: 'margin-top:10px;font-size:12px;line-height:1.8;border-top:1px dashed rgba(120,170,255,.18);padding-top:8px' },
        r.pinned
          ? `★ 这条已钉住：不会被"淡忘"、也不会被自动合并淘汰。想取消就点上面「取消钉住」。`
          : `钉住 = 把这条固定住（不淡忘、不被自动合并淘汰），最多 20 条；再点一次就取消。忘掉 = 让它变淡并移出星海，随时可用「恢复」找回来。`),
    );
  };
  renderDetail();

  // ——— 列表直达：不靠点星也能钉住/忘掉 ———
  const listCard = h('div', { class: 'card', style: 'margin-top:12px' });
  const rebuildList = () => {
    listCard.innerHTML = '';
    const rows = [...recs].sort((a, b) => (b.importance || 0) - (a.importance || 0)).slice(0, 30);
    const pinCount = (state.mem.records || []).filter((x) => x.pinned).length;
    listCard.append(
      h('h3', { style: 'margin-top:0' }, `直接操作（按重要度取前 30 条 · 已钉住 ${pinCount} / 20）`),
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' },
        '不想在星海里点也行：点「☆ 钉住」固定这条（再点变回取消），点「忘掉」让它变淡并移出星海（可恢复）。'),
      ...rows.map((r) => h('div', { style: 'display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid var(--line)' },
        h('button', {
          class: 'btn ' + (r.pinned ? '' : 'ghost'),
          style: 'font-size:12.5px;padding:4px 10px;min-width:76px;' + (r.pinned ? 'color:#ffd479;border-color:rgba(255,212,121,.45)' : ''),
          title: r.pinned ? '点一下取消钉住' : '点一下钉住（不让它变淡）',
          onclick: async () => {
            const out = await api('/api/mem/pin', { method: 'POST', body: { id: r.id, pinned: !r.pinned } });
            if (!out.ok) { alert(out.error || '失败'); return; }
            state.mem = null; await loadMem(); rerender();
          },
        }, r.pinned ? '★ 已钉住' : '☆ 钉住'),
        h('div', { style: 'flex:1;font-size:13px;line-height:1.65;overflow:hidden' }, String(r.title || r.text || '').slice(0, 60)),
        h('button', {
          class: 'btn ghost', style: 'font-size:12px;padding:4px 10px', title: '变淡并移出星海，可恢复',
          onclick: async () => {
            if (!confirm('这条会变淡并从星海移出（可恢复）。确定？')) return;
            const out = await api('/api/mem/forget', { method: 'POST', body: { id: r.id } });
            if (!out.ok) { alert(out.error || '失败'); return; }
            state.mem = null; await loadMem(); rerender();
          },
        }, '忘掉'),
      )),
    );
  };
  rebuildList();
  wrap.append(listCard);

  // ——— 搜索：即时候选 + 结果清单 ———
  let lastHits = [];
  const snip = (r, q) => {
    const t = String(r.text || r.title || '');
    if (!q) return t.slice(0, 72);
    const i = t.toLowerCase().indexOf(q);
    if (i < 0) return t.slice(0, 72);
    const s = Math.max(0, i - 26);
    return (s > 0 ? '…' : '') + t.slice(s, s + 86) + (t.length > s + 86 ? '…' : '');
  };
  const paintResults = () => {
    const q = String(state.starQ || '').trim().toLowerCase();
    const pool = all.filter((r) => (state.starForgot ? true : !r.forgotten));
    resultCard.innerHTML = '';
    if (!q) {
      lastHits = [...pool]
        .sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned))
          || (Date.parse(b.lastSeenAt || b.createdAt || 0) || 0) - (Date.parse(a.lastSeenAt || a.createdAt || 0) || 0))
        .slice(0, 10);
      resultCard.style.display = 'block';
      resultCard.append(
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:4px' }, `最近记下的 ${lastHits.length} 条 · 在上面输入关键词就能搜（打一个字就开始出候选）`),
        ...lastHits.map(rowOf),
      );
      return;
    }
    lastHits = pool
      .filter((r) => [r.title, r.text, (r.tags || []).join(' '), r.speaker].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, 40);
    resultCard.style.display = 'block';
    if (!lastHits.length) {
      resultCard.append(
        h('div', { style: 'font-size:13px;color:#ffd479;margin-bottom:4px' }, `「${state.starQ.trim()}」没有命中`),
        h('div', { class: 'muted', style: 'font-size:12px;line-height:1.8' },
          '试试：把关键词缩短成一个词（比如只留“视频”“生日”“考研”）；',
          state.starForgot ? '现在包含已淡忘的，也可以只搜记着的。' : `或者点右边「显示已淡忘 ${nForgot}」把淡忘的也搜进来。`),
        h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, `当前可搜 ${pool.length} 条（全部 ${all.length} 条，淡忘 ${nForgot} 条）`),
      );
      return;
    }
    resultCard.append(
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:4px' }, `「${state.starQ.trim()}」命中 ${lastHits.length} 条（按重要度排；回车飞第一条）`),
      ...lastHits.map(rowOf),
    );
  };
  function rowOf(r) {
    const meta = STAR_CLARITY[r.clarity] || STAR_CLARITY.fuzzy;
    return h('div', { style: 'display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line)' },
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { style: 'font-size:13.5px;color:#e6efff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
          (r.pinned ? '★ ' : '') + (r.title || '(无标题)')),
        h('div', { class: 'muted', style: 'font-size:12px;line-height:1.6;margin-top:2px' }, snip(r, String(state.starQ || '').trim().toLowerCase())),
        h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:3px' },
          `${String(r.lastSeenAt || r.createdAt || '').replace('T', ' ').slice(0, 16)} · ● ${meta.cn} · 重要度 ${r.importance}` + (r.forgotten ? ' · 已淡忘' : '')),
      ),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end' },
        h('button', {
          class: 'btn ghost', style: 'font-size:12px;padding:4px 9px', title: '在星海里飞过去看这条',
          onclick: () => {
            const hit = pts.find((o) => o.r && o.r.id === r.id);
            if (hit) { starSel = hit; flyTarget(); renderDetail(); }
            else toast('这条不在当前星图里（可能被筛选或淡忘了）', 3000);
          },
        }, '定位'),
        h('button', {
          class: 'btn ghost', style: 'font-size:12px;padding:4px 9px',
          onclick: () => doPost('/api/mem/pin', { id: r.id, pinned: !r.pinned }),
        }, r.pinned ? '取消钉住' : '钉住'),
        r.forgotten ? null : h('button', {
          class: 'btn ghost', style: 'font-size:12px;padding:4px 9px',
          onclick: () => { if (confirm('放进暂存区（30 天内可恢复）。确定？')) doPost('/api/mem/forget', { id: r.id }); },
        }, '忘掉'),
      ));
  }
  paintResults();

  // ——— 渲染 ———
  let hover = null, dragging = false, lastX = 0, lastY = 0, moved = 0, lastProj = [];
  const flyTarget = () => {
    if (!starSel) return;
    const p = starSel.p;
    const rp = Math.hypot(p.x, p.z) || 1;
    starCam.yawT = Math.atan2(p.x, -p.z);
    starCam.pitchT = Math.max(-1.1, Math.min(1.1, -Math.atan2(p.y, rp)));
    starCam.distT = 1.55;
  };

  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(320, Math.round(rect.width));
    const H = Math.round(rect.height || 620);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const bgc = starBackdrop(W, H);
    const drift = Math.sin(performance.now() * 0.00005) * 0.012;
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(drift);
    g.drawImage(bgc, -(W / 2) * 1.07, -(H / 2) * 1.07, W * 1.07, H * 1.07);
    g.restore();

    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 22;
    const f = 2.5;
    const cyaw = Math.cos(starCam.yaw), syaw = Math.sin(starCam.yaw);
    const cpit = Math.cos(starCam.pitch), spit = Math.sin(starCam.pitch);
    const q = (state.starQ || '').trim().toLowerCase();
    const flowMul = (p) => 1 + starFlow * (0.62 * (p.age - 0.35));

    const proj = [];
    for (const p of pts) {
      const m = flowMul(p);
      let x = p.x * m, y = p.y * m, z = p.z * m;
      const x1 = x * cyaw + z * syaw;
      const z1 = -x * syaw + z * cyaw;
      const y1 = y * cpit - z1 * spit;
      const z2 = y * spit + z1 * cpit;
      const zc = z2 + starCam.dist;
      if (zc < 0.08) continue;
      const s = f / zc;
      const cutT = starCutoff();
      const ok = (!q || (p.r.title + ' ' + p.r.text + ' ' + (p.r.tags || []).join(' ')).toLowerCase().includes(q))
        && ((Date.parse(p.r.createdAt || p.r.lastSeenAt || '') || 0) <= cutT)
        && (!state.starTag || (p.r.tags || []).includes(state.starTag))
      && (state.starOnly !== 'display' || p.r.displayOnly)
      && (state.starOnly !== 'pinned' || p.r.pinned)
      && (state.starOnly !== 'week' || (Date.now() - (Date.parse(p.r.lastSeenAt || p.r.createdAt || '') || 0) <= 7 * 864e5))
      && (!state.starGroup || String(p.r.groupId || '') === String(state.starGroup));
      proj.push({
        p, s, z: zc, ok,
        sx: cx + x1 * R * s * 0.62,
        sy: cy + y1 * R * s * 0.62,
        color: p.r.displayOnly ? '#7f95bb' : (p.r.pinned ? '#ffd479' : (STAR_CLARITY[p.r.clarity] || STAR_CLARITY.fuzzy).color), // 钉住=金色恒星；只展示=灰蓝
      });
    }
    proj.sort((a, b) => b.z - a.z);

    // ——— 连线：低透明度弯曲 + 沿线流光 ———
    const th = starTheme();
    const idx = new Map(proj.map((o) => [o.p, o]));
    const tNow = performance.now();
    const focusOn = (o) => (starSel && starSel.p === o.p) || (hover && hover.p === o.p);
    const anyFocus = !!(starSel || hover);

    g.globalCompositeOperation = 'lighter';
    const flows = [];
    for (const [a, b] of edges) {
      const pa = idx.get(a), pb = idx.get(b);
      if (!pa || !pb) continue;
      const depth = Math.max(0, Math.min(1, (6.4 - (pa.z + pb.z) / 2) / 5.0));
      const dx = pb.sx - pa.sx, dy = pb.sy - pa.sy;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(54, len * 0.2) * (starHash((a.r.id || '') + (b.r.id || '')) - 0.5) * 2;
      const cxp = (pa.sx + pb.sx) / 2 - (dy / len) * bow;
      const cyp = (pa.sy + pb.sy) / 2 + (dx / len) * bow;
      g.strokeStyle = `rgba(${th.edge},${(0.045 + depth * 0.085).toFixed(3)})`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(pa.sx, pa.sy); g.quadraticCurveTo(cxp, cyp, pb.sx, pb.sy); g.stroke();
      if (depth > 0.42 && flows.length < 80) {
        flows.push({ pa, pb, cxp, cyp, ph: starHash((b.r.id || '') + 'f'), sp: 0.6 + starHash((a.r.id || '') + 's') });
      }
    }
    for (const fp of flows) {
      const t = (tNow * 0.00006 * fp.sp + fp.ph) % 1;
      const it = 1 - t;
      const x = it * it * fp.pa.sx + 2 * it * t * fp.cxp + t * t * fp.pb.sx;
      const y = it * it * fp.pa.sy + 2 * it * t * fp.cyp + t * t * fp.pb.sy;
      g.globalAlpha = 0.34 * Math.sin(Math.PI * t);
      g.fillStyle = th.accent;
      g.beginPath(); g.arc(x, y, 1.1, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // ——— 星星：按重要度分层 + 缓慢漂浮 ———
    const starClock = tNow;
    for (const o of proj) {
      const r = o.p.r;
      const depth = Math.max(0, Math.min(1, (6.4 - o.z) / 5.0));
      const imp = Math.max(0, Math.min(100, r.importance || 0));
      const core = Math.pow(imp / 100, 0.85);
      const rad = (0.5 + Math.pow(core, 1.3) * 4.6 + Math.min(1.6, (r.recall || 0) * 0.03)) * (0.55 + o.s * 0.5);
      if (rad < 0.4) continue;
      const ph = (o.p.tw || 0) * 6.283;
      const sx = o.sx + Math.sin(starClock * 0.00033 + ph) * 2.4;
      const sy = o.sy + Math.cos(starClock * 0.00026 + ph * 1.6) * 2.8;
      const tw = 0.78 + 0.22 * Math.sin(starClock * 0.0015 + ph);
      const dim = anyFocus && !focusOn(o) ? 0.3 : 1;
      const alpha = (o.ok ? (0.62 + depth * 0.38) * tw : 0.05) * (0.55 + depth * 0.45) * dim;
      const size = Math.max(8, rad * 3.3);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = alpha * 0.9;
      g.drawImage(starSprite(o.color), sx - size / 2, sy - size / 2, size, size);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = Math.min(1, alpha + 0.32);
      g.fillStyle = o.color;
      g.beginPath(); g.arc(sx, sy, Math.max(0.6, rad * 0.5), 0, Math.PI * 2); g.fill();
      if (rad > 2.1) {
        g.globalAlpha = Math.min(0.85, alpha + 0.15);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(sx, sy, Math.max(0.5, rad * 0.17), 0, Math.PI * 2); g.fill();
      }
      if (r.pinned) {
        g.globalAlpha = (o.ok ? 0.95 : 0.15) * dim;
        g.strokeStyle = '#ffd479'; g.lineWidth = 1.2;
        g.beginPath(); g.arc(sx, sy, Math.max(2.2, rad * 0.9) + 2.2, 0, Math.PI * 2); g.stroke();
      }
      if (q && o.ok) {
        g.globalAlpha = 0.5 + 0.25 * Math.sin(starClock * 0.004);
        g.strokeStyle = th.accent; g.lineWidth = 1.2;
        g.beginPath(); g.arc(sx, sy, Math.max(3, rad * 0.9) + 4.5, 0, Math.PI * 2); g.stroke();
      }
      if (focusOn(o)) {
        g.globalAlpha = 1;
        g.strokeStyle = starSel && starSel.p === o.p ? '#ffffff' : '#cfe2ff';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(sx, sy, Math.max(3.2, rad * 0.9) + 5, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.28)';
        g.beginPath(); g.arc(sx, sy, Math.max(3.2, rad * 0.9) + 9.5, 0, Math.PI * 2); g.stroke();
      }
    }
    g.globalAlpha = 1;

    // ——— 文字标签：只标重点 ———
    const labelSet = [];
    for (const o of proj) {
      if (!o.ok) continue;
      const isSel = starSel && starSel.p === o.p;
      const isHover = hover && hover.p === o.p;
      if (!isSel && !isHover && !(o.p.r.pinned && starCam.dist < 3.4) && !q) continue;
      labelSet.push({ o, strong: isSel || isHover });
      if (labelSet.length >= 12) break;
    }
    g.textBaseline = 'middle';
    try { g.letterSpacing = '0.4px'; } catch (e) { /* 老浏览器忽略 */ }
    for (const { o, strong } of labelSet) {
      const t = String(o.p.r.title || o.p.r.text || '').replace(/\s+/g, ' ').slice(0, 18);
      if (!t) continue;
      g.font = `${strong ? '600 ' : '500 '}${strong ? 12.5 : 11.5}px "Cascadia Mono", Consolas, ui-monospace, "Microsoft YaHei", sans-serif`;
      const tw2 = g.measureText(t).width;
      const lx = o.sx + 8, ly = o.sy - 12;
      g.globalAlpha = strong ? 0.96 : 0.72;
      g.fillStyle = 'rgba(5,9,18,0.55)';
      g.fillRect(lx - 4, ly - 8, tw2 + 8, 16);
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 5;
      g.fillStyle = strong ? '#ffffff' : 'rgba(214,230,255,0.95)';
      g.fillText(t, lx, ly);
      g.restore();
    }
    g.globalAlpha = 1;

    const n = proj.filter((o) => o.ok).length;
    const cnt = $('#starcount');
    if (cnt) cnt.textContent = q ? `命中 ${n} / ${proj.length}` : `${proj.length} 颗星`;
    zoomTag.textContent = `视野 ${Math.round((2.45 / starCam.dist) * 100)}%`;
    return proj;
  };

  const loop = () => {
    const id = ++starAnim;
    const tick = () => {
      if (id !== starAnim || !document.body.contains(canvas)) return;
      // 目标缓动（飞行 / 复位 / 滚轮）
      if (starCam.yawT != null) {
        starCam.yaw += (starCam.yawT - starCam.yaw) * 0.12;
        if (Math.abs(starCam.yawT - starCam.yaw) < 0.002) { starCam.yaw = starCam.yawT; starCam.yawT = null; }
      }
      if (starCam.pitchT != null) {
        starCam.pitch += (starCam.pitchT - starCam.pitch) * 0.12;
        if (Math.abs(starCam.pitchT - starCam.pitch) < 0.002) { starCam.pitch = starCam.pitchT; starCam.pitchT = null; }
      }
      starCam.dist += (starCam.distT - starCam.dist) * 0.12;
      if (!dragging && starCam.yawT == null) {
        if (Math.abs(starCam.vx) > 0.00015 || Math.abs(starCam.vy) > 0.00015) {
          starCam.yaw += starCam.vx;
          starCam.pitch = Math.max(-1.2, Math.min(1.2, starCam.pitch + starCam.vy));
          starCam.vx *= 0.93; starCam.vy *= 0.93;
        }
        if (starCam.auto) starCam.yaw += 0.0012;
      }
      const wantFlow = state.starFlow ? 1 : 0;
      starFlow += (wantFlow - starFlow) * 0.06;
      lastProj = draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const pick = (x, y) => {
    let best = null, bd = 17 * 17;
    for (const o of lastProj) {
      if (!o.ok) continue;
      const dd = (o.sx - x) ** 2 + (o.sy - y) ** 2;
      if (dd < bd) { bd = dd; best = o; }
    }
    return best;
  };

  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true; moved = 0; lastX = ev.clientX; lastY = ev.clientY;
    starCam.auto = false; starCam.vx = 0; starCam.vy = 0;
    starCam.yawT = null; starCam.pitchT = null;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture?.(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    if (dragging) {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY;
      lastX = ev.clientX; lastY = ev.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      starCam.yaw += dx * 0.006;
      starCam.pitch = Math.max(-1.2, Math.min(1.2, starCam.pitch + dy * 0.005));
      starCam.vx = dx * 0.0011; starCam.vy = dy * 0.0009;
      return;
    }
    const o = pick(x, y);
    hover = o || null;
    if (o) {
      tip.style.display = 'block';
      tip.style.left = Math.min(rect.width - 220, Math.max(4, x + 14)) + 'px';
      tip.style.top = Math.max(4, y - 12) + 'px';
      tip.textContent = (o.p.r.title || o.p.r.text || '').slice(0, 70);
      canvas.style.cursor = 'pointer';
    } else {
      tip.style.display = 'none';
      canvas.style.cursor = 'grab';
    }
  });
  const endDrag = (ev) => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'grab';
    if (moved < 6) {
      const rect = canvas.getBoundingClientRect();
      const o = pick(ev.clientX - rect.left, ev.clientY - rect.top);
      if (o) { starSel = o; flyTarget(); renderDetail(); detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('pointerleave', () => { tip.style.display = 'none'; hover = null; });
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const k = ev.deltaY > 0 ? 1.16 : 1 / 1.16;
    starCam.distT = Math.max(0.55, Math.min(16, starCam.distT * k));
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { starCam.distT = 3.0; starCam.yawT = 0.6; starCam.pitchT = -0.22; });

  loop();
  return wrap;
}

let memLoading = false, memFails = 0;
// 记忆走 lite（正文截断到 240 字），体积从 210KB 降到几十 KB；全文按需再取。
async function loadMem() {
  if (memLoading) return state.mem;
  memLoading = true;
  try {
    state.mem = await api('/api/mem?lite=1');
    state.mood = (state.mem && state.mem.mood) || state.mood; // MOODBUBBLE_UI：气泡图要用
    memFails = 0;
    state.memError = '';
    state.memGaveUp = false;
  } catch (e) {
    memFails += 1;
    state.memError = (e && e.message) || '读取失败';
    if (memFails >= 2) state.memGaveUp = true;
    throw e;
  } finally {
    memLoading = false;
  }
  return state.mem;
}
// 只有真正需要时才拉一次；失败两次就停下来给按钮，避免无限重试把页面卡死
function kickMem() {
  if (state.mem || memLoading || state.memGaveUp) return;
  loadMem().then(() => rerender()).catch(() => { if (state.memGaveUp) rerender(); });
}

function pageMemHealth() {
  const wrap = h('div', {});
  if (!state.mem) {
    if (state.memGaveUp) {
      wrap.append(h('div', { class: 'card mh-empty' },
        h('div', { class: 'mh-empty-ico' }, '🫧'),
        h('h3', {}, '记忆没能读出来'),
        h('div', { class: 'muted', style: 'margin-bottom:14px' }, state.memError || '网络或服务那边慢了一下，重试通常就好。'),
        h('button', {
          class: 'btn',
          onclick: () => { state.memGaveUp = false; memFails = 0; loadMem().then(() => rerender()).catch(() => rerender()); },
        }, '重新读一次')));
      return wrap;
    }
    kickMem();
    wrap.append(h('div', { class: 'card muted' }, '正在读记忆…'));
    return wrap;
  }

  const d = state.mem;
  const cap = d.cap || { records: 1500, pinned: 20 };
  const records = d.records || [];
  const trash = records.filter((r) => r.forgotten);
  const pinnedRecs = records.filter((r) => r.pinned);
  const pairs = d.pairs || [];
  const PURGE_DAYS = 30;
  const daysLeft = (t) => Math.max(0, PURGE_DAYS - Math.floor((Date.now() - new Date(t || 0).getTime()) / 86400000));

  // 操作后只重拉数据、不丢滚动位置（老版整页重绘会跳回顶部）
  const refresh = async (note) => {
    const y = window.scrollY;
    try { await loadMem(); } catch (e) { /* 保留旧数据 */ }
    rerender();
    requestAnimationFrame(() => window.scrollTo(0, y));
    if (note) toast(note);
  };

  const pct = Math.min(100, (Number(d.total || 0) / Math.max(1, cap.records)) * 100);
  const pinPct = Math.min(100, (Number(d.pinned || 0) / Math.max(1, cap.pinned)) * 100);

  const kpi = (title, big, sub, bar, barCls) => h('div', { class: 'card mh-kpi' },
    h('div', { class: 'mh-kpi-t' }, title),
    h('div', { class: 'big' }, big, sub ? h('small', {}, sub) : null),
    bar == null ? null : h('div', { class: 'bar', style: 'margin-top:10px' }, h('i', { class: barCls || '', style: 'width:' + bar.toFixed(1) + '%' })),
  );

  wrap.append(h('div', { class: 'mh-kpis' },
    kpi('条数', String(d.total || 0), ' / ' + cap.records, pct),
    kpi('钉住', String(d.pinned || 0), ' / ' + cap.pinned, pinPct, 'mh-bar-warn'),
    kpi('相似记忆', String(pairs.length), ' 对', null),
    kpi('已淡忘', String(d.forgotten || 0), ' 条（可恢复）', null),
  ));

  // 清晰度分布（接口早就返回 byClarity，旧页面没用上）
  const CLARITY_MERGE = new Map();
  for (const [k, n] of Object.entries(d.byClarity || {})) {
    const label = (({ vivid: '清晰', clear: '清晰', '清晰': '清晰', fuzzy: '模糊', vague: '模糊', lost: '模糊', unknown: '未标' })[k]) || k;
    CLARITY_MERGE.set(label, (CLARITY_MERGE.get(label) || 0) + n);
  }
  const clarity = [...CLARITY_MERGE.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxClarity = Math.max(1, ...clarity.map((x) => x[1]));
  wrap.append(h('div', { class: 'grid g2', style: 'margin-bottom:12px' },
    h('div', { class: 'card' },
      h('h3', {}, '清晰度分布'),
      clarity.length
        ? h('div', {}, ...clarity.map(([k, n]) => h('div', { class: 'mh-line' },
          h('span', { class: 'mh-line-t', title: k }, k),
          h('div', { class: 'mh-line-bar' }, h('i', { style: 'width:' + ((n / maxClarity) * 100).toFixed(1) + '%' })),
          h('span', { class: 'mh-line-n' }, String(n)))))
        : h('div', { class: 'muted' }, '还没有清晰度数据。'),
      h('div', { class: 'mh-note' }, '模糊条目突然变多，通常说明「忘记」在加速，可以去「记忆与情绪」调 memoryCard.clarify。')),
    h('div', { class: 'card' },
      h('h3', {}, '近 8 周新增'),
      (d.older ? h('div', { class: 'mh-note', style: 'margin:-4px 0 6px' }, '另有 ' + d.older + ' 条更早的记忆（B 站旧动态），没算进这 8 周') : null),
      h('div', { class: 'mh-weeks' }, ...(d.weeks || []).map((w) => {
        const maxAdd = Math.max(1, ...(d.weeks || []).map((x) => x.added));
        return h('div', { class: 'mh-wk', title: w.week + ' 新增 ' + w.added + (w.forgotten ? ' / 淡忘 ' + w.forgotten : '') },
          h('div', { class: 'mh-wk-n' + (w.added ? '' : ' zero') }, String(w.added)),
          h('div', { class: 'mh-wk-bar' }, h('i', { style: 'height:' + (w.added ? Math.max(8, (w.added / maxAdd) * 100) : 2) + '%' })),
          h('div', { class: 'mh-wk-x' }, String(w.week || '').slice(5)));
      })),
    ),
  ));

  const tags = Object.entries(d.byTag || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const maxTag = Math.max(1, ...tags.map((t) => t[1]));
  const totalTag = tags.reduce((s, t) => s + t[1], 0) || 1;
  wrap.append(h('div', { class: 'card', style: 'margin-bottom:12px' },
    h('h3', {}, '标签分布（前 12）'),
    tags.length
      ? h('div', {}, ...tags.map(([t, n]) => h('div', { class: 'mh-line' },
        h('span', { class: 'mh-line-t', title: t }, t),
        h('div', { class: 'mh-line-bar' }, h('i', { class: 'mh-tag-bar', style: 'width:' + ((n / maxTag) * 100).toFixed(1) + '%' })),
        h('span', { class: 'mh-line-n' }, String(n)),
        h('span', { class: 'mh-line-p' }, Math.round((n / totalTag) * 100) + '%'))))
      : h('div', { class: 'muted' }, '还没有标签。'),
  ));

  // 暂存区
  wrap.append(h('div', { class: 'card', style: 'margin-bottom:12px' },
    h('div', { class: 'mh-head' },
      h('h3', { style: 'margin:0' }, '暂存区 · ' + trash.length + ' 条'),
      trash.length
        ? h('button', {
            class: 'btn ghost mh-btn',
            onclick: async () => {
              if (!confirm('清理 30 天以前的暂存记忆（不可恢复）？')) return;
              const out = await api('/api/mem/purge', { method: 'POST', body: { olderThanDays: PURGE_DAYS } });
              if (!out.ok) { toast(out.error || '清理失败'); return; }
              await refresh('清理了 ' + out.removed + ' 条');
            },
          }, '清理 30 天前的')
        : null),
    h('div', { class: 'mh-note', style: 'margin:4px 0 8px' },
      trash.length ? '忘掉不等于删除：先在这里放 30 天，可以随时恢复或彻底删除。' : '暂存区是空的，忘掉的东西会先落到这里。'),
    ...trash.slice(0, 40).map((r) => h('div', { class: 'mh-row' },
      h('div', { class: 'mh-row-main' },
        h('div', { class: 'mh-row-t' }, String(r.title || r.text || '').slice(0, 56)),
        state.peekId === r.id
          ? h('div', { class: 'mh-pre' }, state.peekText || '读原文中…')
          : null),
      h('span', { class: 'mh-chip mh-chip-warn' }, '剩 ' + daysLeft(r.forgottenAt) + ' 天'),
      h('button', {
        class: 'btn ghost mh-btn',
        onclick: async () => {
          if (state.peekId === r.id) { state.peekId = null; rerender(); return; }
          state.peekId = r.id; state.peekText = ''; rerender();
          const out = await api('/api/mem/item?id=' + encodeURIComponent(r.id));
          state.peekText = out.ok ? (out.record.text || '(这条没有正文)') : (out.error || '读不出来');
          rerender();
        },
      }, state.peekId === r.id ? '收起' : '看原文'),
      h('button', {
        class: 'btn ghost mh-btn',
        onclick: async () => {
          const out = await api('/api/mem/forget', { method: 'POST', body: { id: r.id, restore: true } });
          if (!out.ok) { toast(out.error || '恢复失败'); return; }
          await refresh('已恢复 1 条');
        },
      }, '恢复'),
      h('button', {
        class: 'btn ghost mh-btn mh-danger',
        onclick: async () => {
          if (!confirm('彻底删除，不可恢复。确定？')) return;
          const out = await api('/api/mem/purge', { method: 'POST', body: { id: r.id } });
          if (!out.ok) { toast(out.error || '删除失败'); return; }
          await refresh('已删除');
        },
      }, '彻底删除'),
    )),
  ));

  // 已钉住
  wrap.append(h('div', { class: 'card', style: 'margin-bottom:12px' },
    h('div', { class: 'mh-head' },
      h('h3', { style: 'margin:0' }, '已钉住 ' + pinnedRecs.length + ' / ' + cap.pinned),
      h('span', { class: 'mh-note', style: 'margin:0' }, '钉住 = 不会被淡忘、也不参与自动合并')),
    pinnedRecs.length
      ? h('div', {}, ...pinnedRecs.map((r) => h('div', { class: 'mh-row' },
        h('span', { class: 'mh-star' }, '★'),
        h('div', { class: 'mh-row-main' }, h('div', { class: 'mh-row-t' }, String(r.title || r.text || '').slice(0, 60))),
        h('button', {
          class: 'btn ghost mh-btn',
          onclick: async () => {
            const out = await api('/api/mem/pin', { method: 'POST', body: { id: r.id, pinned: false } });
            if (!out.ok) { toast(out.error || '操作失败'); return; }
            await refresh('已取消钉住');
          },
        }, '取消钉住'))))
      : h('div', { class: 'muted', style: 'margin-top:8px' }, '现在没有钉住的记忆。去「记忆星海」，点列表里的「☆ 钉住」就能钉。'),
  ));

  // 相似记忆
  const doMerge = async (keep, drop) => {
    const out = await api('/api/mem/merge', { method: 'POST', body: { keep, drop } });
    if (!out.ok) { toast(out.error || '合并失败'); return; }
    await refresh('已合并 1 对');
  };
  const hotPairs = pairs.filter((p) => p.sim >= 0.85).length;
  wrap.append(h('div', { class: 'card' },
    h('div', { class: 'mh-head' },
      h('h3', { style: 'margin:0' }, '相似记忆 · ' + pairs.length + ' 对'),
      hotPairs ? h('button', {
        class: 'btn mh-btn',
        onclick: async () => {
          if (!confirm('会把 ' + hotPairs + ' 对相似度 ≥0.85 的记忆自动合并（保留重要的那条，另一条淡忘，可恢复）。继续？')) return;
          const out = await api('/api/mem/merge-auto', { method: 'POST', body: { minSim: 0.85, max: 20 } });
          if (!out.ok) { toast(out.error || '合并失败'); return; }
          await refresh('已合并 ' + out.merged + ' 对');
        },
      }, '一键合并 ≥0.85（' + hotPairs + ' 对）') : null),
    h('div', { class: 'mh-note', style: 'margin:4px 0 8px' }, '「合并」= 保留一条，把另一条作为补充记进去；被并的那条会进暂存区，可恢复。'),
    pairs.length
      ? h('div', {}, ...pairs.slice(0, 30).map((p) => h('div', { class: 'mh-pair' },
        h('div', { class: 'mh-pair-h' },
          h('span', { class: 'mh-chip mh-chip-ok' }, '相似度 ' + p.sim.toFixed(2)),
          h('span', { class: 'mh-note', style: 'margin:0' }, (p.a.clarity || '未标') + ' / ' + (p.b.clarity || '未标'))),
        h('div', { class: 'mh-pair-g' },
          h('div', {}, h('b', {}, 'A  '), p.a.title || String(p.a.text || '').slice(0, 80)),
          h('div', {}, h('b', {}, 'B  '), p.b.title || String(p.b.text || '').slice(0, 80))),
        h('div', { style: 'margin-top:8px' },
          h('button', { class: 'btn mh-btn', style: 'margin-right:8px', onclick: () => doMerge(p.a.id, p.b.id) }, '合并（保留 A）'),
          h('button', { class: 'btn ghost mh-btn', onclick: () => doMerge(p.b.id, p.a.id) }, '合并（保留 B）')))))
      : h('div', { class: 'muted', style: 'margin-top:8px' }, '没有发现高度相似的记忆 👍'),
  ));

  return wrap;
}


function activeWindowText() {
  const items = (state.aw && state.aw.items) || [];
  if (!items.length) return '活跃期：当前没有会话处于活跃期';
  const names = (state.names && state.names.groups) || {};
  return '活跃期：' + items.map((x) => {
    const gid = String(x.key || '').replace('group:', '');
    const nm = (names[gid] && names[gid].name) || gid;
    return nm + ' 剩 ' + x.minutesLeft + ' 分钟';
  }).join(' · ');
}

function pageSafe() {
  if (!state.names) loadNames().catch(() => {}).finally(rerender); // 群号旁边显示名字
  const wrap = h('div', {});
  // SAFE_JUMP（B 批）：本页四块内容很长，顶部给一个「跳到本页」下拉
  const _jump = h('select', { class: 'input', style: 'max-width:260px;margin-bottom:10px', onchange: (e) => {
    const label = e.target.value;
    if (!label) return;
    const nodes = [...document.querySelectorAll('#view h3, #view .card-h')];
    const hit = nodes.find((n) => String(n.textContent || '').includes(label));
    if (hit) hit.scrollIntoView({ behavior: 'smooth', block: 'start' });
    e.target.value = '';
  } },
    h('option', { value: '' }, '跳到本页：省钱模式 / 群频率 / 敏感词 / 按群规则'),
    h('option', { value: '省钱' }, '省钱模式'),
    h('option', { value: '频率' }, '群频率'),
    h('option', { value: '敏感' }, '敏感词'),
    h('option', { value: '按群规则' }, '按群规则'),
  );
  wrap.append(_jump);
  // PRESET_CARD（E-3）：三档总览 = 把常用调整翻译成现有配置；底层 7 道闸门不动
  try {
    if (!state.preset) api('/api/preset').then((r) => { if (r && r.ok) { state.preset = r; rerender(); } }).catch(() => {});
    const MODE_LABEL = { normal: '正常聊', called: '只听叫我', watch: '只看不说' };
    const ACT_LABEL = { quiet: '安静', normal: '正常', active: '热闹' };
    const pst = state.preset;
    const rows = ((pst && pst.groups) || []).map((g) => {
      const mk = h('select', { class: 'input', style: 'max-width:120px', onchange: async (e) => {
        await api('/api/preset', { method: 'POST', body: { group: g.gid, mode: e.target.value } });
        state.preset = null; state.gr = null; state.attnCfg = null; state.attnLoaded = false; rerender();
      } }, Object.keys(MODE_LABEL).map((k) => h('option', { value: k, selected: g.mode === k ? 'selected' : null }, MODE_LABEL[k])));
      const ak = h('select', { class: 'input', style: 'max-width:110px', onchange: async (e) => {
        await api('/api/preset', { method: 'POST', body: { group: g.gid, activity: e.target.value } });
        state.preset = null; state.gr = null; state.attnCfg = null; state.attnLoaded = false; rerender();
      } }, Object.keys(ACT_LABEL).map((k) => h('option', { value: k, selected: g.activity === k ? 'selected' : null }, ACT_LABEL[k])));
      const name = state.names && state.names.groups && state.names.groups[g.gid] ? state.names.groups[g.gid].name : g.gid;
      return h('div', { class: 'rg-row', style: 'grid-template-columns:220px 130px 120px 1fr' }, [
        h('div', {}, [h('div', { class: 'mono' }, name), h('div', { class: 'muted', style: 'font-size:12px' }, g.gid)]),
        mk, ak,
        h('div', { class: 'muted' }, `今天自动发言 ${g.count || 0}/${g.maxPerDay || 0} 次 · 间隔 ${Math.round((g.minGapMs || 0) / 60000)} 分钟`),
      ]);
    });
    wrap.append(h('div', { class: 'card' }, [
      h('div', { class: 'card-h' }, '三档总览（快捷预设）'),
      h('div', { class: 'muted', style: 'margin:6px 0 10px' }, '两个下拉批量改现有设置，保存即生效。群模式：正常聊 = 解除静音 + 关学习；只听叫我 = 开静音（你 @ 她或叫名字才回，别人找她不回）；只看不说 = 开学习。活跃度：安静 / 正常 / 热闹 = 频率档位 + 抽样比例。'),
      ...rows,
      h('div', { class: 'muted', style: 'margin-top:8px' }, `全局日花费上限：${pst && pst.dailyLimit != null ? '¥' + pst.dailyLimit : '未单独设置（默认 ¥8）'}`),
      h('div', { class: 'muted', style: 'margin-top:6px;font-size:12px' }, '说明：「只听叫我」下，只有你（主人）亲自 @ 她或叫名字会回；群友 @ 她、普通聊天、问句都不回。'),
      h('div', { class: 'muted', style: 'margin-top:6px;font-size:12px' }, '底层设置仍可在下方单独调整，快捷预设只是批量修改。'),
    ]));
  } catch (e) {}

  if (!state.access) loadAccess().catch(() => {}).finally(rerender); // 频率卡要按白名单群列出来
  if (!state.style) { /* 复用已有加载器无所谓 */ }
  const load = async () => {
    const [gr, safe, econ, aw] = await Promise.all([
      api('/api/gr').catch(() => null),
      api('/api/safe').catch(() => null),
      api('/api/econ').catch(() => null),
      api('/api/active-window').catch(() => null),
    ]);
    state.gr = gr || { levels: {}, rates: [] };
    state.safe = safe || { cfg: {}, modes: {}, alerts: [], sessions: [] };
    state.econ = econ || { mode: 'auto', modes: {}, groups: [], autoOn: false };
    state.aw = aw || { items: [] };
    rerender();
  };
  if (!state.gr || !state.safe) {
    wrap.append(h('div', { class: 'card muted' }, '正在读频率与安全设置…'));
    if (!state.safeLoading) { state.safeLoading = true; load().catch(() => {}).finally(() => { state.safeLoading = false; }); }
      // ATTN-CARD：按群规则（只回谁 / 抽样%）
  try {
    const gs = (state.access && state.access.groups) || [];
    if (!state.attnGid && gs.length) state.attnGid = gs[gs.length - 1];
    const sel = h('select', { class: 'input', style: 'max-width:240px', onchange: (e) => { state.attnGid = e.target.value; state.attnLoaded = false; rerender(); } },
      gs.map((g) => h('option', { value: g, selected: state.attnGid === g ? 'selected' : null }, g + (state.names && state.names.groups && state.names.groups[g] ? ' · ' + state.names.groups[g].name : ''))));
    if (!state.attnLoaded) {
      state.attnLoaded = true;
      api('/api/attn-get').then((r) => { if (r && r.ok) { state.attnCfg = r; } }).catch(() => {});
    }
    const cur = (state.attnCfg && state.attnCfg.replyOnly && state.attnCfg.replyOnly[state.attnGid]) || [];
    const smp = (state.attnCfg && state.attnCfg.sample && state.attnCfg.sample[state.attnGid]) || 0;
    const replyIn = h('input', { class: 'input', style: 'max-width:320px', value: cur.join(','), placeholder: '只回这些 QQ，逗号分隔；留空 = 都能回' });
    const smpIn = h('input', { class: 'input', style: 'max-width:100px', value: String(smp), placeholder: '%' });
    wrap.append(h('div', { class: 'card' }, [
      h('div', { class: 'card-h' }, '按群规则（只回谁 / 抽样唤醒）'),
      h('div', { class: 'muted', style: 'margin:6px 0 10px' }, '只回谁：名单里的人说话才接（其他人 @ 也不回）；抽样：平时被判定"不值得回"的消息里，按这个百分比随机接一句（0 = 不抽）。改完需要重启桥接生效。'),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' }, [
        sel,
        h('span', { class: 'muted' }, '只回：'), replyIn,
        h('span', { class: 'muted' }, '抽样：'), smpIn,
        h('button', { class: 'btn primary', onclick: async () => {
          const r = await api('/api/attn-set', { method: 'POST', body: { group: state.attnGid, replyOnly: replyIn.value, sample: smpIn.value } });
          if (r && r.ok) { state.attnCfg = null; state.attnLoaded = false; rerender(); }
        } }, '保存'),
      ]),
    ]));
  } catch (e) {}

  return wrap;
  }
  const gr = state.gr, safe = state.safe, cfg = safe.cfg || {}, modes = safe.modes || {};
  const groups = (state.access?.groups || []);

  const econ = state.econ || { mode: 'auto', modes: {}, groups: [], autoOn: false };
  const ecoMap = Object.fromEntries((econ.groups || []).map((x) => [x.gid, x.on]));
  const setEco = async (body) => {
    try {
      const r = await api('/api/econ', { method: 'POST', body });
      state.econ = r || state.econ;
      rerender();
      toast('省钱设置已更新（立刻生效）');
    } catch (e) { toast('没改成：' + e.message, 3800); }
  };
  const setLevel = async (gid, level) => {
    try {
      const r = await api('/api/gr', { method: 'POST', body: { action: 'set', group: gid, level } });
      state.gr = { levels: gr.levels, rates: r.rates || [] };
      rerender();
      toast('群 ' + gid + ' → ' + ((gr.levels || {})[level]?.label || level) + '（立刻生效）');
    } catch (e) { toast('没改成：' + e.message, 3800); }
  };
  const rateOf = (gid) => (gr.rates || []).find((x) => x.gid === gid);

  // 省钱模式（少说话）
  wrap.append(h('div', { class: 'card', style: 'margin-bottom:12px' },
    h('h3', {}, '省钱模式（少说话）'),
    h('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      '开着的时候，她在群里只回「@ 她」和你的手动指令；主动搭话、超时追问、历史补看全部跳过，私聊不受影响。'
      + '整体设一档，也能单独给某个群开/关。立刻生效，不用重启。'),
    h('div', { class: 'rg-seg' }, ...Object.entries(econ.modes || {}).map(([k, v]) =>
      h('button', {
        class: 'btn' + (econ.mode === k ? '' : ' ghost'),
        title: v.hint,
        onclick: () => setEco({ action: 'set', mode: k }),
      }, v.label))),
    h('div', { class: 'rg-hint', style: 'margin-top:6px' }, (econ.modes || {})[econ.mode]?.hint || ''),
    h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' },
      '按花费自动降级：' + (econ.autoOn ? '已触发（花到降级线）' : '未触发')),
    h('div', { style: 'display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap' },
      h('b', { style: 'font-size:13px' }, '省钱时：'),
      h('div', { class: 'rg-seg' },
        h('button', {
          class: 'btn' + (econ.replyAt !== false ? '' : ' ghost'),
          onclick: () => setEco({ action: 'setreply', replyAt: true }),
        }, '还回 @'),
        h('button', {
          class: 'btn' + (econ.replyAt === false ? '' : ' ghost'),
          onclick: () => setEco({ action: 'setreply', replyAt: false }),
        }, '完全不发'),
      ),
      h('span', { class: 'muted', style: 'font-size:12px' },
        econ.replyAt === false
          ? '省钱期间一个人在群里 @ 她也不回，只认你手动让她说话'
          : '省钱期间有人 @ 她、你手动让她说话，她照常回'),
    ),
  ));

  // 群频率
  const rows = groups.length ? groups : [...new Set((gr.rates || []).map((x) => x.gid))];
  wrap.append(h('div', { class: 'card' },
    h('h3', {}, '群发言频率'),
    h('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      '每个群单独一档，控制她在这个群「被叫醒接话」的密度和成本。立刻生效，不用重启。'
      + '你手动让她说话、管理员指令、学说法任务都不占额度。'),
    h('div', { class: 'rg-list' }, ...rows.map((gid) => {
      const r = rateOf(gid);
      const lv = r?.level || 'normal';
      const lvDef = (gr.levels || {})[lv] || {};
      return h('div', { class: 'rg-row' },
        h('div', { class: 'rg-gid', title: gid }, gid,
          h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:2px' }, (typeof nameOf === 'function' ? nameOf('group', gid) : '') || '')),
        h('div', { class: 'rg-seg' }, ...Object.entries(gr.levels || {}).map(([k, v]) =>
          h('button', {
            class: 'btn' + (lv === k ? '' : ' ghost'),
            title: v.hint,
            onclick: () => setLevel(gid, k),
          }, v.label))),
        h('div', { class: 'rg-hint rg-slide' },
          h('input', { id: 'rg-min-' + gid, type: 'range', min: 0, max: 120, step: 1,
            value: String(r?.custom?.minGapMin ?? Math.round((lvDef.minGapMs || 360000) / 60000)),
            style: 'width:104px;vertical-align:middle',
            oninput: (e) => { const l = $('#rg-minv-' + gid); if (l) l.textContent = e.target.value; } }),
          h('span', { id: 'rg-minv-' + gid, class: 'mono', style: 'font-size:12px;min-width:20px;display:inline-block;text-align:right' },
            String(r?.custom?.minGapMin ?? Math.round((lvDef.minGapMs || 360000) / 60000))),
          h('span', { class: 'muted', style: 'font-size:12px;margin:0 6px' }, '分钟 / 每天'),
          h('input', { id: 'rg-day-' + gid, type: 'range', min: 1, max: 200, step: 1,
            value: String(r?.custom?.perDay ?? lvDef.maxPerDay ?? 40),
            style: 'width:96px;vertical-align:middle',
            oninput: (e) => { const l = $('#rg-dayv-' + gid); if (l) l.textContent = e.target.value; } }),
          h('span', { id: 'rg-dayv-' + gid, class: 'mono', style: 'font-size:12px;min-width:24px;display:inline-block;text-align:right' },
            String(r?.custom?.perDay ?? lvDef.maxPerDay ?? 40)),
          h('span', { class: 'muted', style: 'font-size:12px;margin:0 6px' }, '次'),
          h('button', {
            class: 'btn ghost', style: 'margin-left:4px',
            onclick: async () => { // CUSTOM_RATE：滑块存
              const minGapMin = Number(($('#rg-min-' + gid) || {}).value || 0);
              const perDay = Number(($('#rg-day-' + gid) || {}).value || 0);
              try {
                const j = await api('/api/gr', { method: 'POST', body: { action: 'custom', group: gid, minGapMin, perDay } });
                const back = ((j && j.rates) || []).find((x) => String(x.gid) === String(gid));
                const shown = back && back.custom ? back.custom : { minGapMin, perDay };
                const mi = $('#rg-min-' + gid); const di = $('#rg-day-' + gid);
                if (mi) mi.value = String(shown.minGapMin);
                if (di) di.value = String(shown.perDay);
                const ml = $('#rg-minv-' + gid); const dl = $('#rg-dayv-' + gid);
                if (ml) ml.textContent = String(shown.minGapMin);
                if (dl) dl.textContent = String(shown.perDay);
                toast('已生效：每 ' + shown.minGapMin + ' 分钟最多一次，每天 ' + shown.perDay + ' 次');
                await load();
              } catch (e) { toast('没存上：' + e.message, 3800); }
            },
          }, '存')),
        h('div', { class: 'rg-count' }, r
          ? ('今天 ' + r.count + '/' + r.maxPerDay + ' 次'
             + (r.lastAt ? ' · 最近 ' + new Date(r.lastAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }) : ' · 无') + ' · 间隔 ' + Math.round((r.minGapMs || 0) / 60000) + ' 分钟')
          : '今天自动发言 0 次'),
        h('button', {
          class: 'btn' + (ecoMap[gid] ? '' : ' ghost'),
          style: 'margin-left:8px',
          title: ecoMap[gid] ? '这个群按省钱模式（只回 @）' : '这个群不省钱',
          onclick: () => setEco({ action: 'group', gid, on: ecoMap[gid] ? null : true }),
        }, ecoMap[gid] ? '省钱中' : '省钱'),
      );
    })),
    h('div', { class: 'rg-count', style: 'margin-top:10px' }, activeWindowText()),
  ));

  // 敏感话题
  const saveCfg = async () => {
    try {
      await api('/api/safe', { method: 'POST', body: {
        action: 'setcfg',
        mode: ($('input[name=mode]:checked') || {}).value || cfg.mode,
        hits: Number($('#sf-hits').value || cfg.hits),
        windowMin: Number($('#sf-win').value || cfg.windowMin),
        coolMin: Number($('#sf-cool').value || cfg.coolMin),
      } });
      toast('已写入配置，点「重启桥接」才生效');
      await load();
    } catch (e) { toast('没存上：' + e.message, 3800); }
  };
  wrap.append(h('div', { class: 'card', style: 'margin-top:12px' },
    h('h3', {}, '敏感话题守门（有人反复试探时怎么处理）'),
    h('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:10px' },
      '命中词表：AI/机器人/模型/谁做的/多少钱/住址/账号/借钱…（下面的框里直接改）。'
      + '默认「只记录」，什么都不挡。改完要点「重启桥接」。'),
    h('div', { style: 'display:flex;flex-direction:column;gap:2px;margin-bottom:10px' },
      ...Object.entries(modes).map(([k, v]) => h('label', { class: 'opt-row', style: 'font-size:13px;cursor:pointer' },
        h('input', { type: 'radio', name: 'mode', value: k, checked: (cfg.mode || 'record') === k }),
        h('b', { class: 'opt-lbl' }, v.label), h('span', { class: 'opt-hint' }, v.hint),
      )),
    ),
    h('div', { class: 'toolbar', style: 'gap:16px;flex-wrap:wrap;align-items:center' },
      h('span', { class: 'muted', style: 'font-size:12px' }, '多少分钟内'),
      h('input', { type: 'number', id: 'sf-win', value: cfg.windowMin ?? 30, style: 'width:90px' }),
      h('span', { class: 'muted', style: 'font-size:12px' }, '分钟 · 命中'),
      h('input', { type: 'number', id: 'sf-hits', value: cfg.hits ?? 3, style: 'width:80px' }),
      h('span', { class: 'muted', style: 'font-size:12px' }, '次 · 降温'),
      h('input', { type: 'number', id: 'sf-cool', value: cfg.coolMin ?? 30, style: 'width:90px' }),
      h('span', { class: 'muted', style: 'font-size:12px' }, '分钟'),
      h('button', { class: 'btn', onclick: saveCfg }, '保存'),
      h('button', { class: 'btn ghost', onclick: async () => {
        try { await api('/api/bridge/restart', { method: 'POST', body: {} }); toast('正在重启桥接，约 10 秒'); }
        catch (e) { toast('重启失败：' + e.message, 3800); }
      } }, '重启桥接'),
    ),
    h('div', { style: 'margin-top:12px' }, // SAFEWORDS_UI
      h('div', { class: 'muted', style: 'font-size:12.5px;margin-bottom:6px' }, '命中词表（一行一个，也可用逗号分隔；只有「真会问出身份/隐私」的词才需要留）'),
      h('textarea', { id: 'sf-words', rows: 6, style: 'width:100%;font-size:12.5px;line-height:1.6;font-family:inherit' }, (cfg.words || []).join('\n')),
      h('div', { class: 'toolbar', style: 'margin-top:6px' },
        h('button', { class: 'btn ghost', onclick: async () => {
          const raw = ($('#sf-words').value || '');
          const words = raw.split(/[\n,，、;；]/).map((x) => x.trim()).filter(Boolean);
          if (!words.length) { toast('至少要留一个词'); return; }
          try {
            await api('/api/safe', { method: 'POST', body: { action: 'setcfg', words } });
            toast('词表已保存（' + words.length + ' 条），重启桥接后生效');
            await load();
          } catch (e) { toast('没存上：' + e.message, 3800); }
        } }, '保存词表'),
        h('button', { class: 'btn ghost', onclick: async () => {
          try { await api('/api/safe', { method: 'POST', body: { action: 'clear' } }); await load(); toast('已清空命中记录'); }
          catch (e) { toast('没清掉：' + e.message, 3800); }
        } }, '清空命中记录'),
      ),
    ),
  ));

  // 最近命中
  const alerts = safe.alerts || [];
  wrap.append(h('div', { class: 'card', style: 'margin-top:12px' },
    h('h3', {}, '最近命中（' + alerts.length + '）'),
    alerts.length
      ? h('table', { class: 'tbl' }, h('tbody', {}, ...alerts.map((a) => h('tr', {},
          h('td', { class: 'muted', style: 'width:150px;font-size:12px' }, String(a.at || '').slice(5, 16).replace('T', ' ')),
          h('td', { style: 'width:170px;font-size:12.5px' }, a.key),
          h('td', { style: 'font-size:12.5px' }, (a.words || []).join('、')),
          h('td', { class: 'muted', style: 'width:70px;font-size:12px' }, a.hits + ' 次'),
          h('td', { class: 'muted', style: 'width:110px;font-size:12px' }, a.acted || ''),
        ))))
      : h('div', { class: 'muted' }, '还没有人试探过。'),
    h('div', { class: 'toolbar', style: 'margin-top:10px' },
      h('button', { class: 'btn ghost', onclick: async () => {
        try { await api('/api/safe', { method: 'POST', body: { action: 'clear' } }); await load(); toast('已清空'); }
        catch (e) { toast('没清掉：' + e.message, 3800); }
      } }, '清空记录'),
    ),
  ));
  // P2-B 1.2：省钱模式→花费页；频率/按群规则→群规则页
  hideCardsIn(wrap, ['省钱模式（少说话）', '群发言频率', '按群规则（只回谁', '按群规则']);
  return wrap;


}

// NAMES_UI：把号码翻成名字（群名 / 昵称），失败就只显示号码
async function loadNames() {
  let acc = state.access || {};
  if (!(acc.groups || []).length && !((acc.private || acc.users) || []).length) {
    try { acc = state.access = await api('/api/access'); } catch {}
  }
  const groups = (acc.groups || []).map(String);
  const users = (acc.users || acc.private || []).map(String); // 白名单里私聊叫 private
  if (!groups.length && !users.length) return; // 名单还没加载，等下次再试
  try {
    const r = await api('/api/names', { method: 'POST', body: { groups, users } });
    state.names = { group: r.groups || {}, private: r.users || {} };
  } catch (e) { /* 拿不到就只显示号码 */ }
  state.namesLoaded = true;
}

function nameOf(kind, id) {
  const m = state.names && state.names[kind === 'group' ? 'group' : 'private'];
  return (m && m[String(id)]) || '';
}


async function accessDo(kind, id, action) {
  try {
    const r = await api('/api/access', { method: 'POST', body: { kind, id, action } });
    toast(`${action === 'add' ? '已加' : '已移除'} ${id}（${r.effectText}）`);
    state.access = { groups: r.groups, private: r.private, seen: state.access?.seen || [], allowAll: state.access?.allowAll };
    rerender();
  } catch (e) { toast('失败：' + e.message, 3800); }
}

async function loadEntry() { state.entry = await api('/api/entry'); }
async function loadAccess() { state.access = await api('/api/access'); }
async function loadBackups() { const r = await api('/api/backups'); state.backups = r.items || []; }
async function loadWhy() {
  const key = state.whyKey;
  if (!key) { state.why = null; return; }
  state.why = await api('/api/why?key=' + encodeURIComponent(key));
}


// ---------- P1 决策记录 ----------
const DECISION_MARKS = ['正常', '该回没回', '不该回却回', '答非所问'];
async function loadDecisions() {
  const f = state.decFilter || (state.decFilter = {});
  const q = new URLSearchParams();
  q.set('day', f.day || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10));
  for (const k of ['key', 'allow', 'source', 'minScore', 'maxScore']) if (f[k]) q.set(k, f[k]);
  if (f.unmarked) q.set('unmarked', '1');
  state.decisions = await api('/api/decisions?' + q.toString());
  // 名称：把本页出现的群号一次翻好
  const groups = [...new Set((state.decisions.items || []).filter((x) => String(x.key).startsWith('group:')).map((x) => String(x.key).slice(6)))];
  const users = [...new Set((state.decisions.items || []).filter((x) => String(x.key).startsWith('private:')).map((x) => String(x.key).slice(8)))];
  // 只补齐本页缺的名字（别的页可能已经加载过一部分）
  const missG = groups.filter((g) => !(state.names && state.names.group && state.names.group[g]));
  const missU = users.filter((u) => !(state.names && state.names.private && state.names.private[u]));
  if (missG.length || missU.length) {
    try {
      const r = await api('/api/names', { method: 'POST', body: { groups: missG, users: missU } });
      state.names = state.names || { group: {}, private: {} };
      state.names.group = { ...(state.names.group || {}), ...(r.groups || {}) };
      state.names.private = { ...(state.names.private || {}), ...(r.users || {}) };
      state.namesLoaded = true;
    } catch {}
  }
}
async function decisionMark(id, mark) {
  try { await api('/api/decisions/mark', { method: 'POST', body: { id, mark } }); const it = (state.decisions.items || []).find((x) => x.id === id); if (it) { state.decisions.marks[id] = mark; } rerender(); }
  catch (e) { toast('标注失败：' + e.message, 3600); }
}
async function decisionExport() {
  const day = (state.decFilter && state.decFilter.day) || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  try {
    const r = await fetch('/api/decisions/export?day=' + day, { headers: { 'x-her-token': TOKEN } });
    const b = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'decisions-' + day + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { toast('导出失败：' + e.message, 3600); }
}
function decisionConvName(x) {
  const m = /^(group|private):(\d+)$/.exec(String(x.key || ''));
  if (!m) return x.key || '';
  const kind = m[1] === 'group' ? 'group' : 'private';
  const bucket = kind === 'group' ? 'groups' : 'users';
  const hit = state.names && state.names[bucket] && state.names[bucket][m[2]];
  const nm = hit && hit.name ? hit.name + ' · ' : '';
  return nm + (m[1] === 'group' ? '群 ' : '私聊 ') + m[2];
  const _n = (state.names && state.names.group && state.names.group[id]);
  if (typeof _n === 'string' && _n) return _n + ' · ' + id;
}


// ==================== P2-A 群规则（单表） ====================
// 只读五个现有接口，写走 applyGroupRule 适配层；不改桥接、不新增后端。
const GR_MODES = { normal: '正常聊', called: '只回@', watch: '只看不说' };
const GR_LEVELS = { quiet: '保守', normal: '正常', active: '活跃', custom: '自定义' };
const GR_HIDE_TITLES = ['三档总览（快捷预设）', '群发言频率（每群单独一档', '群发言频率', '学习模式（只看不聊）', '按群规则（只回谁'];

function hideLegacyGroupCards() {
  // 复用同一批旧卡：全部隐藏，代码还在；把 state._hideLegacyGroupCards 设为 false 即可回滚
  if (state._hideLegacyGroupCards === false) return;
  for (const card of document.querySelectorAll('#view .card')) {
    const head = card.querySelector('.card-h, h3');
    const text = String(head && head.textContent || '').trim();
    if (!text) continue;
    if (GR_HIDE_TITLES.some((t) => text.startsWith(t.slice(0, 8)) || text.startsWith(t))) card.style.display = 'none';
  }
}

function grEffective(row) {
  const lv = row.level || 'normal';
  const base = (row.levels || {})[lv] || {};
  const cu = row.custom || null;
  const presetMin = Math.round(Number(base.minGapMs || 0) / 60000);
  const presetMax = Number(base.maxPerDay || 0);
  const isCustom = !!(cu && (Number(cu.perDay || 0) !== presetMax || Number(cu.minGapMin || 0) !== presetMin));
  return {
    level: isCustom ? 'custom' : lv,
    minGapMin: isCustom ? Number(cu.minGapMin || 0) : presetMin,
    perDay: isCustom ? Number(cu.perDay || 0) : presetMax,
    presetMin,
    presetMax,
  };
}

async function loadGroupRules(force) {
  if (state.groupRules && !force) return state.groupRules;
  const data = { rows: [], errors: [], levels: {}, at: 0 };
  const get = async (p, label) => {
    try { return await api(p); } catch (e) { data.errors.push(label + '（' + p + '）：' + (e.message || '读取失败')); return null; }
  };
  const [acc, mute, learn, gr, attn] = await Promise.all([
    get('/api/access', '白名单'), get('/api/mute', '静音'), get('/api/learn', '学习模式'),
    get('/api/gr', '发言频率'), get('/api/attn-get', '抽样/只回谁'),
  ]);
  data.levels = (gr && gr.levels) || {};
  const allow = new Set(((acc && acc.groups) || []).map(String));
  const muted = new Set((((mute && mute.keys) || [])).filter((k) => String(k).startsWith('group:')).map((k) => String(k).slice(6)));
  const learned = new Set(((learn && learn.groups) || []).map(String));
  const rates = new Map((((gr && gr.rates) || [])).map((r) => [String(r.gid), r]));
  const sample = (attn && attn.sample) || {};
  const replyOnly = (attn && attn.replyOnly) || {};
  const onlyGid = (k) => /^\d{5,}$/.test(String(k));
  const gids = new Set([
    ...allow, ...rates.keys(), ...muted, ...learned,
    ...Object.keys(sample || {}).filter(onlyGid), ...Object.keys(replyOnly || {}).filter(onlyGid),
  ]);
  // 名字：只补缺的
  const need = [...gids].filter((g) => {
    const hit = state.names && state.names.group && state.names.group[g];
    return !(hit && hit.name);
  });
  if (need.length) {
    try {
      const r = await api('/api/names', { method: 'POST', body: { groups: need, users: [] } });
      state.names = state.names || { group: {}, private: {} };
      state.names.group = { ...(state.names.group || {}), ...(r.groups || {}) };
    } catch {}
  }
  const now = Date.now();
  data.rows = [...gids].filter(Boolean).map((gid) => {
    const r = rates.get(gid) || {};
    const cu = r.custom || null;
    const hit = state.names && state.names.group && state.names.group[gid];
    const name = (hit && hit.name) || (typeof hit === 'string' ? hit : '') || '';
    return {
      gid,
      name,
      allow: allow.has(gid),
      mode: learned.has(gid) ? 'watch' : (muted.has(gid) ? 'called' : 'normal'),
      level: r.level || 'normal',
      levels: data.levels,
      custom: cu,
      count: Number(r.count || 0),
      lastAt: Number(r.lastAt || 0),
      maxPerDay: Number(r.maxPerDay || 0),
      minGapMs: Number(r.minGapMs || 0),
      sample: Number(sample[gid] || 0),
      replyOnly: (replyOnly[gid] || []).join(', '),
      minsAgo: Number(r.lastAt || 0) ? Math.max(0, Math.round((now - Number(r.lastAt)) / 60000)) : null,
    };
  }).sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || String(a.name || a.gid).localeCompare(String(b.name || b.gid), 'zh'));

  const pending = state.pending && state.pending.count > 0;
  if (!(state._grRestart instanceof Set)) state._grRestart = new Set();
  for (const row of data.rows) row.pendingRestart = state._grRestart.has(String(row.gid));
  data.at = now;
  state.groupRules = data;
  return data;
}

async function applyGroupRule(gid, field, next) {
  const row = ((state.groupRules && state.groupRules.rows) || []).find((r) => r.gid === gid) || {};
  const prev = String(
    field === 'allow' ? (row.allow ? '在' : '不在')
      : field === 'mode' ? GR_MODES[row.mode] || row.mode
        : field === 'level' ? GR_LEVELS[row.level] || row.level
          : field === 'replyOnly' ? (row.replyOnly || '不限')
            : field === 'sample' ? (row.sample || 0)
              : String((grEffective(row).minGapMin) + ' 分钟/' + grEffective(row).perDay + ' 次'),
  );
  const muteKey = 'group:' + gid;
  try {
    if (field === 'allow') {
      await api('/api/access', { method: 'POST', body: { kind: 'group', id: gid, action: next ? 'add' : 'remove' } });
      state.access = null;
    } else if (field === 'mode') {
      if (next === 'called') {
        await api('/api/mute', { method: 'POST', body: { action: 'mute', key: muteKey } });
        await api('/api/learn', { method: 'POST', body: { action: 'off', group: gid } }).catch(() => {});
      } else if (next === 'watch') {
        await api('/api/learn', { method: 'POST', body: { action: 'on', group: gid } });
        await api('/api/mute', { method: 'POST', body: { action: 'unmute', key: muteKey } });
      } else {
        await api('/api/mute', { method: 'POST', body: { action: 'unmute', key: muteKey } });
        await api('/api/learn', { method: 'POST', body: { action: 'off', group: gid } }).catch(() => {});
      }
      state.muted = null; state.learn = null;
    } else if (field === 'level') {
      const base = (row.levels || {})[next] || {};
      await api('/api/gr', { method: 'POST', body: { action: 'set', group: gid, level: next } });
      // 预设档位要同时覆盖自定义值，否则 custom 会一直盖住
      await api('/api/gr', { method: 'POST', body: { action: 'custom', group: gid, minGapMin: Math.round(Number(base.minGapMs || 0) / 60000), perDay: Number(base.maxPerDay || 40) } });
      state.gr = null;
    } else if (field === 'rate') {
      await api('/api/gr', { method: 'POST', body: { action: 'custom', group: gid, minGapMin: Number(next.minGapMin), perDay: Number(next.perDay) } });
      state.gr = null;
    } else if (field === 'replyOnly') {
      await api('/api/attn-set', { method: 'POST', body: { group: gid, replyOnly: String(next || '') } });
      state.attnCfg = null;
    } else if (field === 'sample') {
      await api('/api/attn-set', { method: 'POST', body: { group: gid, sample: Number(next) || 0 } });
      state.attnCfg = null;
    }
    if (field === 'allow') state._grRestart.add(String(gid));
    state.groupRules = null;
    await loadGroupRules(true);
    state.flash = { gid, at: Date.now() };
    rerender();
    setTimeout(() => { if (state.flash && state.flash.gid === gid) { state.flash = null; rerender(); } }, 1300);
    if (field === 'allow') toast(next ? '已加入白名单（下一条消息生效；没生效就重启桥接）' : '已移出白名单（下一条消息生效）');
    else if (field === 'mode') toast('已改：' + (GR_MODES[next] || next) + '（立刻生效）');
    else toast('已保存（60 秒内生效）');
    loadPending().catch(() => {});
  } catch (e) {
    toast(({ allow: '在群里', mode: '怎么回', level: '档位', rate: '发言量', replyOnly: '只回谁', sample: '抽样' }[field] || field)
      + '没改成：' + (e.message || '未知错误') + '；原值：' + prev, 4200);
    state.groupRules = null;
    await loadGroupRules(true).catch(() => {});
    rerender();
  }
}

function pageGroupRules() {
  if (!state.groupRules) {
    loadGroupRules(true).catch(() => {}).finally(() => rerender());
    return h('div', { class: 'card muted' }, '正在读群规则…');
  }
  const d = state.groupRules;
  const addCard = h('div', { class: 'card', style: 'margin-bottom:10px' }, h('div', { class: 'kv', style: 'align-items:center;gap:10px' }, [h('b', {}, '添加'), addWhitelistRow(['group', 'private'])]));
  if (!d.rows.length) {
    return h('div', {}, [
      addCard,
      d.errors.length ? h('div', { class: 'card', style: 'border-color:var(--warn)' }, [
        h('div', { class: 'card-h' }, '读取失败，先用兜底显示'),
        ...d.errors.map((x) => h('div', { class: 'muted', style: 'font-size:12.5px' }, '· ' + x)),
        h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: () => { state.groupRules = null; rerender(); } }, '重试')),
      ]) : h('div', { class: 'card' }, [
        h('h3', {}, '群规则'),
        h('div', { class: 'muted' }, '还没有配置任何群。'),
        h('div', { style: 'margin-top:10px' }, h('a', { href: '#access', class: 'btn ghost' }, '去白名单添加')),
      ]),
    ]);
  }
  const head = h('thead', {}, h('tr', {}, ['群', '在群里？', '怎么回', '发言量（间隔 / 每天）', '只回谁（QQ，逗号分隔）', '抽样%', '今天', '状态']
    .map((t) => h('th', {}, t))));
  const body = h('tbody', {}, ...d.rows.map((row) => {
    const eff = grEffective(row);
    const flash = state.flash && state.flash.gid === row.gid;
    const td = (children, opts = {}) => h('td', opts, children);
    const allowBox = h('input', {
      type: 'checkbox', checked: row.allow ? 'checked' : null,
      onchange: (e) => { const v = e.target.checked; e.target.disabled = true; applyGroupRule(row.gid, 'allow', v); },
    });
    const modeSel = h('select', { class: 'input', onchange: (e) => applyGroupRule(row.gid, 'mode', e.target.value) },
      Object.entries(GR_MODES).map(([k, v]) => h('option', { value: k, selected: row.mode === k ? 'selected' : null }, v)));
    const lvSel = h('select', { class: 'input', style: 'max-width:96px', onchange: (e) => applyGroupRule(row.gid, 'level', e.target.value) },
      [...Object.entries(GR_LEVELS).filter(([k]) => k !== 'custom'), ['custom', '自定义']].map(([k, v]) =>
        h('option', { value: k, selected: eff.level === k ? 'selected' : null, disabled: k === 'custom' ? 'disabled' : null }, v)));
    const gapIn = h('input', { class: 'input', type: 'number', min: 0, max: 240, value: String(eff.minGapMin), style: 'width:66px',
      onchange: (e) => applyGroupRule(row.gid, 'rate', { minGapMin: Number(e.target.value) || 0, perDay: eff.perDay }) });
    const dayIn = h('input', { class: 'input', type: 'number', min: 1, max: 500, value: String(eff.perDay), style: 'width:74px',
      onchange: (e) => applyGroupRule(row.gid, 'rate', { minGapMin: eff.minGapMin, perDay: Number(e.target.value) || 1 }) });
    const replyIn = h('input', { class: 'input', value: row.replyOnly, placeholder: '空=不限', style: 'width:170px',
      onchange: (e) => applyGroupRule(row.gid, 'replyOnly', e.target.value) });
    const sampleIn = h('input', { class: 'input', type: 'number', min: 0, max: 5, step: 0.1, value: String(row.sample || 0), style: 'width:64px',
      onchange: (e) => applyGroupRule(row.gid, 'sample', e.target.value) });
    return h('tr', { class: flash ? 'gr-flash' : null }, [
      td([h('div', { class: 'mono' }, row.name || row.gid), h('div', { class: 'muted', style: 'font-size:11.5px' }, row.gid)]),
      td(allowBox),
      td(modeSel),
      td(h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [lvSel, gapIn, h('span', { class: 'muted' }, '/'), dayIn, h('span', { class: 'muted' }, '次')])),
      td(replyIn),
      td(sampleIn),
      td(h('span', { class: 'muted', style: 'font-size:12px' }, `今天 ${row.count}/${row.maxPerDay} 次` + (row.minsAgo == null ? ' · 距上次 —' : ` · 距上次 ${row.minsAgo} 分钟`))),
      td(row.pendingRestart ? h('span', { class: 'gr-state wait' }, '需重启') : h('span', { class: 'gr-state ok' }, '立即')),
    ]);
  }));
  const err = d.errors.length ? h('div', { class: 'card', style: 'border-color:var(--warn)' }, [
    h('div', { class: 'card-h' }, '部分读取失败（该列显示兜底值）'),
    ...d.errors.map((x) => h('div', { class: 'muted', style: 'font-size:12.5px' }, '· ' + x)),
  ]) : null;
  return h('div', {}, [
    addCard,
    h('div', { class: 'muted', style: 'margin:0 2px 10px;font-size:12.5px' }, '这里改的是「她在每个群怎么说话」，改完 60 秒内生效；删增群需要重启桥接。'),
    err,
    h('div', { class: 'tbl-fit' }, h('table', { class: 'tbl-fit rules-tbl' }, [head, body])),
  ].filter(Boolean));
}


// P2-D：误判分析卡（决策记录页）
function decisionStatsCard() {
  const wrap = h('div', { class: 'card', style: 'margin-bottom:12px' }, h('h3', {}, '误判分析'));
  const box = h('div', { class: 'muted' }, '正在读统计…');
  wrap.append(box);
  (async () => {
    try {
      const r = await api('/api/decision-stats');
      const rows = (r && r.sources) || [];
      box.textContent = '';
      if (!rows.length) { box.append(h('div', { class: 'muted' }, '还没有判决记录；等桥接写出 decision/*.jsonl 后再看。')); return; }
      if (r.marked < 10) { box.append(h('div', { class: 'muted', style: 'margin-bottom:6px' }, '先标 10 条再回来看，样本太少统计没意义（现在 ' + r.marked + ' 条）')); }
      const top = rows.find((x) => x.bad > 0);
      if (top) box.append(h('div', { style: 'margin-bottom:8px' }, '当前误判最多的是 ' + top.source + '（' + top.bad + ' 条，' + top.rate + '%）'));
      const tbl = h('table', { class: 'tbl-fit nowrap-tbl' },
        h('thead', {}, h('tr', {}, ...['来源', '判断数', '已标数', '该回没回', '不该回却回', '答非所问', '误判率'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...rows.map((x) => h('tr', { style: 'cursor:pointer', onclick: () => { state._decSource = x.source; rerender(); } },
          h('td', {}, x.source), h('td', {}, String(x.total)), h('td', {}, String(x.marked)),
          h('td', {}, String(x.missed)), h('td', {}, String(x.wrong)), h('td', {}, String(x.off)),
          h('td', { class: x.rate > 50 ? 'warn' : '' }, x.rate + '%')))));
      box.append(tbl);
      if (state._decSource) box.append(h('div', { class: 'muted', style: 'margin-top:6px' }, '已选来源：' + state._decSource + '（再点一次清除）'), h('div', {}, h('button', { class: 'btn', onclick: () => { state._decSource = ''; rerender(); } }, '清除筛选')));
    } catch (e) { box.textContent = '误判统计没读到：' + (e && e.message ? e.message : e); }
  })();
  return wrap;
}

// P2-D：人味指标卡（说话页）
function humanStatsCard() {
  const wrap = h('div', { class: 'card', style: 'margin-bottom:12px' }, h('h3', {}, '人味指标（近两周）'));
  const box = h('div', { class: 'muted' }, '正在计算…'); wrap.append(box);
  const arrow = (cur, prev, higherBad) => {
    if (!prev) return '—';
    const d = cur - prev;
    if (Math.abs(d) < 1e-9) return '→ 持平';
    const up = d > 0;
    const good = higherBad ? !up : up;
    return (up ? '↑ ' : '↓ ') + (good ? '变好' : '变差');
  };
  const fmt = (v) => (Math.round(v * 100) / 100).toLocaleString();
  (async () => {
    try {
      const r = await api('/api/human-stats'); const c = r.cur || {}, p = r.prev || {};
      const pctText = (o) => '。' + (o['。'] || 0) + '% ！' + (o['！'] || 0) + '% ？' + (o['？'] || 0) + '% …' + (o['…'] || 0) + '%';
      const rows = [
        ['句长中位数（群 / 私聊）', (c.lenG || 0) + ' / ' + (c.lenP || 0), (p.lenG || 0) + ' / ' + (p.lenP || 0), arrow(c.lenG + c.lenP, p.lenG + p.lenP, false)],
        ['实词重合度', fmt(c.ov || 0), fmt(p.ov || 0), arrow(c.ov || 0, p.ov || 0, false)],
        ['标点分布', pctText(c.punc || {}), pctText(p.punc || {}), arrow(c.punc && c.punc['！'] || 0, p.punc && p.punc['！'] || 0, true)],
        ['总结句比例', Math.round((c.sumRatio || 0) * 100) + '%', Math.round((p.sumRatio || 0) * 100) + '%', arrow(c.sumRatio || 0, p.sumRatio || 0, true)],
        ['样本数', String(c.n || 0), String(p.n || 0), ''],
      ];
      box.textContent = '';
      const tbl = h('table', { class: 'tbl-fit nowrap-tbl' },
        h('thead', {}, h('tr', {}, ...['指标', '本周', '上周', '变化'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...rows.map((x) => h('tr', {}, h('td', {}, x[0]), h('td', {}, x[1]), h('td', {}, x[2]), h('td', {}, x[3])))));
      box.append(tbl);
      if (!c.n) box.append(h('div', { class: 'muted', style: 'margin-top:6px' }, '近两周还没有她的消息样本。'));
    } catch (e) { box.textContent = '人味指标没算出来：' + (e && e.message ? e.message : e); }
  })();
  return wrap;
}

function pageDecisions() {
  if (!state.names) loadNames().catch(() => {});
  const wrap = h('div', {});
  wrap.append(decisionStatsCard()); // P2-D 误判分析
  if (!state.decFilter) state.decFilter = { day: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10) };
  const f = state.decFilter;
  if (!state.decisions) { loadDecisions().catch(() => {}).finally(rerender); wrap.append(h('div', { class: 'card muted' }, '正在读判决书…')); }
  const upd = (k, v) => { f[k] = v; loadDecisions().catch(() => {}).finally(rerender); };
  const sel = (k, opts) => h('select', { class: 'input', style: 'max-width:150px', onchange: (e) => upd(k, e.target.value) },
    opts.map(([v, t]) => h('option', { value: v, selected: (f[k] || '') === v ? 'selected' : null }, t)));
  const input = (k, ph, style) => h('input', { class: 'input', placeholder: ph, value: f[k] || '', style: style || 'max-width:150px',
    onchange: (e) => upd(k, String(e.target.value || '').trim()) });
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'toolbar', style: 'flex-wrap:wrap;gap:8px' }, [
      h('input', { class: 'input', type: 'date', value: f.day, onchange: (e) => upd('day', e.target.value) }),
      sel('allow', [['', '全部'], ['true', '只看放行'], ['false', '只看拦截']]),
      sel('source', [['', '全部来源'], ['owner-only', 'owner-only'], ['mute', 'mute'], ['learnmode', 'learnmode'], ['economy', 'economy'], ['group-rate', 'group-rate'], ['attention', 'attention'], ['safe-talk', 'safe-talk'], ['ext', '其它放行']]),
      input('key', '会话 key（可部分匹配）'),
      input('minScore', '最低分', 'max-width:90px'), input('maxScore', '最高分', 'max-width:90px'),
      h('label', { class: 'muted', style: 'display:flex;align-items:center;gap:6px' }, [h('input', { type: 'checkbox', checked: f.unmarked ? 'checked' : null, onchange: (e) => upd('unmarked', e.target.checked) }), '只看未标注']),
      h('button', { class: 'btn', onclick: () => loadDecisions().catch(() => {}).finally(rerender) }, '刷新'),
      h('button', { class: 'btn', onclick: decisionExport }, '导出 CSV'),
    ]),
  ]));
  const d = state.decisions || { items: [], stats: {} };
  const st = d.stats || {};
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'big', style: 'font-size:15px' }, `今日判断 ${st.total || 0} · 放行 ${st.allow || 0} · 拦截 ${st.block || 0} · 回了 ${st.replied || 0} · 已标 ${st.marked || 0}`),
    h('div', { class: 'muted', style: 'font-size:12.5px;margin-top:6px' }, (st.topSources || []).length ? ('拦截来源 top：' + st.topSources.map(([k, v]) => k + ' ' + v).join(' · ')) : '今天还没有拦截记录。'),
  ]));
  const rows = (d.items || []).map((x) => {
    const mark = (d.marks || {})[x.id] || '';
    return h('tr', {}, [
      h('td', { class: 'mono', style: 'font-size:11.5px' }, new Date(x.ts).toLocaleTimeString('zh-CN')),
      h('td', { style: 'font-size:12px' }, decisionConvName(x)),
      h('td', { style: 'font-size:12.5px;max-width:340px' }, x.text || ''),
      h('td', { class: 'mono' }, x.score == null ? '—' : String(x.score)),
      h('td', {}, h('span', { class: 'tag ' + (x.allow ? 'ok' : 'warn') }, x.allow ? '放行' : '拦截')),
      h('td', { class: 'mono', style: 'font-size:11.5px' }, x.source || ''),
      h('td', { class: 'muted', style: 'font-size:12px' }, x.replied === true ? '回了' : (x.replied === false ? '没回' : '—')),
      h('td', {}, h('div', { class: 'toolbar', style: 'gap:4px;flex-wrap:wrap' }, DECISION_MARKS.map((m) =>
        h('button', { class: 'btn ' + (mark === m ? 'primary' : ''), style: 'padding:2px 6px;font-size:11.5px', onclick: () => decisionMark(x.id, mark === m ? '' : m) }, m)))),
    ]);
  });
  wrap.append(h('div', { class: 'card', style: 'overflow:auto' }, rows.length
    ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['时间', '会话', '消息摘要', '分数', '最终', '来源', '结果', '标注'].map((t) => h('th', {}, t)))), h('tbody', {}, ...rows))
    : h('div', { class: 'muted' }, '这一天没有记录。判决书要等 bridge 重启后才会开始写。')));
  return wrap;
}

function pageDiag() {
  const d = state.overview || {};
  const hlt = d.health || {};
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'card' },
    h('h3', {}, '重启（会短暂断开）'),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => doRestart('bridge') }, '重启桥接'),
      h('button', { class: 'btn', onclick: () => doRestart('dsh') }, '重启 DSH'),
      h('button', { class: 'btn', onclick: () => doRestart('napcat') }, '重启 NapCat'),
      h('button', { class: 'btn', onclick: () => doRestart('asr') }, '重启 ASR'),
    ),
    h('div', { class: 'chips', style: 'margin-top:6px' },
      Object.entries(hlt.services || {}).map(([n, v]) => h('span', { class: 'chip' }, n + ' ', h('b', { style: v === 'active' ? 'color:var(--ok)' : 'color:var(--bad)' }, v))),
    ),
  ));
  const sel = h('select', { onchange: (e) => { state.logName = e.target.value; loadLogs(); } },
    ...Object.entries({ bridge: '桥接日志', asr: 'ASR 日志', watch: '看门狗日志', curate: '记忆整理日志', console: '面板请求日志' }).map(([k, v]) => h('option', { value: k, selected: state.logName === k ? 'selected' : null }, v)));
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('div', { class: 'toolbar' }, sel,
      h('button', { class: 'btn sm', onclick: loadLogs }, '刷新日志'),
      h('label', { class: 'muted', style: 'display:flex;gap:6px;align-items:center' },
        h('input', { type: 'checkbox', checked: state.onlyErr ? 'checked' : null, onchange: (e) => { state.onlyErr = e.target.checked; rerender(); } }), '只看错误/警告')),
    h('div', { class: 'logs' }, ...(state.logs.length
      ? state.logs.filter((l) => (state.onlyErr ? /error|错误|失败|warn|警告|ERR/i.test(l) : true)).slice(-300).map((l) => h('div', { class: /error|错误|失败|ERR|warn|警告/i.test(l) ? 'err' : '' }, l))
      : ['（还没加载）'])),
  ));
  const keys = [];
  if (state.overview?.status) {
    (state.overview.status.allowGroups || []).forEach((g) => keys.push('group:' + g));
    (state.overview.status.allowPrivate || []).forEach((p) => keys.push('private:' + p));
  }
  const whySel = h('select', { onchange: (e) => { state.whyKey = e.target.value; loadWhy().then(rerender).catch(() => {}); } },
    ...keys.map((k) => h('option', { value: k, selected: state.whyKey === k ? 'selected' : null }, k)));
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('h3', {}, '为什么不回（选一个会话）'),
    h('div', { class: 'toolbar' }, whySel,
      h('button', { class: 'btn sm', onclick: () => loadWhy().then(rerender).catch(() => {}) }, '查一下')),
    state.why ? h('div', {},
      h('div', { class: 'muted', style: 'font-size:12px;margin:8px 0 4px' }, '最近的拦截原因：'),
      ...((state.why.reasons || []).length ? state.why.reasons.map((x) => h('div', { class: 'mono', style: 'font-size:12px;color:#ffc857' }, x)) : [h('div', { class: 'muted', style: 'font-size:12px' }, '没有拦截记录 —— 说明不是被规则挡的，可能是没被触发词叫醒')]),
      h('div', { class: 'muted', style: 'font-size:12px;margin:12px 0 4px' },
        '这个会话：今天被唤醒 ' + ((state.why.conv?.wakeConfig?.wakeCount) ?? '?') + ' 次，上次 ' +
        (state.why.conv?.wakeConfig?.lastWakeAt ? new Date(state.why.conv.wakeConfig.lastWakeAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—')),
      ...((state.why.conv?.recentMessages || []).slice(-8).map((m) => h('div', { class: 'kv', style: 'align-items:flex-start' },
        h('span', { class: 'muted', style: 'flex:0 0 120px;font-size:12px' }, (m.sender || '') + ' ' + (m.userId || '')),
        h('span', { style: 'flex:1;font-size:12.5px' }, (m.text || m.plain || '').slice(0, 120))))),
      ...(state.why.lines || []).slice(-6).map((x) => h('div', { class: 'mono', style: 'font-size:12px;color:#9fb0c2' }, x)),
    ) : h('div', { class: 'muted', style: 'font-size:12px' }, '选一个会话看看'),
  ));
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('h3', {}, '跟她说一句（投进她的私聊会话，约 ¥0.002）'),
    h('div', { class: 'toolbar' },
      h('input', { type: 'text', id: 'sayText', placeholder: '例如：在吗', style: 'flex:1;min-width:220px' }),
      h('button', {
        class: 'btn',
        onclick: async () => {
          const t = ($('#sayText')?.value || '').trim();
          if (!t) { toast('先说点什么'); return; }
          try { const r = await api('/api/say', { method: 'POST', body: { text: t } }); toast(r.ok ? '已投递，去 QQ 看她的回复' : '失败：' + JSON.stringify(r.result || {}).slice(0, 120), 5000); }
          catch (e) { toast('失败：' + e.message, 4000); }
        },
      }, '发给她'),
    ),
  ));
  wrap.append(h('div', { class: 'card', style: 'margin-top:14px' },
    h('div', { class: 'toolbar' },
      h('button', {
        class: 'btn',
        onclick: async () => {
          try { toast('打包中…', 6000); const r = await api('/api/backup', { method: 'POST', body: {} }); toast(r.ok ? `已备份 ${Math.round(r.size / 1024)} KB` : '失败：' + r.msg, 4200); await loadBackups(); rerender(); }
          catch (e) { toast('失败：' + e.message, 4000); }
        },
      }, '立即备份'),
      h('span', { class: 'muted', style: 'font-size:12.5px' }, 'state/ + config.json + bili 配置 → /home/dsh/backups/her'),
    ),
    ...(state.backups
      ? (state.backups.length
        ? state.backups.map((b) => h('div', { class: 'kv' }, h('span', { class: 'mono', style: 'font-size:12px' }, b.name), h('span', { class: 'muted' }, Math.round(b.size / 1024) + ' KB')))
        : [h('div', { class: 'muted' }, '还没有备份')])
      : []),
  ));
  return wrap;
}

// ---------- 动作 ----------
async function toggleFeature(f, next) {
  try {
    const r = await api('/api/feature', { method: 'POST', body: { id: f.id, value: next } });
    f.value = r.value;
    toast(`${f.name} → ${next ? '开' : '关'}（${r.effectText}）`);
    if (r.effect !== 'hot') toast(`${f.name} 已写入，需要${r.effectText.replace('需', '')}才生效`, 3600);
    await loadFeatures();
    await loadPending(); // PENDING_FIX：拨完立刻刷新顶栏「待生效」，别等整页刷新
    rerender();
  } catch (e) { toast('失败：' + e.message, 3600); rerender(); }
}
async function saveSetting(f, raw) {
  try {
    const r = await api('/api/setting', { method: 'POST', body: { id: f.id, value: raw } });
    f.value = r.value;
    toast(`${f.name} = ${r.value}（${r.effectText}）`);
    await loadPending(); // PENDING_FIX
    rerender();
  } catch (e) { toast('失败：' + e.message, 3600); }
}
async function doRestart(target) {
  const names = { bridge: '桥接', dsh: 'DSH', napcat: 'NapCat', asr: 'ASR' };
  if (!confirm(`确定重启${names[target]}？`)) return;
  try { toast('重启中…', 8000); const r = await api('/api/restart', { method: 'POST', body: { target } }); toast(r.msg || '已重启'); await loadOverview(); rerender(); }
  catch (e) { toast('失败：' + e.message, 4000); }
}
async function loadLogs() {
  try { const r = await api('/api/logs?name=' + state.logName + '&tail=200'); state.logs = r.lines || []; rerender(); }
  catch (e) { state.logs = ['加载失败：' + e.message]; rerender(); }
}

// ---------- 加载与渲染 ----------
async function loadCost() { state.cost = await api('/api/cost'); }
async function loadOverview() {
  state.overview = await api('/api/overview');
  try { state.qqmode = (await api('/api/qqmode')).mode; } catch { state.qqmode = 'open'; }
  try { state.qqstats = await api('/api/qq/stats'); } catch { state.qqstats = null; }
  try { state.friends = await api('/api/friends'); } catch { state.friends = null; }
}
async function loadFeatures() { const r = await api('/api/features'); state.features = r.features || []; }

// MUTE_UI：静音名单 + 待生效改动
async function loadMuted() { const r = await api('/api/mute'); state.muted = r.keys || []; }
async function loadMoodHist() { // MOODCHART_UI
  try { state.moodHist = await api('/api/mood/history'); } catch { state.moodHist = null; }
}

async function loadPending() { try { state.pending = await api('/api/pending'); } catch { state.pending = null; } }
const isMutedKey = (key) => (state.muted || []).includes(key);
async function muteDo(key, mute) {
  try {
    const r = await api('/api/mute', { method: 'POST', body: { action: mute ? 'mute' : 'unmute', key } });
    state.muted = r.keys || [];
    rerender();
    toast((mute ? '已静音 ' : '已恢复 ') + key + '（立刻生效，不用重启）');
  } catch (e) { toast('失败：' + e.message, 3800); }
}

// LEARN_MODE_UI：学习模式（这个群只看不聊，学说法照样进得去）
async function loadLearn() { try { const r = await api('/api/learn'); state.learn = r.groups || []; } catch { state.learn = []; } }
const isLearnGroup = (gid) => (state.learn || []).includes(String(gid));
async function learnDo(gid, on) {
  try {
    const r = await api('/api/learn', { method: 'POST', body: { action: on ? 'on' : 'off', group: String(gid) } });
    state.learn = r.groups || [];
    rerender();
    toast((on ? '群 ' + gid + ' 进入学习模式（只看不聊）' : '群 ' + gid + ' 恢复正常聊天') + '（立刻生效，不用重启）');
  } catch (e) { toast('失败：' + e.message, 3800); }
}

// QQMODE_CYCLE_PATCH：顶栏点一下就在 全开 → 只听主人 → 关机 之间切
const QQ_MODE_LABEL = { open: '全开', owneronly: '只听主人', privateonly: '只跟我私聊', off: '关机' };
async function cycleQqMode() {
  const order = ['open', 'owneronly', 'privateonly', 'off'];
  const cur = state.qqmode || 'open';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  try {
    toast('正在切成「' + QQ_MODE_LABEL[next] + '」…', 1500);
    const out = await api('/api/qqmode', { method: 'POST', body: { mode: next } });
    state.qqmode = out.mode || next;
    await loadOverview();
    rerender();
    toast('QQ 模式：' + (QQ_MODE_LABEL[state.qqmode] || state.qqmode));
  } catch (e) { toast('切换失败：' + e.message); }
}

function renderPills() {
  const d = state.overview || {};
  const hlt = d.health || {};
  const qq = hlt.ports?.[3001];
  const cost = d.cost || {};
  const qqModeNow = state.qqmode || 'open';
  const pills = [
    { k: 'QQ 模式', v: QQ_MODE_LABEL[qqModeNow] || qqModeNow, cls: qqModeNow === 'off' ? 'bad' : qqModeNow === 'owneronly' || qqModeNow === 'privateonly' ? 'warn' : 'ok', cycle: true },
    { k: '待生效', v: (state.pending?.count || 0) + ' 项', cls: (state.pending?.count || 0) ? 'warn' : 'ok', go: (state.pending?.count || 0) ? 'settings' : '', title: (state.pending?.count || 0) ? '有配置改动还没重启桥接生效，点这里看' : '配置都是最新生效的' },
    { k: 'QQ', v: qq ? '已连接' : '未连接', cls: qq ? 'ok' : 'bad' },
    { k: '桥接', v: (hlt.bridgePid || []).join(',') || '未运行', cls: (hlt.bridgePid || []).length ? 'ok' : 'bad' },
    { k: '面板', v: hlt.ports?.[3080] ? '3080' : '未听', cls: hlt.ports?.[3080] ? 'ok' : 'bad' },
    { k: '今日', v: `${fmtCny(cost.today)} / ¥${cost.cap ?? '—'}${cost.downgraded ? '（省钱中）' : ''}`, cls: cost.downgraded ? 'warn' : 'ok' },
    { k: 'NapCat', v: hlt.napcat || '未运行', cls: hlt.napcat ? 'ok' : 'bad' },
  ];
  $('#pills').replaceChildren(...pills.map((p) => h('span', {
    class: 'pill ' + p.cls,
    style: p.cycle ? 'cursor:pointer' : '',
    title: p.cycle ? '点一下切换：全开 → 只听主人 → 只跟我私聊 → 关机' : (p.title || ''),
    onclick: p.cycle ? () => { void cycleQqMode(); } : (p.go ? () => { location.hash = '#' + p.go; } : null),
  }, p.k + ' ', h('b', {}, p.v))));
}

function renderNav() {
  const nodes = [];
  for (const g of navGroups()) {
    nodes.push(h('div', { class: 'nav-group-title' }, g.title));
    for (const id of g.ids) {
      const p = PAGES.find((x) => x.id === id);
      if (!p) continue;
      nodes.push(h('a', {
        href: '#' + p.id, class: state.page === p.id ? 'active' : '',
        onclick: (e) => { e.preventDefault(); location.hash = '#' + p.id; },
      }, p.title));
    }
  }
  $('#nav').replaceChildren(...nodes);
}

function rerender() {
  renderNav();
  renderPills();
  const page = PAGES.find((p) => p.id === state.page) || PAGES[0];
  const _view = page.render();
  const _adj = PAGE_ADJUST[page.id];
  if (_adj) $('#view').replaceChildren(h('div', { class: 'page-adjust' }, (_adj.indexOf('只读') === 0 ? '本页只读：' : '本页能改：') + _adj.replace(/^只读[:：]?\s*/, '')), _view);
  else $('#view').replaceChildren(_view);
  $('#conn').className = 'conn ok';
  $('#conn').textContent = '已连接 · ' + (state.overview?.cfgMeta?.mode || '');
  hideLegacyGroupCards();
}

async function boot() {
  if (!TOKEN) { showGate(); return; }
  try {
    await loadOverview(); await loadFeatures(); loadNames().catch(() => {});
    await Promise.all([loadMuted().catch(() => {}), loadPending().catch(() => {}), loadLearn().catch(() => {})]);
    if (state.page === 'cost' && !state.cost) await loadCost();
    if (state.page === 'entry' && !state.entry) await loadEntry();
    if (state.page === 'access' && !state.access) await loadAccess();
    if (state.page === 'diag' && !state.backups) await loadBackups();
    rerender();
    if (state.page === 'diag') loadLogs();
  } catch (e) {
    if (!String(e.message).includes('401')) { $('#conn').className = 'conn bad'; $('#conn').textContent = '连接失败：' + e.message; }
  }
}

// 路由
function route() {
  const id = (location.hash || '#overview').slice(1);
  const _bootPage = window.__dshPage;
  window.__dshPage = null; // 只生效一次，之后按正常导航走
  state.page = PAGES.some((p) => p.id === _bootPage) ? _bootPage : (PAGES.some((p) => p.id === id) ? id : 'overview');
  boot();
}
window.addEventListener('hashchange', route);

$('#btnRefresh').addEventListener('click', async () => {
  try {
    await loadOverview(); await loadFeatures(); await loadPending();
    // REFRESH_PAGE：当前页的数据也要重新拉，否则“刷新”看着没变化
    const fn = { cost: 'loadCost', memory: 'loadMem', access: 'loadAccess', style: 'loadStyle',
      impr: 'loadImpr', cmds: 'loadCmds', logs: 'loadLogs', commands: 'loadCmds' }[state.page];
    if (fn && typeof window[fn] === 'function') await window[fn]();
    rerender(); toast('已刷新');
  } catch (e) { toast('失败：' + e.message); }
});
$('#tokenSave').addEventListener('click', async () => {
  const v = $('#tokenInput').value.trim();
  if (!v) return;
  TOKEN = v; localStorage.setItem('her.token', v);
  try { await loadOverview(); $('#tokenGate').classList.add('hidden'); await loadFeatures(); rerender(); }
  catch { $('#tokenErr').textContent = '口令不对，或服务没起来'; }
});
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }); }, 1000);
setInterval(async () => {
  if (state.view === 'overview') loadMediaStats();
  if (!$('#autoRefresh').checked || !TOKEN) return;
  try { await loadOverview(); if (state.page === 'features' || state.page === 'settings') await loadFeatures(); await loadPending(); rerender(); } catch {}
}, 20000);

route();

// PEOPLE_PAGE：人群档案（按群看今天最活跃的人 + 我的标记）
async function loadPeople() {
  if (!state.peopleGroup) { try { const q = new URLSearchParams(location.search).get('group'); if (q) state.peopleGroup = q; } catch {} }
  const gid = state.peopleGroup || ''; // 空 = 后端自动挑今天最热闹的群
  const r = await api('/api/people', { method: 'POST', body: { group: gid, limit: 50 } });
  state.peopleRows = r.rows || [];
}

function pageUtter() {
  const wrap = h('div', {});
  if (!state.utterStarted) {
    state.utterStarted = true;
    state.utterHours = state.utterHours || 72;
    loadUtter().then(() => rerender()).catch((e) => { state.utterErr = String(e && e.message || e); rerender(); });
  }
  const TAGS = [['', '全部'], ['ok', '正常'], ['odd', '怪'], ['ai', '人机味'], ['offtopic', '答非所问'], ['fake', '像编的']];
  const head = h('div', { class: 'card' }, [
    h('div', { class: 'card-h' }, '她说的话（调试用）'),
    h('div', { class: 'muted', style: 'margin:6px 0 10px' },
      '把她说过的话按时间倒序列出来，看到有问题的点一下标签；标签只是记录，不影响她。目前显示最近 ' + state.utterHours + ' 小时。'),
    h('div', { class: 'chips', style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, [
      ...[24, 72, 168].map((hh) => h('button', {
        class: 'btn' + (state.utterHours === hh ? ' primary' : ''),
        onclick: () => { state.utterHours = hh; loadUtter().then(() => rerender()); },
      }, hh + ' 小时')),
      h('span', { class: 'muted', style: 'margin-left:8px' },
        '共 ' + (state.utterTotal || 0) + ' 条' + (state.utterErr ? ' · 错误：' + state.utterErr : '')),
    ]),
    h('div', { class: 'chips', style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' },
      TAGS.map(([k, label]) => h('button', {
        class: 'btn' + ((state.utterTag || '') === k ? ' primary' : ''),
        onclick: () => { state.utterTag = k; loadUtter().then(() => rerender()); },
      }, label + (k && state.utterTags && state.utterTags[k] ? ' ' + state.utterTags[k] : '')))),
  ]);
  wrap.append(head);

  const rows = state.utterRows || [];
  if (!rows.length) {
    wrap.append(h('div', { class: 'card muted' }, '这段时间没有她的发言（或还没加载完）。'));
    return wrap;
  }
  const MARK = [['ok', '正常'], ['odd', '怪'], ['ai', '人机味'], ['offtopic', '答非所问'], ['fake', '像编的']];
  const table = h('div', { class: 'card' }, [
    h('div', { class: 'tbl-fit nowrap-tbl' }, h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, [h('th', { style: 'width:118px' }, '时间'), h('th', { style: 'width:150px' }, '会话'), h('th', {}, '她说的'), ])),
      h('tbody', {}, rows.map((r) => h('tr', {}, [
        h('td', { class: 'muted' }, fmtHm(r.at)),
        h('td', { class: 'muted' }, r.key),
        h('td', {}, [
          r.text,
          r.note ? h('div', { class: 'muted', style: 'margin-top:4px' }, '备注：' + r.note) : null,
          h('div', { style: 'margin-top:6px' }, MARK.map(([k, label]) => h('button', {
            class: 'btn' + (r.tag === k ? ' primary' : ''),
            style: 'font-size:12px;padding:2px 8px;margin:0 6px 4px 0',
            onclick: () => markUtter(r.id, r.tag === k ? '' : k),
          }, label))),
        ]),

      ]))),
    ])),
  ]);
  wrap.append(table);
  return wrap;
}

async function loadUtter() {
  const body = { sinceHours: state.utterHours || 72, limit: 300, tag: state.utterTag || '' };
  const r = await api('/api/utts', { method: 'POST', body });
  state.utterRows = r.items || [];
  state.utterTotal = r.total || 0;
  state.utterTags = r.tags || {};
}

async function markUtter(id, tag) {
  await api('/api/utts-mark', { method: 'POST', body: { id, tag } });
  const row = (state.utterRows || []).find((x) => x.id === id);
  if (row) row.tag = tag;
  rerender();
}

function fmtHm(ms) {
  if (!ms) return '—';
  const d = new Date(Number(ms));
  const p2 = (n) => String(n).padStart(2, '0');
  return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}



// P2E_E1：重绘后保留焦点与光标（搜索框输入不再失焦）
function rerenderKeepFocus() {
  const a = document.activeElement;
  const id = a && a.id;
  const ss = a && a.selectionStart;
  const se = a && a.selectionEnd;
  rerender();
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  try { el.focus(); if (ss != null) el.setSelectionRange(ss, se); } catch (e) {}
}


// P2E_E2：白名单添加入口（群规则页 / 人页共用）
async function addWhitelist(kind, raw) {
  const id = String(raw || '').trim().replace(/[^0-9]/g, '');
  if (!id) { toast('请输入' + (kind === 'group' ? '群号' : 'QQ 号')); return false; }
  try {
    await api('/api/access', { method: 'POST', body: { kind, id, action: 'add' } });
    toast('已添加，30 秒内生效');
    if (kind === 'group') { state.groupRules = null; await loadGroupRules(true); } else { await loadPeople(); }
    rerender();
    return true;
  } catch (e) { toast('没加上：' + (e && e.message || e)); return false; }
}
function addWhitelistRow(kinds) {
  const box = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' });
  for (const k of kinds) {
    const input = h('input', { type: 'text', placeholder: k === 'group' ? '群号，可粘贴' : 'QQ 号', style: 'width:150px' });
    box.append(input, h('button', { class: 'btn', onclick: () => addWhitelist(k, input.value) }, k === 'group' ? '添加群' : '添加私聊'));
  }
  return box;
}

// PEOPLE_AVA：QQ 头像（浏览器直连 qlogo，加载失败就露首字母，不占额外请求）
const PPL_AVA_COLORS = ['#4f7cff', '#22a06b', '#d98a26', '#b455c8', '#2fa8c9', '#d05061'];
function avatarOf(uin, name) {
  const initial = String(name || uin || '?').trim().slice(0, 1).toUpperCase();
  const ci = Number(String(uin || '').replace(/\D/g, '').slice(-4) || 0) % PPL_AVA_COLORS.length;
  return h('span', { class: 'ppl-ava', style: 'background:' + PPL_AVA_COLORS[ci] + ';color:#fff' },
    h('i', {}, initial),
    h('img', {
      src: 'https://q1.qlogo.cn/g?b=qq&nk=' + encodeURIComponent(String(uin)) + '&s=100',
      loading: 'lazy', alt: '', referrerpolicy: 'no-referrer',
      onerror: (e) => { e.target.style.display = 'none'; },
    }));
}

function pagePeople() {
  const wrap = h('div', {});
  wrap.append(h('div', { class: 'card', style: 'margin-bottom:10px' }, h('div', { class: 'kv', style: 'align-items:center;gap:10px' }, [h('b', {}, '添加'), addWhitelistRow(['private'])])));
  if (!state.peopleStarted) {
    state.peopleStarted = true;
    loadPeople().then(() => rerender()).catch((e) => { state.peopleErr = String(e && e.message || e); rerender(); });
  }
  const groups = (state.access && state.access.groups) || [];
  const gid = state.peopleGroup || '';
  const sel = h('select', { class: 'input', style: 'max-width:280px', onchange: (e) => {
    state.peopleGroup = e.target.value; state.peopleRows = null;
    loadPeople().catch(() => {}).finally(() => rerender());
  } }, h('option', { value: '', selected: !gid }, '（自动：今天最热闹的群）'), ...groups.map((g) => h('option', { value: g, selected: String(g) === String(gid) }, g + (nameOf('group', g) ? ' · ' + nameOf('group', g) : ''))));
  wrap.append(h('div', { class: 'card' },
    h('h3', {}, '人群档案'),
    h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, '按「今天在这个群说了多少」排前 50。我的标记只是加减分，不是强制开关。'),
    h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap' }, sel,
      h('button', { class: 'btn ghost', onclick: async (e) => {
        e.target.disabled = true;
        try { await loadPeople(); toast('已刷新'); } catch (err) { toast('刷新失败：' + err.message); }
        e.target.disabled = false; rerender();
      } }, '刷新'),
      h('span', { class: 'muted', style: 'font-size:12px' },
        state.peopleRows ? ('共 ' + state.peopleRows.length + ' 人' + (state.peopleGroup ? '' : '（自动选群）')) : '')),
  ));
  const rows = state.peopleRows || [];
  if (!rows.length) {
    wrap.append(h('div', { class: 'card muted' }, '这个群今天还没有统计到消息（或刚重启过）。' + (state.peopleErr ? ' 错误：' + state.peopleErr : '')));
    return wrap;
  }
  const tr = (r) => h('tr', { id: 'pr-' + r.uin, style: r.mark === 'bot' ? 'background:rgba(239,68,68,.12)' : r.mark === 'human' ? 'background:rgba(34,197,94,.12)' : '' },
    h('td', {}, avatarOf(r.uin, r.name), h('span', {}, r.name || '-')),
    h('td', { class: 'mono', style: 'font-size:12px' }, r.uin),
    h('td', { class: 'num' }, String(r.n)),
    h('td', { class: 'num' }, r.avgLen + ' 字'),
    h('td', { class: 'num' }, r.dup + '%'),
    h('td', { class: 'num' }, String(r.skips || 0)),
    h('td', { id: 'pv-' + r.uin }, r.verdict + (r.score ? `（${r.score} 分）` : '')),
    h('td', {}, ...['human', 'bot', ''].map((m) => h('label', { style: 'margin-right:8px;font-size:12px;cursor:pointer' },
      h('input', { type: 'radio', name: 'mk-' + r.uin, checked: (r.mark || '') === m,
        onchange: () => { // PEOPLE_MARK_REFRESH：标完立刻重拉，分数/系统判断当场更新
          if (r._saving) return;
          r._saving = true;
          api('/api/people-mark', { method: 'POST', body: { uin: r.uin, mark: m } })
            .then(async () => {
              r.mark = m;
              const rowEl = document.getElementById('pr-' + r.uin);
              if (rowEl) rowEl.style.background = m === 'bot' ? 'rgba(239,68,68,.12)' : m === 'human' ? 'rgba(34,197,94,.12)' : '';
              const vEl = document.getElementById('pv-' + r.uin);
              if (vEl) vEl.textContent = m === 'bot' ? '噪音机器人（手动）' : '真人（手动）';
              toast('已标记：' + (m === 'human' ? '人' : m === 'bot' ? '机器' : '未标'));
              const sy = window.scrollY;
              await loadPeople();
              rerender();
              window.scrollTo(0, sy);
            })
            .catch((e) => toast('没存上：' + e.message))
            .finally(() => { r._saving = false; });
        } }),
      m === 'human' ? '人' : m === 'bot' ? '机器' : '未标'))),
  );
  wrap.append(h('div', { class: 'card', style: 'margin-top:12px;overflow-x:auto' },
    h('table', { class: 'tbl-fit nowrap-tbl', style: 'width:100%;font-size:13px' },
      h('thead', {}, h('tr', {}, ...['昵称', 'QQ', '今天', '句长', '复读', '被拦', '系统判断', '我的标记'].map((x) => h('th', {}, x)))),
      h('tbody', {}, ...rows.map(tr)))));
  return wrap;
}
