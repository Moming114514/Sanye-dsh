// 表情库：从 bridge.js 的 STICKER_TODO_PATCH 迁出（M2 第六步）
// 只负责「生成【表情待补】提示行」，真正的收录/发图仍在 bridge（依赖实时内存状态）。
export function stickerTodoLine(entries, { max = 8 } = {}) {
  const pending = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && !e.content && (!e.emotion || e.emotion === 'neutral'))
    .slice(0, max);
  if (!pending.length) return '';
  const nos = pending.map((e) => '#' + String(e.no).padStart(2, '0')).join(' ');
  return `【表情待补】表情库里有 ${pending.length} 张还没写描述（${nos}）。手头闲的时候用 qq_get_sticker_image 看一眼、再用 qq_sticker_note 补一句「画面 + 情绪」，补完才能挑得准；一直不补就等于库里全是盲盒。\n\n`;
}

export default {
  id: 'stickers',
  title: '表情库',
};
