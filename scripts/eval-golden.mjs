#!/usr/bin/env node
// eval-golden.mjs —— 金标尺子（零模型成本）
//
// 用法：
//   node scripts/eval-golden.mjs            # 读 docs/golden-30.md，出报告
//   node scripts/eval-golden.mjs --json     # 机器可读
//   node scripts/eval-golden.mjs --min 0.9  # ok 比例低于阈值时 exit 1（默认 0.9）
//
// 设计：先用「可测的特征」给每条打一个预测标签，再和金标对比。
// 这样尺子本身是可验证的（特征准不准），而不是靠感觉。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MD = path.join(ROOT, 'docs/golden-30.md');

const LABELS = ['ok', 'weird', 'ai', 'offtopic', 'fake'];

// ---- 特征 ----
const F = {
  // 评论自己上一句：重说 / 上一句 / 确实太 / 我重新说（「害我」只是情绪反应，不算）
  selfComment: (t) => /重说|上一句|我那句|确实(太|有点)|我改一下|我重新说/.test(t),
  // 越界叮嘱：单条强命令词（「快去睡…接着逗我」这种玩笑不算）
  nagging: (t) => /快去|赶紧|别忘了|早点(睡|休息)|别熬|该睡了|必须(先|得)/.test(t) && !/逗|陪我|听你说|接着/.test(t),
  // 学习催促（对半熟的人最容易越界）：作业 / 写完 / 复习
  studyNudge: (t, scene) => /作业|写完|复习|做题|背书/.test(t) && /私聊/.test(scene || '') && !/3160624852/.test(scene || ''),
  // 人机味：作为 / 其实 / 总的来说 / 说实话 / 确实 /
  aiTone: (t) => /作为(一个|AI)|总的来说|说实话|其实我|确实(，|,|挺|是)/.test(t),
  // 只发表情 / 极短
  inert: (t) => /^\[表情包|^\[表情|^\[图片|^\[动图/.test(t.trim()) || t.trim().length < 4,
  // 反问收尾
  askTail: (t) => /[？?]\s*$/.test(t.trim()),
  // 自我追问（一条消息里两个问号以上）
  multiAsk: (t) => (t.match(/[？?]/g) || []).length >= 2,
  // 带具体词（数字/时间/名字/动作）：粗略用「含数字或含触发里的实词」
  concrete: (t, trig) => {
    if (/\d/.test(t)) return true;
    const grams = new Set();
    for (const m of (trig || '').matchAll(/[\u4e00-\u9fa5]{2,4}/g)) grams.add(m[0]);
    let hit = 0;
    for (const g of grams) if (t.includes(g)) hit++;
    return hit >= 1;
  },
};

function predict(item) {
  const t = item.she;
  if (F.inert(t)) return 'offtopic';
  if (F.selfComment(t)) return 'weird';
  if (F.aiTone(t)) return 'ai';
  if (F.studyNudge(t, item.scene)) return 'weird';
  if (F.nagging(t) && !F.concrete(t, item.he)) return 'weird';
  return 'ok';
}

function parseMd(md) {
  const rows = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((s) => s.trim());
    // | # | 时间 | 场景 | 他 | 她 | 标签 | 理由 |
    if (cells.length < 8) continue;
    const idx = cells[1];
    if (!/^\d+$/.test(idx)) continue;
    const label = cells[6];
    if (!LABELS.includes(label)) continue;
    rows.push({ i: Number(idx), time: cells[2], scene: cells[3], he: cells[4], she: cells[5], label, reason: cells[7] });
  }
  return rows;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const minIdx = args.indexOf('--min');
  const min = minIdx >= 0 ? Number(args[minIdx + 1]) : 0.9;

  if (!fs.existsSync(MD)) {
    console.error(`找不到 ${MD}`);
    process.exit(2);
  }
  const items = parseMd(fs.readFileSync(MD, 'utf8'));
  if (items.length < 10) {
    console.error(`金标条目太少（${items.length}），先补齐再跑`);
    process.exit(2);
  }

  const results = items.map((it) => ({ ...it, pred: predict(it) }));
  const okRate = items.filter((x) => x.label === 'ok').length / items.length;

  // 混淆：label -> pred 计数
  const conf = {};
  for (const r of results) {
    conf[r.label] = conf[r.label] || {};
    conf[r.label][r.pred] = (conf[r.label][r.pred] || 0) + 1;
  }
  // 检出率：非 ok 项里，预测也非 ok 的比例（尺子能不能抓到问题）
  const bad = results.filter((r) => r.label !== 'ok');
  const caught = bad.filter((r) => r.pred !== 'ok');

  const report = {
    total: items.length,
    okRate: Number(okRate.toFixed(3)),
    badCount: bad.length,
    caught: caught.length,
    catchRate: bad.length ? Number((caught.length / bad.length).toFixed(3)) : null,
    confusion: conf,
    missed: bad.filter((r) => r.pred === 'ok').map((r) => ({ i: r.i, label: r.label, she: r.she })),
    falseAlarm: results.filter((r) => r.label === 'ok' && r.pred !== 'ok').map((r) => ({ i: r.i, pred: r.pred, she: r.she })),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`金标 ${report.total} 条 ｜ ok ${Math.round(okRate * 100)}% ｜ 问题 ${report.badCount} 条`);
    console.log(`尺子检出率 ${report.caught}/${report.badCount}${report.catchRate != null ? `（${Math.round(report.catchRate * 100)}%）` : ''}`);
    console.log('');
    console.log('混淆（金标 → 预测）：');
    for (const [label, preds] of Object.entries(conf)) {
      const s = Object.entries(preds).map(([k, v]) => `${k}×${v}`).join('  ');
      console.log(`  ${label.padEnd(9)} ${s}`);
    }
    if (report.missed.length) {
      console.log('');
      console.log('漏检（金标判有问题，尺子没抓到）：');
      for (const m of report.missed) console.log(`  #${m.i} [${m.label}] ${m.she}`);
    }
    if (report.falseAlarm.length) {
      console.log('');
      console.log('误报（金标正常，尺子判有问题）：');
      for (const m of report.falseAlarm) console.log(`  #${m.i} [预测 ${m.pred}] ${m.she}`);
    }
  }

  process.exit(okRate < min ? 1 : 0);
}

main();
