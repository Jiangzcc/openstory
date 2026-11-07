# 站内助手工具 Schema 400 修复

日期：2026-11-07。状态：二开已实现；验证结果见下文。上游合入基线仍为 `003e2df7c4986fc236ea9a1c67c3f18089874d48`。

## 原有行为与原因

上游已有站内助手、MCP 工具和角色创建能力。本次没有新增角色创建功能。

用户使用 DeepSeek V4.1 Flash，发送“帮我创建一个动漫角色：韩立，就是凡人修仙传里面的主角”后遇到 `400 … parameters must be a JSON Schema of type object`。原失败对话的工具发现结果同时包含 `create_sequence` 和 `create_character`。

`create_sequence` 复用带 `CreateSequenceRequest` metadata id 的公共 API Schema。当前 Zod 4.6.5 经 TanStack AI 转换为 draft-07 时，根节点变成 `$ref`，对象内容放在 `definitions`；`create_character` 的根节点本身正常。发现该工具后，下一轮模型请求携带缺少根 `type: object` 的参数，供应商拒绝整次请求。

## 最小改动与兼容边界

- 仅在 `src/assistant/server/assistant-tools.ts` 的现有桥接层，对带根 metadata id 的 Zod 对象调用公开 `safeExtend({})`，保留字段、默认值、refinement 和未知字段处理，并使对象根直接序列化。
- 公共 API 与外部 MCP 继续使用原 Schema；嵌套定义及引用保持。角色创建、权限、组织钱包、工作流和存储仍走现有服务，无数据库或迁移改动。
- 回归文件为 `src/assistant/server/assistant-tool-schema.test.ts`；架构约束同步到 `docs/architecture/assistant.md`。

不只补写 `type: object`，以免漏掉真实字段与必填约束；不修改公共 API metadata id，也不引入另一套 Schema 解引用实现。后续上游升级 TanStack AI、Zod 或助手工具映射时，应复核根 Schema、按需发现结果和原 MCP 校验行为。

## 验证与限制

- 本地 HTTP Mock 复现：首次请求 25 个活动工具均为 object；发现角色及作品创建工具后，第二次请求原有 `create_sequence` 缺少根 object 类型。全部 167 个工具中仅此工具出现该结构。
- 新回归检查全部助手工具，并通过真实 `chat()` 和两种兼容适配器检查按需发现前后的 HTTP 请求体；HTTP 全部拦截，不执行创建或供应商调用。另检查原 API/MCP Schema 身份、默认值和跨字段校验。
- 用户授权真实调用后，在本地网页用 DeepSeek V4.1 Flash 和上述原句实测，已越过原报错点并创建“韩立”角色记录；角色详情可见设定字段。模型同时创建了一个作品；其删除已有角色的请求已被确认卡拦截并拒绝。
- 验收时详情页显示“暂无设定图”。模型回复中的“参考图正在自动生成”没有被实际界面证明，不能计为图像生成通过。工具选择及回复准确性也不由本次 Schema 修复保证。
- 最终相关自动化为 7 个文件、262 项测试全部通过；覆盖助手工具、两种文本协议、MCP 工具与服务、公共 API 输入及发现。`bun typecheck`、修改源码的 type-aware oxlint、格式检查与 `git diff --check` 通过。本次不部署。
