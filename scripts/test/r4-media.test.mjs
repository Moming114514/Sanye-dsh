// R4: 图片/表情字节解析的三段（取字节 / 判类型 / 是否降采样）+ 错误形状
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMediaFetch } from '../../src/lib/media.js';
import { looksLikeImageBuffer } from '../../src/safe-fetch.js';

const b64png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(b64png, 'base64');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-media-'));
const logs = [];
const stats = [];

function make(overrides = {}) {
  return createMediaFetch({
    stateDir,
    log: (m) => logs.push(String(m)),
    getBot: () => ({ getImage: async () => null, fetchFaceEntity: async () => null }),
    maxMediaBytes: 8 * 1024 * 1024,
    maxMediaPixels: 64_000_000,
    maxMediaCount: 5,
    safeFetchBuffer: async () => { throw new Error('HTTP 404'); },
    looksLikeImageBuffer,
    isSafeLocalMediaPath: () => true,
    mediaStatsBump: (field, reason) => stats.push([field, reason || '']),
    execFile: (file, args, opts, cb) => cb(new Error('no ffmpeg')),
    execFileSync: () => { throw new Error('no ffmpeg'); },
    ...overrides,
  });
}

// 1) 判类型 + 像素守卫
{
  const m = make();
  const got = m.acceptImageBuffer(PNG, '测试图');
  assert.ok(got && got.buffer.equals(PNG));
  assert.equal(got.mimeType, 'image/png');
  assert.equal(m.acceptImageBuffer(Buffer.from('not an image at all')), null);
  assert.ok(logs.some((l) => l.includes('不是有效图片')), 'non-image should log');
}

// 2) get_image 命中（base64:// 形状）
{
  const m = make({
    getBot: () => ({ getImage: async () => ({ data: 'base64://' + b64png }) }),
  });
  const got = await m.fetchOneBotImage({ kind: 'image', file: 'abc.png' });
  assert.ok(got && got.buffer.equals(PNG), 'get_image base64 should decode');
  assert.equal(got.mimeType, 'image/png');
}

// 3) 全失败：404 / 超时 / 非图片 → null，并且 stats 记 failed + 原因
{
  const m = make({
    getBot: () => ({ getImage: async () => { throw new Error('not found in cache'); } }),
    safeFetchBuffer: async () => { throw new Error('HTTP 404'); },
  });
  const got = await m.fetchOneBotImage({ kind: 'image', url: 'https://example.com/x.png', file: 'x.png' });
  assert.equal(got, null);
  assert.deepEqual(stats.at(-1), ['failed', 'http-404']);
  assert.ok(logs.some((l) => l.startsWith('[media] 图片获取失败')), 'failure log');
}
{
  const m = make({
    getBot: () => ({ getImage: async () => { throw new Error('request timed out after 30000ms'); } }),
    safeFetchBuffer: async () => { throw new Error('timeout'); },
  });
  const got = await m.fetchOneBotImage({ kind: 'sticker', url: 'https://example.com/x.gif', file: 'x.gif' });
  assert.equal(got, null);
  assert.deepEqual(stats.at(-1), ['failed', 'timeout']);
}
{
  const m = make({
    getBot: () => ({ getImage: async () => ({ data: 'base64://' + Buffer.from('garbage-bytes').toString('base64') }) }),
    safeFetchBuffer: async () => ({ buffer: Buffer.from('still garbage'), mimeType: 'image/png' }),
  });
  const got = await m.fetchOneBotImage({ kind: 'image', url: 'https://example.com/x.png', file: 'g.png' });
  assert.equal(got, null);
  assert.deepEqual(stats.at(-1), ['failed', 'not-image']);
}
{
  // 没有任何可用来源（base64 是垃圾、没有 url）→ no-source
  const m = make({
    getBot: () => ({ getImage: async () => ({ data: 'base64://' + Buffer.from('garbage-bytes').toString('base64') }) }),
  });
  const got = await m.fetchOneBotImage({ kind: 'image', file: 'g.png' });
  assert.equal(got, null);
  assert.deepEqual(stats.at(-1), ['failed', 'no-source']);
}

// 4) 降采样：超 8MB 的 URL → 用 4x 上限重取，降采样成功则返回 JPEG
{
  let calls = 0;
  const m = make({
    safeFetchBuffer: async (url, limit) => {
      calls += 1;
      if (calls === 1) throw new Error('图片超过大小限制（8388608 字节）');
      return { buffer: Buffer.alloc(1024), mimeType: 'image/gif' };
    },
    execFile: (file, args, opts, cb) => {
      const out = args[args.length - 1];
      const buf = Buffer.alloc(400);
      PNG.copy(buf, 0);
      fs.writeFileSync(out, buf);
      cb(null);
    },
  });
  const got = await m.fetchOneBotImage({ kind: 'image', url: 'https://example.com/big.gif' });
  assert.ok(got && got.buffer.length === 400, 'shrunk buffer should come back');
  assert.equal(got.mimeType, 'image/jpeg');
  assert.ok(calls >= 2, 'should refetch with 4x limit');
}

// 5) 动图抽帧：gif → 拼帧 PNG；非动图直接 null
{
  const m = make({
    execFile: (file, args, opts, cb) => {
      const out = args[args.length - 1];
      const buf = Buffer.alloc(300);
      PNG.copy(buf, 0);
      fs.writeFileSync(out, buf);
      cb(null);
    },
  });
  const flat = await m.flattenAnimated(Buffer.from('GIF89a....'), 'image/gif');
  assert.ok(flat && flat.buffer.length === 300, 'flatten should return sheet');
  assert.equal(flat.mimeType, 'image/png');
  const none = await m.flattenAnimated(PNG, 'image/png');
  assert.equal(none, null);
}

// 6) 缓存：cacheIncomingMedia 落盘 → readMediaCache 能读回来
{
  const m = make({
    getBot: () => ({ getImage: async () => ({ data: 'base64://' + b64png }) }),
  });
  await m.cacheIncomingMedia('group:1', 'msg1', [
    { type: 'image', data: { file: 'cached.png', summary: '' } },
  ]);
  const list = m.readMediaCache();
  assert.equal(list.length, 1);
  assert.equal(list[0].msgId, 'msg1');
  assert.equal(list[0].key, 'group:1');
  assert.ok(fs.existsSync(list[0].file), 'cache file exists');
  assert.equal(m.findCachedMedia('group:1').id, 'msg1:0');
}

fs.rmSync(stateDir, { recursive: true, force: true });
console.log('R4_MEDIA_OK stats=' + JSON.stringify(stats.slice(0, 5)));
