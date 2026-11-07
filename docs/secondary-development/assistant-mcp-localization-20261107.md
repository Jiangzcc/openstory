# 助手作品卡片国际化

日期：2026-11-07。状态：二开已实现；验证证据与边界见下文。上游合入基线仍为 `003e2df7c4986fc236ea9a1c67c3f18089874d48`。

## 原有行为与业务动机

上游已有站内助手、`get_sequence` 工具和 MCP Apps 作品卡片。站内助手与外部 MCP 宿主复用同一份 `sequence-card.html`，卡片展示作品摘要、媒体与就绪数量，并通过宿主读取生成状态。本次没有新增作品查询或卡片能力。

用户在中文助手中查看作品时，卡片仍展示 `completed`、`shots`、`images ready`、`Open in OpenStory` 等英文；内置 `Animated` 模板也显示英文。原宿主只传主题，卡片没有收到界面语言，现有 React 翻译资源不会自动进入隔离 iframe。

## 二开改动与范围

- `src/assistant/ui/mcp-app-frame.tsx` 在初始化响应中传入 `hostContext.locale`，并通过 `ui/notifications/host-context-changed` 更新语言和风格显示上下文；`getMcpViewFn` 和外部 MCP 资源继续返回共享 HTML。
- `src/platform/i18n/locales/en/mcp-views.json` 与 `zh-CN/mcp-views.json` 以英文原文为键，独立维护卡片的固定文字、已知状态、计数字段、海报说明和生成结束通知；服务端卡片只嵌入这组小资源。
- `src/assistant/ui/mcp-app-context.ts` 从工具结果提取合法风格 id，复用已有只读风格查询。仅当服务端记录 `isTemplate === true` 时，按现有 `presets` 资源生成以 id 为键的显示名称。
- `openstory/styleNames` 是本站宿主上下文的本地扩展，不是新增的 MCP 标准字段。卡片按真实风格 id 使用该映射，未知 id 保留结果中的原名称。

语言切换只重绘显示内容，不改写工具输入、工具结果、作品记录或对话历史，也不重新启动状态轮询。界面语言传递与模型任务必填的 `promptLocale` 是两条独立链路。

## 翻译与兼容边界

- 已知内置模板按 `isTemplate` 标记翻译，例如 `Animated` 显示为“动画”；同名自定义风格、自动生成风格及尚未解析到的风格保留原文，不能只凭名称判断模板。
- 作品标题、用户内容、模型 id、画幅比例及供应商诊断正文保持原值。未知状态保持原状态文本，未知计数字段沿用原卡片的字段名展示方式。
- 站内宿主跟随界面语言，默认简体中文并支持英文切换。外部宿主未提供 locale 时继续回退英文；不要求外部宿主提供本站风格名称扩展。
- 权限、组织隔离、余额、模型调用和数据库结构不在本次改动范围内；复用现有只读风格接口，没有新增 API 或迁移。

后续上游调整 MCP Apps 初始化协议、宿主上下文、卡片渲染或风格查询时，应保留语言更新和模板身份判断；外部宿主缺少本地扩展时仍需正常展示原始结果。

## 验证与边界

新增和扩展的单测覆盖如下：

- `src/assistant/ui/mcp-app-context.test.ts`：站内默认语言、中英模板名称、自定义同名风格隔离、风格尚未加载、合法 id 提取和原始数据保持。
- `src/platform/server/mcp/ui/sequence-card.test.ts`：中文卡片、切换回英文、状态与计数、按钮及海报说明、未知值保留、错误正文保留，以及既有初始化、轮询、通知和链接行为。
- `src/platform/i18n/runtime.test.ts`：独立语言资源的双语键与插值占位符一致性。

本轮执行助手工具、Schema、MCP 与卡片回归，共 7 个文件、259 项测试全部通过：

```bash
bun run test src/platform/server/mcp/ui/sequence-card.test.ts src/assistant/ui/mcp-app-context.test.ts src/platform/i18n/runtime.test.ts src/assistant/server/assistant-tool-schema.test.ts src/assistant/server/assistant-tools.test.ts src/platform/server/mcp/tools.test.ts src/platform/server/mcp/server.test.ts
```

`bun typecheck`、9 个改动 TS/TSX 文件的局部 type-aware oxlint、11 个源码及 JSON 文件的 `oxfmt --check` 和 `git diff --check` 通过。

浏览器在 `http://localhost:3000` 复用已有“青牛镇山道”的工具结果验收：中文卡片显示“已完成”“动画”、六个统计标签及“在 OpenStory 中打开”；英文卡片正常。保持卡片展开，从英文切回中文时文案即时更新，作品标题、数据和目标 URL 保持不变，结束后已恢复中文。中文截图保存在忽略目录 `.tmp/assistant-mcp-localization-20261107/sequence-card-zh-CN.png`，不纳入提交。

本轮翻译验收没有触发新的模型调用，仅验证本地实现，未部署。外部 MCP 宿主缺少 locale 的英文回退由单测覆盖，本轮未逐一连接外部宿主验收。
