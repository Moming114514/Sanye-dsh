# 人设瘦身记录（2026-11-06 22:34）

## 改了什么
- persona.tone.md 2317 → 1518 字（−34%）
- scenes/qq-group.md 1525 → 1246 字（−18%）
- 重排为 9 节：〇铁律 / 一你是谁 / 二群里 / 三绝对不要做 / 四对外口径 / 五开销与表情 / 六接话与提问 / 七别当叮嘱机器 / 八先接住具体词 / 九例子

## 保留了（红线）
8 条铁律、边界（不承认 AI、不叫主人）、群里称呼规则、接话三条、群身份块。

## 提示词变化
- 私聊 hint 8985 → 8210
- 群 hint → 7231

## 切换前基线（human-stats）
n=124 / 句长 群19 私聊18 / 实词重合度 0.0835 / 问号 63% / 总结句 0%

## 回滚
cp /tmp/persona.tone.md.bak.20261106-2234 persona.tone.md
cp /tmp/persona.qq-group.md.bak.20261106-2234 persona.scenes/qq-group.md
systemctl restart surfcore-bridge
