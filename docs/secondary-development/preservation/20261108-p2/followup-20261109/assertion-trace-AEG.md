# AEG 原断言与行为更正追溯（2026-11-09）

## Scope and evidence

- 固定上游 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`；原 P2 起点 L：`ce321c885f67e40fec1c8598bb759790d89359c9`；本轮开始 HEAD：`2b41bbf33b75c66035dc0af08df6eea79e3de929`。
- 本轮修复 9 条明确职责错配、2 条 schema 差异登记不足及 1 条伴随测试旧映射，共 12 个路径。与独立只读审查衔接，不修改业务代码；共享 `candidates.jsonl` 由主线按同目录 JSON 更正清单整合。
- 下列上游位置均指固定 B 的文件内容，可用 `git show 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0:<repo-path>` 读取；“当前”链接和符号按本轮实际源码定位。除下方冻结清单10表达式使用 B→冻结 HEAD 外，历史比较使用 B→L，并复核所列当前入口；没有重新审完 AEG 259 个源码路径或全部历史解决块。
- 原断言指具体输入、预期结果、拒绝条件或协议字段，不以用例标题、expect 总数或通过总数代替语义对应。新增断言也不冒充上游已有保障。
- [docs/secondary-development/preservation/20261108-p2/unit-verification.json](../unit-verification.json) 保存原 P2 的逐文件／用例结果。以下“归档通过”仅指其中 `files[].path` 对应记录；本轮未重跑测试，不依赖执行机忽略目录中的原始日志。
- 原 P2 分组台账和本轮补证范围分别记录。未列出的断言、专属 UI 交互、真实模型、远程数据库及部署不由本文件验收；主线另审的工程／E2E 差异不重复计入。
- Continue 计费问题由用户于 2026-11-09 明确暂缓；本轮不修该代码，也不以该项阻断本次记录修复。此处不表示该问题已经修复。

## AEG-09 MCP sequence card

入口：[src/platform/server/mcp/ui/sequence-card.ts:64](../../../../../src/platform/server/mcp/ui/sequence-card.ts#L64) 的 `SEQUENCE_CARD_SCRIPT`（`applyHost`、`render`、`watch`、`announce`）；原测试文件和当前测试文件都是 `src/platform/server/mcp/ui/sequence-card.test.ts`。

| 固定 B 原断言                                                                                                                                                  | 当前对应                                                                                                                                                                                                                                                                                                       | 处置与依据                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B:75 初始化发送 `ui/initialize` 和 initialized 通知；标题 `<b>Sea</b>` 只作为 textContent；counts 显示 shots=3、videos ready=2。                               | [src/platform/server/mcp/ui/sequence-card.test.ts:221](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L221) 保留同一初始化、文本和计数断言。                                                                                                                                                  | 原协议与用户文本语义保留；翻译不改 HTML 解释方式。                                                                                                                                                       |
| B:100 优先显示结构化错误 Gone，其次文本错误 Too big；取消显示固定英文句子。                                                                                    | [src/platform/server/mcp/ui/sequence-card.test.ts:246](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L246) 保留这三个原结果。[src/platform/server/mcp/ui/sequence-card.test.ts:182](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L182) 另测已知错误双语与服务端诊断原文。 | 原错误来源保留；固定文案翻译是新增策略。                                                                                                                                                                 |
| B:120 teardown/ping 正常响应、未知方法返回 -32601、其他窗口来源不产生响应。                                                                                    | [src/platform/server/mcp/ui/sequence-card.test.ts:266](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L266) 保留请求响应和来源隔离断言。                                                                                                                                                      | 未放宽 host 窗口或协议边界。                                                                                                                                                                             |
| B:140 第一次 10 秒请求 get_sequence_status/SEQ，处理中继续请求，完成后停止，向 host 只发一次 role=user 的完成消息。B:190 消息包含 Sea、SEQ、completed 和 2/2。 | [src/platform/server/mcp/ui/sequence-card.test.ts:286](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L286) 将此用例扩为 en/zh-CN 两个语言切换场景。第339行核对第一次请求；第367行核对切换不重置剩余轮询时间；第379行核对完成消息；第398行继续等待后请求和消息仍不增加。                      | 有意替换：Sea 改为中文用户标题以验证原文保留；英文消息保留原结构，中文消息用对应译文。轮询节奏、停机和 once-only 保障仍在，不因字面量变化判为丢失。依据 localization-plan.md 与 extension-policy.md §4。 |
| B:208 无 serverTools 的 host 在 60 秒后仍不发 tools/call。                                                                                                     | [src/platform/server/mcp/ui/sequence-card.test.ts:407](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L407) 保留该断言。                                                                                                                                                                      | 未凭语言切换增加 host 调用。                                                                                                                                                                             |
| B:225 appUrl 原样赋值，点击阻止默认行为并发 ui/open-link，URL 保持原值。                                                                                       | [src/platform/server/mcp/ui/sequence-card.test.ts:424](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L424) 保留链接和 host 消息断言。                                                                                                                                                        | 未翻译或改写目标 URL。                                                                                                                                                                                   |

新增检查位于当前第81、152、182行：语言切换重绘但不修改 structuredContent；自定义名称、未知状态／计数保留；固定错误随语言变化而实际诊断保留。原 P2 归档包含此测试文件的通过结果；本轮仅做静态逐项对应，不声称新做了真实嵌入宿主浏览器验收。

## AEG-10 Stitched player surface

入口：[packages/stitch/src/stitched-player-surface.tsx:60](../../../../../packages/stitch/src/stitched-player-surface.tsx#L60) 的 `StitchedPlayerSurfaceProps.labels`、[packages/stitch/src/stitched-player-surface.tsx:148](../../../../../packages/stitch/src/stitched-player-surface.tsx#L148) 的 `Download`、[packages/stitch/src/stitched-player-surface.tsx:454](../../../../../packages/stitch/src/stitched-player-surface.tsx#L454) 的 `StitchedPlayerSurface`。

- 上游行为：同一个 VideoPlayer 包含拼接播放器、字幕及可选下载控件；aria 标签使用固定英文，导出百分比由原下载状态产生。
- 当前差异：增加可选 playback/download/exporting 文案，未传入时保留原英文；外层新增 I18nProvider。B→L 净 diff 没有改媒体／cue 输入、下载执行体或事件回调。
- 原断言对应：本轮没有建立该组件专属的 B／当前渲染断言映射，不借 CLI、播放器纯逻辑测试或文件总通过数证明新 wrapper 与标签交互已验收。静态差异结论与播放／导出／浏览器验证分别记录。
- 处置：保留有依据的国际化桥接；将原 AEG-05 工程描述更正为本行为。需播放交互验收时再由主线明确场景，不能将本次文档修复记为已执行。

## AEG-11 Feedback dialog

入口：[src/platform/ui/feedback/feedback-dialog.tsx:29](../../../../../src/platform/ui/feedback/feedback-dialog.tsx#L29) 的 `FeedbackDialog`，其中 `handleSubmit` 调用既有 `submitFeedbackFn`，`handleOpenChange` 清理消息和 mutation 状态。

- 上游行为：trim 后的用户消息与可选邮箱进入同一 mutation；空消息／pending 不提交；成功清空消息，关闭重置状态；实际 Error.message 显示原文。
- 当前差异：只翻译标题、说明、输入标签／placeholder、按钮状态及非 Error 的失败兜底。B→L diff 未改提交、trim、FormData、邮箱字段、pending 或关闭逻辑。
- 原断言对应：本轮没有定位并核对该组件专属的上游交互用例，不能写成已验证邮件发送、提交次数或 UI 往返。这里的结论来自上述实际处理器与净 diff。
- 处置：按 localization-plan.md 与 extension-policy.md §4 保留展示桥接；不再归为公开作品创建、上传或发布。

## AEG-12 Search dialog

入口：[src/platform/ui/search/search-dialog.tsx:42](../../../../../src/platform/ui/search/search-dialog.tsx#L42) 的 `wait`、[src/platform/ui/search/search-dialog.tsx:52](../../../../../src/platform/ui/search/search-dialog.tsx#L52) 的 `hitLink`、[src/platform/ui/search/search-dialog.tsx:97](../../../../../src/platform/ui/search/search-dialog.tsx#L97) 的 `SearchDialog`。

- 上游行为：query.trim() 形成搜索词，原查询键为 `['search', term]`；沿用 debounce／AbortSignal、keepPreviousData、结果分组和既有 hit 链接。
- 当前差异：只翻译静态标题、状态、空结果句子、分组名及输入辅助文案；term 作为插值值保留，未知用户结果和 URL 不改。第106行的查询及其调用、阈值和导航处理器不在本次净改动中。
- 原断言对应：本轮没有建立搜索组件专属的上游交互断言映射；未验证真实搜索、组织数据隔离、键盘或跳转交互。
- 处置：保留有依据的搜索展示国际化，替换原公开创建／上传描述。静态结论不扩大为整个搜索后端验收。

## AEG-13 Client server boundary

入口：[src/platform/client-server-boundary.test.ts:83](../../../../../src/platform/client-server-boundary.test.ts#L83) 的 `projectPath`、第109行 `resolveLocal`，以及第308行起 `client/server import boundary`。

| 固定 B 原保障                                                                                                       | 当前对应                                                                                                                                                                                                                                                   | 处置与依据                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| clientRetainedImports 的源码片段断言区分 server-fn stripped 部分、真实保留 import、类型导入、side effect 与再导出。 | [src/platform/client-server-boundary.test.ts:350](../../../../../src/platform/client-server-boundary.test.ts#L350) 原语义断言保留；净差异未删除该组 expect。                                                                                               | 不因增加官方浏览器入口而移除原客户端／服务端保护。                                                 |
| 仓库 import 扫描要求无未覆盖 server-only 入口、无可到达的 server-only 依赖。                                        | [src/platform/client-server-boundary.test.ts:478](../../../../../src/platform/client-server-boundary.test.ts#L478) 的 holes 为空断言及末尾泄漏扫描仍在；诊断链条改为统一 projectPath。                                                                     | 路径诊断格式有意规范化，不放宽漏入规则。                                                           |
| 上游尚无该次官方 AI 浏览器子入口例外与 Windows／JSON 检查。                                                         | [src/platform/client-server-boundary.test.ts:308](../../../../../src/platform/client-server-boundary.test.ts#L308) 新增 ai/client 可用但 ai 根、adapters、testing 仍受限的断言；第316行覆盖斜杠／反斜杠；第334行验证脚本可追踪而 package.json 不入代码图。 | 新增正反例对应 assistant-approval-fix.md 的官方浏览器入口需求与 Windows 兼容；资源不作为脚本解析。 |

原语义断言保留与新增例外校验可直接从 B→L diff 重现；本轮不重复运行主线的架构守卫，也不把“公开创建接口通过”作为该守卫的证据。

## AEG-14 Platform domain blind

入口：[src/platform/domain-blind.test.ts:50](../../../../../src/platform/domain-blind.test.ts#L50) 的 `domainOf` 与第64行起 `src/platform is domain-blind`。

- B:71 的 composition roots 非空及受限路径断言，对应当前同名用例；B:78 的平台无违规 product-domain value import 断言仍在。
- 净差异仅两处：解析相对 import 目标及扫描文件相对路径时将反斜杠规范化为斜杠。composition-root 列表来源、domain 判断和 expect 均未替换。
- 处置：Windows 路径兼容；不是公共 API 业务规则变化。依 AGENTS.md 的 domain-blind 边界与保留计划 G 类工程审查记录。

## AEG-15 Log context

入口：[src/platform/log-context.test.ts:14](../../../../../src/platform/log-context.test.ts#L14) 的 header 映射断言、第28行 server entry 断言、第38行 `withContext` 嵌套上下文断言。

- 原断言：存在／缺失 tracing header 的映射；server entry 为 logging 配置 contextLocalStorage；await 内嵌套属性正确盖在日志记录上。B 原三组断言在当前文件中保留。
- 新增断言：[src/platform/log-context.test.ts:62](../../../../../src/platform/log-context.test.ts#L62) 并发两个请求并在 await 间交错，第80行要求两条记录，第82行分别核对 posthogSessionId 和 userId 仍属于各自 request。
- 处置：新增并发隔离回归，不替换原断言；该路径未改生产 log-context 模块。测试中的延迟只用于合成交错，不代表真实线上并发验收。本轮未重跑此工程用例。

## AEG-16 DB access allowlist

入口：[src/platform/server/db/db-access-allowlist.test.ts:58](../../../../../src/platform/server/db/db-access-allowlist.test.ts#L58) 的 `isRawDbSpec`、第66行 `isScopedFactorySpec` 与第72行 `db access allowlists`。

- B 原断言：实际 raw DB value-import 路径集合必须与 RAW_DB_ALLOWLIST 相等；实际 ScopedDb factory 路径集合必须与 SCOPED_FACTORY_ALLOWLIST 相等。当前第89、93行的精确集合断言保留。
- 净差异：相对 DB 模块目标、相对 scoped 模块目标及扫描文件名三处规范化反斜杠；没有更改 allowlist 常量、被扫描代码的职责或 expect。
- 处置：Windows 路径兼容的架构守卫；更正原公开创建描述。本轮不重复主线运行，也不由此认证所有数据库行为。

## AEG-17 Public API image model schema

入口：[src/platform/server/api-v1/input-schema.ts:172](../../../../../src/platform/server/api-v1/input-schema.ts#L172) 的 `apiCreateSequenceSchema.imageModels`；身份规则来自 [src/models/image-model-schema.ts:13](../../../../../src/models/image-model-schema.ts#L13) 的 `imageModelIdSchema`。

| 固定 B 原断言／契约                                                                                                 | 当前对应                                                                                                                                                                                                | 有意替换与依据                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上游公开 schema 的 imageModels 为非空字符串数组；supplied-options 用例中 imageModels=['flux-pro'] 能通过该 schema。 | [src/platform/server/api-v1/input-schema.test.ts:95](../../../../../src/platform/server/api-v1/input-schema.test.ts#L95) 将 fixture 改为 ['flux_2_dev']，其余 supplied-options 字段和解析结果断言保持。 | 从任意字符串收紧为内置或合法 custom-image: 身份；fixture 改用真实内置身份。上游 schema 接受 flux-pro 不等于完整生成路径曾可路由它，不将其臆造为已删除的模型能力。 |
| B 无此次 configured-image 身份入口的正反例。                                                                        | [src/platform/server/api-v1/input-schema.test.ts:155](../../../../../src/platform/server/api-v1/input-schema.test.ts#L155) 新增 custom-image:qwen 接受、no-such-model 和空 custom-image: 拒绝。         | 新断言直接保护新增输入准入规则。依据 image-channels.md、model-configuration.md 和真实共享 schema；不是仅增加默认值说明。                                          |

伴随测试 `input-schema.test.ts` 的共享候选原仅关联 AEG-08 泛化创建描述；本轮将它和源 schema 一并关联 AEG-17。第110行仍是原 `expect(result.success).toBe(true)`，有意替换的是第95行的模型 fixture；第155行起的准入／拒绝断言是新增保障，不冒充上游原断言。

`runOneShotCreate` 的原创建测试另见下方共享追溯：不能以这个 schema 用例宣称未知模型会执行、供应商绑定可用或实际生成／扣费完成。

## AEG-18 MCP storyboard model schema

入口：[src/platform/server/mcp/tools/structure-edits.ts:183](../../../../../src/platform/server/mcp/tools/structure-edits.ts#L183) 的 `regenerateStoryboardTool`，第189行对 analysisModel 的 refinement。

- 上游原行为：使用 isValidAnalysisModelId；当前有意扩展为该条件或 isCustomAnalysisModelId。只改变分析模型身份入口，不跳过 productionAccess 或替换共享 createSequences。
- locale 桥接：同文件 createSequenceTool、regenerateStoryboardTool 和 shotEdit 调用传入 promptLocale，继续复用原领域入口。
- 原 MCP tools 测试：B→L 在 [src/platform/server/mcp/tools.test.ts:153](../../../../../src/platform/server/mcp/tools.test.ts#L153) 等三处 context fixture 中只增加 promptLocale='en'，未删除／替换原工具执行断言。
- 新分支验证边界：保留原 MCP 用例不等于已直接覆盖 custom analysisModel 的 storyboard 请求。本轮未建立该专属调用的正反例映射；主线应关联 C 分区已有的适用 schema／配置证据，找不到对应场景时明确标为待验证。不能用命名空间校验通过推断绑定存在或真实模型可调用。
- 处置：保留有依据的管理员自定义文本模型入口，单列该 schema 变化，不再用鉴权概括整文件。

## Frozen inventory expression trace

本节仅处理主线 B→冻结 HEAD `2b41bbf33b75c66035dc0af08df6eea79e3de929` 候选清单中本分工的4份文件、10个变更原表达式。两侧 blob 和上游原行号已与源码核对，这4份当前工作区文件也与冻结 blob 一致。主线的126份解析、34文件78表达式统计是复核入口，不是断言丢失或全部行为已保留的证明；本节不重复7份工程／E2E追溯。

以下保留每条旧表达式、当前对应和变化依据；只去除 expect 外部的 await、统一缩进／分号以方便比较，匹配器及预期值均取自两侧源码。8条仅增加语言字段；其依据是 [system-prompt-localization.md:13](../../../system-prompt-localization.md#L13) 的必填语言、外部 API/MCP 英文默认与消费边界校验契约。另2条卡片表达式按双语矩阵有意替换固定英文，依据 [localization-plan.md](../../../localization-plan.md) 与 AEG-09。

### Create service assertions

文件：`src/platform/server/api-v1/create.test.ts`；来源：[assertion-inventory.jsonl:58](assertion-inventory.jsonl#L58)。B blob：`55bc243ab7fe305783c13abaa5694e61d1dae41f`；冻结 HEAD blob：`b400a151b336d7890b9dd55c163856f23f67fe52`。

**CREATE-01 — B:421 → [当前:426](../../../../../src/platform/server/api-v1/create.test.ts#L426)**

原表达式：

```ts
expect(mocks.createOrganizationLocation.mock.calls[0]?.slice(1)).toEqual([
  {
    name: 'Pier',
    description: null,
    // The style names no medium: photoreal.
    rendering: 'Photoreal live action',
    photoUrls: [
      expect.stringContaining('/r2/locations/organization-1/uploads/'),
    ],
  },
  {
    userId: 'user-1',
    organizationId: 'organization-1',
    triggerSheet: false,
  },
]);
```

当前对应：

```ts
expect(mocks.createOrganizationLocation.mock.calls[0]?.slice(1)).toEqual([
  {
    name: 'Pier',
    description: null,
    // The style names no medium: photoreal.
    rendering: 'Photoreal live action',
    photoUrls: [
      expect.stringContaining('/r2/locations/organization-1/uploads/'),
    ],
  },
  {
    userId: 'user-1',
    organizationId: 'organization-1',
    promptLocale: 'en',
    triggerSheet: false,
  },
]);
```

原断言仍逐字段要求名称 Pier、description=null、photoreal rendering、组织 uploads 路径及 user/organization/triggerSheet=false。当前只在 actor 增加 promptLocale='en'，没有把精确 toEqual 放宽为部分匹配。

**CREATE-02 — B:453 → [当前:459](../../../../../src/platform/server/api-v1/create.test.ts#L459)**

原表达式：

```ts
expect(mocks.triggerOrganizationLocationSheet).toHaveBeenCalledWith(
  expect.anything(),
  {
    userId: 'user-1',
    organizationId: 'organization-1',
    locationId: 'loc-Pier',
  }
);
```

当前对应：

```ts
expect(mocks.triggerOrganizationLocationSheet).toHaveBeenCalledWith(
  expect.anything(),
  {
    userId: 'user-1',
    organizationId: 'organization-1',
    locationId: 'loc-Pier',
    promptLocale: 'en',
  }
);
```

原 triggerOrganizationLocationSheet 的 expect.anything() 与 user/organization/locationId='loc-Pier' 均保留，当前仅增加 promptLocale='en'。同用例第452–458行仍独立约束创建先于 sheet trigger、触发两次；这些未变的断言不计入本清单的变更表达式。

### Sequence card assertions

文件：`src/platform/server/mcp/ui/sequence-card.test.ts`；来源：[assertion-inventory.jsonl:66](assertion-inventory.jsonl#L66)。B blob：`d5957f47d5ed7523a110c6cad16e12920466c396`；冻结 HEAD blob：`500ab1a197b3ce7a45c472e6f0861e5df2ecef82`。

**CARD-01 — B:188 → [当前:377](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L377)**

原表达式：

```ts
expect(els.meta?.textContent).toBe('completed');
```

当前对应：

```ts
expect(els.meta?.textContent).toBe(completed);
```

常量 completed 有意替换为 it.each 的确定预期：en='completed'，zh-CN='已完成'（第286–304行）。两种输入均仍精确 toBe；不是移除完成状态检查。

**CARD-02 — B:190 → [当前:379](../../../../../src/platform/server/mcp/ui/sequence-card.test.ts#L379)**

原表达式：

```ts
expect(messages).toEqual([
  expect.objectContaining({
    params: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'OpenStory: "Sea" (SEQ) finished: completed. 2/2 videos ready.',
        },
      ],
    },
  }),
]);
```

当前对应：

```ts
expect(messages).toEqual([
  expect.objectContaining({
    params: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
    },
  }),
]);
```

外层数组、objectContaining、params.role='user'、单个 content 项和 type='text' 保留，text 改为参数化的 message。英文预期为 OpenStory: "青牛镇山道" (SEQ) finished: completed. 2/2 videos ready.；中文为 OpenStory：作品“青牛镇山道”（SEQ）运行结束，状态：已完成。视频已就绪 2/2。（第286–304行）。用户标题 fixture 从 Sea 改为青牛镇山道，标题仍原样插值；2/2 计数和协议 envelope 仍受精确断言约束。第398–400行继续要求完成后无新增轮询或重复消息。

### Base workflow assertion

文件：`src/platform/server/workflow/base-workflow.test.ts`；来源：[assertion-inventory.jsonl:68](assertion-inventory.jsonl#L68)。B blob：`c588ff6d358154da85a1640f82d2f65e9b34e670`；冻结 HEAD blob：`61f7b7f6824b358bc3c1466a04726eb5cdc23b3a`。

**BASE-01 — B:205 → [当前:282](../../../../../src/platform/server/workflow/base-workflow.test.ts#L282)**

原表达式：

```ts
expect(seen).toEqual({
  userId: 'u1',
  organizationId: 't1',
  characterBible: [
    { characterId: 'c1', looks: [{ ...look, styling: 'scar' }] },
  ],
});
```

当前对应：

```ts
expect(seen).toEqual({
  promptLocale: 'en',
  userId: 'u1',
  organizationId: 't1',
  characterBible: [
    { characterId: 'c1', looks: [{ ...look, styling: 'scar' }] },
  ],
});
```

旧载荷 distinguishingFeatures='scar' 折入默认 look.styling 的完整 toEqual 仍保留；当前仅在预期载荷及相应输入第268行增加 promptLocale='en'。本项不把缺少 locale 的旧任务说成仍受兼容保障；语言契约明确拒绝缺少语言的任务。该结论只追溯此旧 styling seam，不由此验收该文件所有新增模型快照用例。

### Workflow compliance assertions

文件：`src/platform/server/workflow/client.compliance.test.ts`；来源：[assertion-inventory.jsonl:70](assertion-inventory.jsonl#L70)。B blob：`058eae01e8b71f03863fd4552ff3853c5fae2b2b`；冻结 HEAD blob：`d9431da6c6408915176a6e6d47fbcc746faf7aa9`。

**COMPLIANCE-01 — B:42 → [当前:42](../../../../../src/platform/server/workflow/client.compliance.test.ts#L42)**

原表达式：

```ts
expect(
  triggerWorkflow('/image', {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).rejects.toBeInstanceOf(AccountRestrictedError);
```

当前对应：

```ts
expect(
  triggerWorkflow('/image', {
    promptLocale: 'en' as const,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).rejects.toBeInstanceOf(AccountRestrictedError);
```

generation_suspended 输入、/image 路由和 rejects.toBeInstanceOf(AccountRestrictedError) 均未改；载荷仅增加 promptLocale='en' as const。仍是生成暂停拒绝，不是宽泛的任意失败。

**COMPLIANCE-02 — B:56 → [当前:57](../../../../../src/platform/server/workflow/client.compliance.test.ts#L57)**

原表达式：

```ts
expect(
  triggerWorkflow('/sequence-export', {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).resolves.toMatch(/^mock-/);
```

当前对应：

```ts
expect(
  triggerWorkflow('/sequence-export', {
    promptLocale: 'en' as const,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).resolves.toMatch(/^mock-/);
```

generation_suspended 下 /sequence-export 仍 resolves.toMatch(/^mock-/)，载荷仅增加 promptLocale='en' as const。该 fixture 明示 E2E_TEST=true，mock- 是本地短路结果，不能据此声称真实导出工作流已执行。

**COMPLIANCE-03 — B:70 → [当前:72](../../../../../src/platform/server/workflow/client.compliance.test.ts#L72)**

原表达式：

```ts
expect(
  triggerWorkflow('/sequence-export', {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).rejects.toBeInstanceOf(AccountRestrictedError);
```

当前对应：

```ts
expect(
  triggerWorkflow('/sequence-export', {
    promptLocale: 'en' as const,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).rejects.toBeInstanceOf(AccountRestrictedError);
```

account_suspended 下 /sequence-export 仍拒绝相同 AccountRestrictedError，载荷仅增加 promptLocale='en' as const。保留账户限制比仅暂停生成更严格的原分支。

**COMPLIANCE-04 — B:84 → [当前:87](../../../../../src/platform/server/workflow/client.compliance.test.ts#L87)**

原表达式：

```ts
expect(
  triggerWorkflow('/image', {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).resolves.toMatch(/^mock-/);
```

当前对应：

```ts
expect(
  triggerWorkflow('/image', {
    promptLocale: 'en' as const,
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
  })
).resolves.toMatch(/^mock-/);
```

revokedAt=NOW 的 generation_suspended 记录下 /image 仍 resolves.toMatch(/^mock-/)，载荷仅增加 promptLocale='en' as const。已撤销记录不阻止 mock trigger 的原条件保持。

**COMPLIANCE-05 — B:93 → [当前:97](../../../../../src/platform/server/workflow/client.compliance.test.ts#L97)**

原表达式：

```ts
expect(
  triggerWorkflow(
    '/image',
    { userId: USER_ID, organizationId: ORGANIZATION_ID },
    { enforcement: [row('generation_suspended')] }
  )
).rejects.toBeInstanceOf(AccountRestrictedError);
```

当前对应：

```ts
expect(
  triggerWorkflow(
    '/image',
    {
      promptLocale: 'en' as const,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    },
    { enforcement: [row('generation_suspended')] }
  )
).rejects.toBeInstanceOf(AccountRestrictedError);
```

调用方显式传入的 enforcement=[row('generation_suspended')]、/image 和 AccountRestrictedError 拒绝均保留，载荷只增加 promptLocale='en' as const；原来的不实时读取断言 expect(mockLoadComplianceRecords).not.toHaveBeenCalled() 仍在当前第108行，未被新语言字段替换。

这10条表达式均找到具体当前对应，没有据此确认原匹配器或原分支断言丢失。结论仅限所列输入、预期和有意替换，不推广为4份文件的所有行为或AEG全部路径审查完成；本轮没有重新执行这些测试。

## Retained auth API MCP assistant assertions

| 已实际复核的行为           | 固定 B 原断言 → 当前对应                                                                                                                                                                                                                                                                                                                                                                                                                      | 结论及边界                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP 管理员跨组织权限       | B 的 admin-sequence-access.test.ts:88 要求管理员 API Key 可用、管理员 OAuth 不可用、普通成员 Key 不可用；对应 [src/platform/server/mcp/admin-sequence-access.test.ts:129](../../../../../src/platform/server/mcp/admin-sequence-access.test.ts#L129) 三个条件仍在，另增 Cookie session 拒绝。                                                                                                                                                 | 上游原断言保留；不是恢复已取消的管理员默认不浏览规划。原 P2 有该文件归档通过结果。                                                                                                                                                                                                                                                                                       |
| Cookie 与 API Key 实际身份 | [src/platform/server/mcp/auth.ts:172](../../../../../src/platform/server/mcp/auth.ts#L172) 先由 getSession 校验，再分类。B auth.test.ts 的原断言保留，当前只加 x-api-key 身份用例；新增 [src/platform/server/mcp/auth-cookie.test.ts:141](../../../../../src/platform/server/mcp/auth-cookie.test.ts#L141) 所在文件使用真实 Better Auth 内存适配器覆盖 Cookie、Key 优先级及无效 Key+有效 Cookie 拒绝。                                        | 属于已实现安全修正；组织／compliance 查询边界有 Mock，不冒充实际线上组织数据库。无凭证和 OAuth 保障没有被新 Cookie 分支取代。                                                                                                                                                                                                                                            |
| 组织邀请、角色与管理员路由 | B→L 的 [src/routes/_app/admin/route.tsx:12](../../../../../src/routes/_app/admin/route.tsx#L12) 不改 guard；[src/routes/_app/organization/accept-invitation.tsx:22](../../../../../src/routes/_app/organization/accept-invitation.tsx#L22) 不改确认接受动作；[src/ui/settings/organization-settings.tsx:150](../../../../../src/ui/settings/organization-settings.tsx#L150) 的邀请／成员权限与条件子树来自上游，角色值仍 member/admin/owner。 | F 的路径记录和 [docs/secondary-development/preservation/20261108-p2/domains/validation-F-AEG.json:45](../domains/validation-F-AEG.json#L45) 明确说明保留上游门禁。这里是源码／差异核对；主线另审的 E2E 不重复验收，也不把原门禁记为二开新增。                                                                                                                            |
| 公开 API 共享创建          | [src/platform/server/api-v1/create.test.ts:123](../../../../../src/platform/server/api-v1/create.test.ts#L123) 的 B→L diff 增加 promptLocale 和默认配置 fixture；当前第426、459行的预期调用增加语言字段，逐条对应见[冻结清单追溯](#frozen-inventory-expression-trace)。原创建／导入／拒绝断言不由这些字段替换。                                                                                                                               | 模型默认值改由配置提供，语言传入共享服务；未重跑当前请求或创建资源。API image schema 的有意准入变化另见 AEG-17。                                                                                                                                                                                                                                                         |
| MCP 工具原行为             | [src/platform/server/mcp/tools.test.ts:153](../../../../../src/platform/server/mcp/tools.test.ts#L153) 的 B→L 差异仅三个 context fixture 新增 promptLocale。                                                                                                                                                                                                                                                                                  | 原工具断言未因语言桥接被改写；不据此给所有新自定义模型分支盖章。                                                                                                                                                                                                                                                                                                         |
| 助手原工具集／审批策略     | [src/assistant/server/assistant-tools.test.ts:15](../../../../../src/assistant/server/assistant-tools.test.ts#L15) 与 B 无净差异：工具集与名称、删除需审批而消费／读取不需、eager/lazy、成功 envelope 解包与错误抛出等六项原用例保留。                                                                                                                                                                                                        | 原文件同一性已核对，不只比较标题或数量；对应原 P2 归档结果可定位。                                                                                                                                                                                                                                                                                                       |
| 助手根 schema 修复         | [src/assistant/server/assistant-tools.ts:128](../../../../../src/assistant/server/assistant-tools.ts#L128) 仅对带根 metadata id 的 ZodObject safeExtend；[src/assistant/server/assistant-tool-schema.test.ts:207](../../../../../src/assistant/server/assistant-tool-schema.test.ts#L207) 核对 API metadata、MCP schema 对象身份、默认值和无效输入拒绝，第231行两种协议验证 lazy discovery 前后请求体。                                       | 新测试补充旧工具集保障。依据 [docs/secondary-development/assistant-tool-schema-fix-20261107.md:13](../../../assistant-tool-schema-fix-20261107.md#L13)；本轮没有重放 HTTP Mock 或真实供应商。                                                                                                                                                                            |
| 助手审批恢复               | B 的 conversation 仅按 kind/toolCallId 内联筛选；当前 [src/assistant/ui/assistant-approvals.ts:11](../../../../../src/assistant/ui/assistant-approvals.ts#L11) 对 generic 绑定额外核对 interrupt/run/generation，typed 分支仍用布尔参数；同文件第29行防重复旧快照、允许新 error 快照重试。                                                                                                                                                    | [src/assistant/ui/assistant-approvals.test.ts:98](../../../../../src/assistant/ui/assistant-approvals.test.ts#L98) 逐项断言允许执行一次、拒绝不执行、刷新恢复及批量决定；第267行覆盖重试、错误绑定和过期绑定。依据 [docs/secondary-development/assistant-approval-fix.md:13](../../../assistant-approval-fix.md#L13)。原 P2 有归档通过；本轮不新建浏览器验收或运行测试。 |

## Coverage that remains separate

本次逐路径更正覆盖上述 12 个净路径；附加追溯覆盖表内明确列出的 auth/API/MCP/assistant 行为、相关 F 门禁以及冻结清单4文件10个原表达式。原 AEG 259 项分组、F-AEG 86 项索引、其他工作流、完整语言资源、全部工程／历史断言和所有间接调用契约，均没有因此完成新的源码全量复核。

原 P2 逐路径 reviewed 状态和历史归档继续作为当时记录；不能从路径归类、8 个领域概括或测试数量推出所有非平凡行为块已经闭合。主线合并更正后仍需分别登记未核对行为、待验证场景和已明确排除的环境边界。本文件关闭的是已发现的记录错配和上述原断言追溯缺口，不生成全面保真证明。
