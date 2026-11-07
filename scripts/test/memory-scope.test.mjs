// 记忆按会话分权：群只看本群 + 公开 + 无归属锚点；私聊只看本人 + 公开 + 无归属锚点
// ANCHOR_SCOPE：有 conversationKey 的锚点/钉住只在该会话可见；无 conversationKey 的锚点/钉住全局可见。
import { filterCardForSession } from '../../src/ext/memory-scope.js';

let bad = 0;
const ok = (cond, msg) => { if (!cond) { bad++; console.log('FAIL ' + msg); } };

const rec = (id, extra = {}) => ({ id, text: 't-' + id, createdAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-01T00:00:00.000Z', importance: 40, clarity: 'clear', tags: [], ...extra });
const card = {
  records: [
    rec('priv', { conversationKey: 'private:1000000000', speaker: '他（私聊）', private: true }),
    rec('g1', { conversationKey: 'group:111', groupId: '111', speaker: '甲' }),
    rec('g2', { conversationKey: 'group:222', groupId: '222', speaker: '乙' }),
    rec('bili', { source: 'bili-dynamic' }),
    // 有归属的锚点：只在它自己的会话可见
    rec('anchor', { conversationKey: 'private:1000000000', anchor: true, pinned: true }),
    // 无归属的锚点：人格底座，所有会话可见
    rec('ganchor', { anchor: true, pinned: true }),
    rec('nokey', { speaker: '他' }),
    rec('other', { conversationKey: 'private:999999', speaker: '别人' }),
  ],
};

const ids = (res) => res.card.records.map((r) => r.id).sort().join(',');
const has = (res, id) => res.card.records.some((r) => r.id === id);

const g1 = filterCardForSession(card, 'group:111', { ownerQQ: '1000000000' });
ok(ids(g1) === 'bili,g1,ganchor', `群 111 → ${ids(g1)}`);

const g2 = filterCardForSession(card, 'group:222', { ownerQQ: '1000000000' });
ok(ids(g2) === 'bili,g2,ganchor', `群 222 → ${ids(g2)}`);

const priv = filterCardForSession(card, 'private:1000000000', { ownerQQ: '1000000000' });
ok(ids(priv) === 'anchor,bili,ganchor,nokey,priv', `主人私聊 → ${ids(priv)}`);

const other = filterCardForSession(card, 'private:999999', { ownerQQ: '1000000000' });
ok(ids(other) === 'bili,ganchor,other', `别人私聊 → ${ids(other)}`);

const all = filterCardForSession(card, '', {});
ok(ids(all) === ids({ card }), '无 key → 全量');

// 用例 1：带 conversationKey 的锚点只在归属会话可见
ok(has(priv, 'anchor'), '带归属的锚点应在其私聊可见');
ok(!has(g1, 'anchor') && !has(g2, 'anchor'), '带归属的锚点不应在群里可见');
ok(!has(other, 'anchor'), '带归属的锚点不应在别人的私聊可见');

// 用例 2：无归属的锚点任何会话都可见
ok(has(g1, 'ganchor') && has(g2, 'ganchor') && has(priv, 'ganchor') && has(other, 'ganchor'), '无归属锚点应全局可见');

// 用例 3：普通条目行为不变（群只见本群、私聊只见本人）
ok(!has(g1, 'g2') && !has(g2, 'g1'), '普通群条目不应跨群');
ok(!has(g1, 'priv') && !has(g1, 'nokey'), '群里没有主人私聊条目');
ok(!has(other, 'priv') && !has(other, 'nokey'), '别人的私聊没有主人条目');

console.log(bad === 0 ? 'MEMORY_SCOPE_TESTS_OK' : `MEMORY_SCOPE_TESTS_FAIL(${bad})`);
process.exit(bad === 0 ? 0 : 1);
