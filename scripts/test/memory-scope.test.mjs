// 记忆按会话分权：群只看本群 + 公开 + 永远不忘；私聊只看本人 + 公开 + 永远不忘
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
    rec('anchor', { conversationKey: 'private:1000000000', anchor: true, pinned: true }),
    rec('nokey', { speaker: '他' }),
    rec('other', { conversationKey: 'private:999999', speaker: '别人' }),
  ],
};

const ids = (res) => res.card.records.map((r) => r.id).sort().join(',');

const g1 = filterCardForSession(card, 'group:111', { ownerQQ: '1000000000' });
ok(ids(g1) === 'anchor,bili,g1', `群 111 → ${ids(g1)}`);

const g2 = filterCardForSession(card, 'group:222', { ownerQQ: '1000000000' });
ok(ids(g2) === 'anchor,bili,g2', `群 222 → ${ids(g2)}`);

const priv = filterCardForSession(card, 'private:1000000000', { ownerQQ: '1000000000' });
ok(ids(priv) === 'anchor,bili,nokey,priv', `主人私聊 → ${ids(priv)}`);

const other = filterCardForSession(card, 'private:999999', { ownerQQ: '1000000000' });
ok(ids(other) === 'anchor,bili,other', `别人私聊 → ${ids(other)}`);

const all = filterCardForSession(card, '', {});
ok(ids(all) === ids({ card }), '无 key → 全量');

// 群聊里绝不能出现主人的私事
const groupText = ids(g1);
ok(!groupText.includes('priv') && !groupText.includes('nokey'), '群里没有主人私聊条目');

console.log(bad === 0 ? 'MEMORY_SCOPE_TESTS_OK' : `MEMORY_SCOPE_TESTS_FAIL(${bad})`);
process.exit(bad === 0 ? 0 : 1);
