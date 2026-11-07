import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

test('MCP 不再注册 qq_set_wake_config（唤醒配置只由主人通过面板/API 修改）', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(ROOT, 'src', 'mcp-snowluma-safe.js')],
    cwd: ROOT,
    env: { ...process.env, SURFCORE_TOOL_PROFILE: 'full' },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'no-wake-config-tool', version: '1.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.length > 40, `tool list too short: ${names.length}`);
    assert.equal(names.includes('qq_set_wake_config'), false, 'qq_set_wake_config must not be exposed');
    for (const name of ['qq_mark_read', 'qq_close_conversation', 'qq_get_prompt']) {
      assert.ok(names.includes(name), `${name} should remain`);
    }
  } finally {
    await client.close();
  }
});
