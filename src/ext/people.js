// people.js —— 人群档案接口（按群看今天最活跃的人 + 我的标记）
import { getPeople, setMark } from './bot-detect.js';

export default function createPeople() {
  return {
    id: 'people',
    title: '人群档案',
    routes: [
      {
        path: '/api/socialV2/people',
        handle({ body, sendJson }) {
          const gid = String(body?.group || '').replace('group:', '');
          const limit = Number(body?.limit || 50);
          return sendJson({ ok: true, group: gid, rows: getPeople(gid, limit) });
        },
      },
      {
        path: '/api/socialV2/people-mark',
        handle({ body, sendJson }) {
          return sendJson({ ok: setMark(body?.uin, String(body?.mark || '')) });
        },
      },
    ],
  };
}