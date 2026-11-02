// MCP 工具注册表（M2 第八步）：我们自己加的工具都放这里，mcp-snowluma-safe.js 只调 registerExtTools
// 新增工具 = 在这个目录加一个文件 + 下面数组加一行；flag 对应 cfg.socialV2.tools.<flag>，显式 false 时不注册。
import loop from './loop.js';
import impression from './impression.js';
import techNote from './tech-note.js';
import person from './person.js';
import style from './style.js';
import readGroup from './read-group.js';
import ownerTeach from './owner-teach.js'; // OWNERTEACH_PATCH

const TOOLS = [loop, impression, techNote, person, style, readGroup, ownerTeach].filter(Boolean);

export function extToolList() {
  return TOOLS.map((t) => ({ name: t.name, flag: t.flag }));
}

export function registerExtTools({ server, z, agentApi, cfg }) {
  const flags = cfg?.socialV2?.tools ?? {};
  const registered = [];
  for (const tool of TOOLS) {
    if (tool.flag && flags[tool.flag] === false) continue;
    const { shape, handler } = tool.define(z, agentApi);
    server.tool(tool.name, tool.description, shape, handler);
    registered.push(tool.name);
  }
  return registered;
}
