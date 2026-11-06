# 管理员文本渠道实施记录

状态日期：2026-11-05。**二开功能已有实现；下文自动化、Mock、浏览器和构建成绩保留为上游合入前的历史记录。** 本次 organization 接口适配及统一验证见 [上游合入实施记录](upstream-merge-implementation-20261105.md)，不把历史成绩记作本轮通过结果。此前默认配置的范围与验证仍见 [管理员默认模型配置](model-configuration-assessment.md)。

## 原有行为、动机与来源

上游已有内置文本模型目录、原生 Google/xAI、OpenRouter、fal 和组织 LLMTR 等路由，以及用户选择器、余额扣费和工作流框架。此前更换模型接入地址、鉴权或目录主要依赖代码与既有密钥入口。

本次二开新增管理员维护的平台文本渠道、模型到渠道的显式绑定，以及从渠道读取候选后逐项接入的能力。现有渠道和模型目录继续保留；未匹配新绑定的内置模型仍使用原路由。本扩展不代表人民币销售价、充值结算、全模型上下架或全面禁止 BYOK 已经完成。

## 管理入口与配置

入口为管理菜单 → 模型配置（`/admin/models`）→ 文本渠道，与默认推荐及内部模型配置使用不同页签。

| 配置对象   | 当前实现                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文本渠道   | 页面自动分配渠道 ID；管理员设置名称、Base URL、启用状态及只写 API Key。协议可选 `openai-chat-completions` 或 `openai-responses`；新增默认仍为 Chat Completions。 |
| 模型绑定   | 选择已有内置文本模型 ID，或新增 `custom:` 模型 ID，绑定一个渠道及准确的上游模型 ID。每个逻辑模型 ID 只有一个当前绑定。                                           |
| 能力与限制 | 显式维护图像输入、结构化输出、工具能力、上下文及最大输出 token；最大输出不得超过上下文。启用的内置模型绑定必须保留结构化输出、工具及该内置模型已有的视觉能力。   |
| 成本参数   | 维护输入/输出每百万 token 的供应商 USD 估算单价，允许显式为零；不是 CNY 用户售价。                                                                               |
| 权限与并发 | 管理读取、保存渠道、保存绑定及候选发现均经 `systemAdminMiddleware`。保存携带 revision，并用已读配置的条件写入拒绝过期覆盖。                                      |

Base URL 使用 HTTPS；仅本地 loopback 地址允许 HTTP，不接受 URL 内嵌凭证、查询参数或 fragment。保存只校验配置形状与约束，不等于已经验证网关实际支持声明的能力。

输入格式、URL 及上游模型 ID 示例使用 placeholder；字段标签、密钥保留/变更规则、能力约束和 USD 计价单位继续显示，错误反馈不隐藏。

## 只读发现与增量接入

`syncTextChannelModelsFn` 使用所选渠道已保存的凭证，在服务端请求 `GET <baseUrl>/models`。读取有超时和响应大小限制、拒绝重定向，并按模型元数据和模型 ID 过滤非文本候选。New API 的 `supported_endpoint_types` 按所选协议匹配：Chat Completions 对应 `openai`，Responses 对应 `openai-response`；未声明端点的普通 OpenAI 目录仍保留现有候选规则。元数据缺失时的候选筛选不是能力认证。

同步返回上游 ID、名称及可选说明/厂商，**不写入配置、不覆盖或删除既有绑定、不自动启用模型，也不推断能力、token 限制或价格**。候选用于打开一个尚未启用的模型草稿，管理员补齐配置并保存后才成为绑定；也可手动填写上游 ID。

这里的“增量”是保留原目录、按候选逐项添加绑定，不是自动全量替换或自动对账；候选列表仍可能包含此前见过或已经绑定的上游模型。

## 目录、默认值与实际路由

`getTextModelCatalogFn` 从当前有效路由投影公开文本模型元数据，省略渠道 ID、Base URL、上游 ID 和凭证引用。`mergeTextModelCatalog` 按逻辑模型 ID 覆盖内置条目的展示/能力信息并追加自定义条目，保留原内置目录及原有隐藏属性。默认配置、选择器与运行时使用该目录的相应投影；按场景能力过滤候选。

只有“绑定启用、渠道启用、渠道存在凭证引用”同时成立，绑定才进入 `textModelRouting` 快照。

- 内置文本模型先尝试适用的组织凭证（`source: 'organization'`）：匹配模型的原生 xAI/Google、已映射的 LLMTR、OpenRouter、fal。凭证需通过现有有效性与解密检查。
- 无可用组织凭证时，若存在有效绑定，则使用绑定的 `source: 'platform', via: 'compatible'`；没有绑定时使用原平台原生/OpenRouter/fal 兜底。停用绑定或渠道只取消该覆盖，不是全局下架内置模型。
- 自定义模型必须在本次目录/路由中存在，并直接使用管理员绑定；不存在、被停用或未匹配的 `custom:` ID 不会交给组织或平台 OpenRouter/fal 猜测调用。
- 已保存默认配置引用的自定义模型后来不可用时，读取配置会舍弃该自定义覆盖并采用该配置项的代码默认；这与已匹配绑定在调用失败后换渠道是两种行为。

`createAdapter` 使用 `openaiCompatibleText`，将绑定的准确上游 ID、Base URL 和 Bearer Key 传入，按渠道协议选择 `api: 'chat-completions'` 或 `api: 'responses'`，实际请求 `<baseUrl>/chat/completions` 或 `<baseUrl>/responses`。Base URL 填写到 `/v1` 等公共前缀，由适配器补齐所选接口路径。Chat 使用 `max_tokens` 与 `stream_options.include_usage`，Responses 使用 `max_output_tokens`，不发送 Chat 专用的流选项及惩罚参数。结构化输出、工具、图片输入和 usage 由同一维护中的 SDK 按对应协议转换，并受声明能力与 token 上限约束；不推断网关实际能力，也不改变 LLMTR 或原生 Google/xAI 的接入方式。

**绑定失败不跨渠道 fallback。** 凭证不可读取、能力不足、鉴权/网络错误或供应商调用失败均返回原错误路径；不切换到另一个渠道、OpenRouter、fal、原生供应商或地区替代模型。`callLLMStream`、`regionRetriesFor` 和持久调用的 `withCallRoute` 对配置路由绕过原地区回退。兼容适配器的 SDK 重试设为零；工作流既有重试机制另行保留，不等于禁止同一路由的工作流重试。

## D1 加密凭证与轮换

本扩展复用现有 `app_metadata`，未新增模型专用表：

| 记录                                                              | 内容                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `secondary-development:text-channels:v1`                          | 配置 revision、渠道元数据、模型绑定；渠道只保存 `credentialId`、`hasKey` 和 `keyHint` 等引用/提示信息。 |
| `secondary-development:text-channel-credential:v1:<credentialId>` | 独立的加密凭证记录，保存密文、IV 和认证 tag。                                                           |
| `secondary-development:model-configuration:v1`                    | 已有默认/辅助模型配置，继续单独保存。                                                                   |

凭证复用 `encryptApiKey` / `decryptApiKey` 的 AES-256-GCM 实现及现有加密主密钥。**write-only 指管理员接口可提交新 Key，但读取不回显原文或密文；运行时仍需在服务端解密调用。** 重新打开表单时 Key 为空，留空保留旧凭证。变更已持有凭证的渠道 Base URL 必须同时提交新 Key，不能把原 Key 自动发送到新地址。

提交新 Key 会生成新 credential ID 并插入新加密记录；配置更新和新凭证写入通过条件更新与 D1 batch 关联。旧记录保留，以支持已经启动的任务。轮换影响后续快照；应用内保留旧密文不代表供应商仍接受旧 Key，供应商已撤销旧 Key 时旧任务会失败，不自动借用新凭证。

## 运行快照与重放

`ModelRuntimeConfiguration` 在默认/辅助模型配置之上增加 `textModelRouting`。`loadModelRuntimeConfiguration` 先取得路由及对应模型目录，再解析默认配置；`triggerWorkflow` 将服务器决定的快照写入 `modelConfiguration`，覆盖请求 body 中的同名值。服务器显式携带的已有快照、父子任务及失败处理继续继承原配置。

快照包含逻辑模型/渠道 ID、准确上游 ID、协议、Base URL、能力、token 限制、USD 成本单价及不可变 credential ID，**不包含明文 Key 或加密凭证内容**。`WorkflowScopedDb.models` 保存该快照，`credentials.resolveLlmKey` 按快照中的凭证 ID 读取和解密密钥，不在执行中重读当前渠道/绑定来改变路线。

因此任务启动后修改地址、协议、上游模型、成本单价、启用状态或轮换 Key，不会重定向已有任务。旧 payload 没有快照时使用代码默认和空路由列表，不在重放时读取最新渠道配置。详细契约见 [工作流快照](../architecture/workflow-snapshots-and-content-hash-staleness.md)。

## 供应商 USD 成本边界

`configuredTextCostUsd` 使用报告的 prompt/completion token 及快照里的输入/输出每百万 token USD 单价计算供应商成本估算；`configuredTextUsage` 和 `llmCostFromUsage` 使用该路由成本口径接入原记账流程。网关返回的同名 cost 字段不直接视为美元成本；缺少有效 token 数时报告成本缺失，不用未知金额或原生模型价格补算。

这些金额不是供应商账单核对结论，也不是 CNY 零售价。本扩展未实现汇率换算、利润加价、人民币钱包迁移或销售结算；原 LLM 调用前的粗略预估仍然保留。余额检查和工作流预留依据本次会调用的文本模型实际解析出的凭证来源，包含内部固定模型；存在无关 fal/OpenRouter Key 不代表已覆盖平台支出。候选发现也不会自动配置价格。

## 原生视频 Files 路径不被绑定捕获

视频人物检查 `analyzeTalentClipForOrganization` 和助手视频理解 `watchClipForOrganization` 保留原生 Google Files 上传/生成/清理路径。它们分别使用 `talentVideo` / `watchClip` 配置项，候选仍限于已有原生 Gemini 模型，并通过现有 `resolveOptionalKey('google')` 取得原生 Google 凭证，组织 Google Key 优先于平台 Google Key；配置文本绑定及组织 OpenRouter/fal Key 不参与 Files 路径。

即便同一个 Gemini ID 配置了文本渠道绑定，该绑定也不捕获上述 Files 路径。文本绑定声明支持图像输入不表示已经支持任意视频 API、Files 或原生视频理解协议。

## 主要实现与上游升级关注点

| 文件/模块                                                                                                                                                                                                       | 本次职责                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [text-channels.ts](../../src/models/text-channels.ts)、[text-model-catalog.ts](../../src/models/text-model-catalog.ts)                                                                                          | 类型、schema、路由快照、公开目录投影与内置/自定义目录合并。     |
| [server/text-channel-service.ts](../../src/models/server/text-channel-service.ts)、[server/db/text-channels.ts](../../src/models/server/db/text-channels.ts)                                                    | 渠道/绑定保存、凭证轮换、候选发现和 D1 持久化。                 |
| [text-channels.fn.ts](../../src/models/text-channels.fn.ts)、[ui/admin-models-page.tsx](../../src/models/ui/admin-models-page.tsx)                                                                              | 管理权限、管理入口、候选草稿及查询刷新。                        |
| [model-configuration.ts](../../src/models/model-configuration.ts)、[server/db/model-configuration.ts](../../src/models/server/db/model-configuration.ts)                                                        | 默认/场景配置按有效目录进行能力验证，原生视频配置保持独立约束。 |
| [model-runtime-configuration.ts](../../src/models/model-runtime-configuration.ts)、[scoped.ts](../../src/platform/server/db/scoped.ts)、[scoped-workflow.ts](../../src/platform/server/db/scoped-workflow.ts)   | 请求解析及工作流的模型/路由快照、凭证读取边界。                 |
| [server/configured-text.ts](../../src/models/server/configured-text.ts)、[server/create-adapter.ts](../../src/models/server/create-adapter.ts)、[server/db/api-keys.ts](../../src/models/server/db/api-keys.ts) | 兼容协议参数、供应商 USD 估算、凭证来源优先级及绑定引用。       |
| [server/llm-client.ts](../../src/models/server/llm-client.ts)、[server/llm-call-helper.ts](../../src/models/server/llm-call-helper.ts)                                                                          | 流式/持久调用及失败不跨渠道回退。                               |
| [talent/analyze-talent-media.ts](../../src/cast/server/talent/analyze-talent-media.ts)、[server/watch-clip.ts](../../src/models/server/watch-clip.ts)                                                           | 原生视频 Files 路径显式排除文本绑定。                           |

新增渠道/目录职责主要在模型域独立模块，必要桥接涉及既有管理员页面、模型默认/选择、凭证解析和工作流快照。上游升级应核对文本注册表的能力、兼容适配器与流式 usage 字段、原地区回退策略、ScopedDb 的请求/工作流边界、父子 payload 传播和原生 Files 路径；不要把本扩展应用成所有供应商的统一协议。

## 本次上游组织适配（2026-11-05）

本次集成采用上游 `6c0e82b2f72ad3ad7369c59dd3698dd454696da7` 的组织接口，同时保留管理员文本渠道、公开目录投影、原生 Files 路径和模型运行快照。具体整合范围、检查与剩余验收见 [上游合入实施记录](upstream-merge-implementation-20261105.md)。

| 合入前接口/标记                                          | 当前接口/标记                                                                      | 源码依据                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 请求/工作流 `teamId`                                     | `organizationId`；工作流仍要求 `userId`                                            | `src/platform/middleware.fn.ts`、`src/platform/server/workflow/base-workflow.ts` |
| 组织自带凭证的 `source: 'team'`                          | `source: 'organization'`；平台兼容绑定仍为 `source: 'platform', via: 'compatible'` | `src/models/server/llm-key-routing.ts`、`src/billing/server/preflight.ts`        |
| `analyzeTalentMediaForTeam` / `analyzeTalentClipForTeam` | `analyzeTalentMediaForOrganization` / `analyzeTalentClipForOrganization`           | `src/cast/server/talent/analyze-talent-media.ts`                                 |
| `watchClipForTeam`                                       | `watchClipForOrganization`                                                         | `src/models/server/watch-clip.ts`                                                |

401 归因继续使用实际失败来源；`src/platform/server/workflow/llm-auth-failure-source.ts` 只在解析历史 durable 错误时将旧 `team` 标记规范化为 `organization`。模型配置缺省及旧快照解码不等于接受缺失 `organizationId` 的旧任务身份。平台渠道管理继续经过 `systemAdminMiddleware`，组织 owner/admin 身份本身不授予平台配置权限。

本轮保留上游组织邀请、切换、共享及现有组织凭证优先规则；个人独立空间与余额、人民币结算和全面禁止 BYOK 仍未实施。以下助手修正、凭证优先级、Responses 和预览预算章节保留合入前的术语、测试数字、日志与运行限制，仅作历史证据；本节不新增本轮测试通过声明。

## 助手余额预检与错误提示修正

上游助手保留固定的 `estimateLLMCost(2)` 预检，要求团队扣除有效预留后的可用余额至少为 US$0.04。它不是模型的实际收费，也不按渠道输入/输出估算单价调整；配置渠道并不会赋予团队余额。

本次二开修正：助手按实际解析到的凭证来源执行预检，平台渠道不再因无关团队 OpenRouter/fal 等密钥而跳过检查；实际团队密钥保持原有免平台预检和免平台扣费行为。HTTP 错误仍交由 TanStack AI 判断能否重连，在连接边界保留服务端错误码、状态和原因；余额不足显示中文提示并复用已有低余额通知。

本轮定向回归为 6 个文件、82 项通过，包括真实 TanStack AI SDK/ChatClient、真实余额预检配合 Mock ScopedDb，以及中英文组件渲染；typecheck 和 lint 通过，本轮 11 个文件格式检查通过。全库格式检查仍因 2,196 个既存文件的格式问题失败，抽查未改动文件确认有 CRLF 换行差异；不批量修改无关文件。该修正不改变充值、计价或余额数据；没有执行真实供应商调用或余额写入，GLM 的真实调用仍需有足够可用余额后验证。

## 凭证优先级与余额、鉴权归属修正（2026-11-05）

本次修正内置文本绑定原先会抢先使用平台凭证的问题：内置模型优先使用适用且可解密的团队 Key，无可用团队 Key 后才选择管理员绑定及原平台兜底。第三方独有的 `custom:` 模型继续使用管理员绑定，已选绑定的调用失败仍不跨渠道回退。

新建序列、整段失败重试、smart-retry 整段回退和 Generate Shots 在同一份模型配置快照上解析 analysis 与内部 sceneSplit 模型的实际凭证来源，再决定余额检查和预留。任一文本调用使用平台凭证时，无关团队 Key 不再免除平台余额检查；原 script 阶段规则和纯媒体调用规则保留。助手继续按实际解析来源执行其原有预检和扣费。

分场、角色设定、镜头列表分别在实际 LLM 流捕获团队 401 的非敏感模型、source、via，通过 durable 错误字符串传递。失败处理不再重新解析父级 analysis 模型来猜测 Key 归属；平台失败及没有可信团队来源的异常不标记团队 Key。原生 Google 视频 Files 改为直接使用现有 Google 专用凭证入口，避免用户 OpenRouter Key 误占只能使用 Google Key 的路径，并在工作流检查中登记对应 CREDENTIAL 读取。

本轮相关回归去重后 398 项通过，覆盖加密 Key 的优先级、解密失败转平台后的预留、零余额、固定 helper、三个调用阶段及地区重试后的鉴权归属、助手历史图片、模型草稿和工作流边界。全库 `bun typecheck` 通过，30 个相关源码文件的格式检查通过，定向 type-aware lint 无错误，保留两处既有 warning。另有 2 项未修改的 `db-access-allowlist.test.ts` 测试因 Windows 路径反斜杠与预期正斜杠比较失败，不作为本轮业务回归通过项。

这些证据来自本地 Mock、独立内存 D1 和源码边界检查。本次没有执行真实供应商调用、用户数据库写入、浏览器验收、生产构建、部署、提交或推送；下文浏览器与构建记录属于此前文本渠道接入的验证。

## 验证结果

所有运行证据位于 [testing/model-channel-assessment-20261104](../../testing/model-channel-assessment-20261104/)。下列自动化与页面测试使用 Mock 凭证/服务及隔离数据库，不表示真实供应商生成已验收。

| 验证项              | 最终结果及证据                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查            | `bun run typecheck` 通过，见 `typecheck.log` / `typecheck.exit.txt`。                                                                                                                                                |
| 相关自动化测试      | 34 个文件、629 项全部通过。文件清单见 `test-files.json`，命令与结果见 `all-related-tests.log`。覆盖权限、加密/CAS、候选筛选、轮换后旧快照、子任务继承、无绑定旧路由、成本和不跨渠道回退。                            |
| 最后定向回归        | schema 工厂与目录合并收敛后，4 文件、21 项通过，见 `schema-final-tests.log`；运行时同步/布局/地区选模修正的 3 文件、81 项通过，见 `runtime-fixes-tests.log`。                                                        |
| Lint 与格式         | 全仓 type-aware lint 无 error；现有 warning 保留。检查本工作区改动文件的格式，未格式化无关文件。结果见 `lint.json`、`format-check.log`。                                                                             |
| 浏览器              | 12 项检查通过，见 `browser-validation.json` / `browser-check.log`。验证实际保存/读取、同步不自动保存、选择自定义模型为默认和内部步骤、匿名及普通用户不能保存、公开目录无渠道敏感字段、普通用户候选、停用后目录移除。 |
| Workerd Mock 调用   | 实际经过服务端凭证解析、`shortenPromptFn`、兼容 SDK、Mock `POST /v1/chat/completions` 并取得 SSE 答案；确认上游 model ID、Bearer 鉴权及 include_usage，见 `browser-validation.json`。                                |
| 页面布局            | 1440×980 和 390×844 检查通过，桌面一个内容滚动区，页面无溢出，卡片不裁切；截图为 `admin-text-channels-desktop.png` / `admin-text-channels-mobile.png`，用户候选为 `user-text-model-candidate.png`。                  |
| 构建                | `bun run build` 通过，见 `build.log` / `build.exit.txt`。                                                                                                                                                            |
| 数据及进程清理      | 恢复测试前默认配置，删除本次 Mock 渠道/绑定/凭证，见 `test-cleanup.json`；停止自己的 3020 服务与 Mock，不影响用户 3002 服务。                                                                                        |
| 真实网关            | 仅此前只读探测，见 `longshine-readonly.json`。未付费生成，真实流式、工具、结构化输出、视觉能力仍待验证。                                                                                                             |
| Cloudflare 部署网络 | 未验证 Workers 线上出站网络与该网关可达性。                                                                                                                                                                          |
| 部署/销售结算       | 未部署、提交或推送；未实施 CNY 销售价、汇率或真实收费闭环。                                                                                                                                                          |

候选同步的运行时问题已在 Workerd 定位并修正：请求使用 `redirect: 'manual'`，3xx 状态直接拒绝，不跟随到新的凭证目的地。用户模型选择器也识别已配置绑定，避免在渠道调用前按原供应商地区规则替换该模型；未绑定模型保留原规则。

匿名越权测试通过直接导入 server fn stub 重放，服务端返回拒绝且 revision 不变；未水合页面的 stub 会出现自定义错误反序列化提示，该提示不作为权限成立的唯一证据。普通用户的同样重放返回 `System admin access required`。

架构约定见 [模型配置](../architecture/model-configuration.md) 和 [渠道路由](../architecture/media-vias.md)。

## Responses 与输入提示调整（2026-11-05）

上一版管理员渠道将 Chat Completions 固定在 schema、适配器参数和候选筛选中；上游 LLMTR 已有 Responses 适配能力。本轮复用项目已安装的兼容 SDK，为管理员渠道增加明确的 Responses 选项，未新增依赖或数据库迁移。旧渠道保留原协议，修改协议只影响后续操作；在途快照继续使用原协议和凭证。

URL、自定义模型 ID 和上游模型 ID 的格式示例移入 placeholder；标签、密钥变更规则、能力约束、USD 成本单位及错误反馈保留。原管理页滚动边界保持不变。

所有新增供应商响应、工具结果与图片输入均为标注的本地 Mock，未调用真实供应商付费生成。

| 验证              | 结果与证据                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最终整合回归      | 36 文件、678 项通过，含原渠道、工作流快照、默认模型、目录、权限和国际化；`responses-final-tests.log`。                                                                                                                     |
| 真实 SDK 协议验证 | 17 项已纳入上述总数；仅替换环境与 fetch，验证两种请求路径、分段 SSE、usage、Responses 结构化输出、图片输入及工具两轮回放；401/403/429/503 与 SSE 失败均未换渠道。见 `src/models/server/configured-text-protocol.test.ts`。 |
| Workerd 浏览器    | 13 项通过，包含页面切换并保存协议、两种端点实际流式调用、New API 候选过滤、placeholder、公开目录、管理员权限、停用和布局。见 `responses-browser-validation.json`、`responses-browser-check.log`。                          |
| 静态及构建        | `responses-typecheck.log`、`responses-lint.log`（0 错误，仓库原有告警仍在）、`responses-build.log`、`responses-format-check.log`、`responses-diff-check.log`。                                                             |
| 规模约束          | `responses-size-check.json`；本轮修改的独立模块/测试文件均不超过 800 行，函数不超过 50 行。已有较大上游桥接文件保留原结构。                                                                                                |
| 页面预览          | `responses-channel-form.png`、`responses-admin-desktop.png`、`responses-admin-mobile.png`；桌面单内容滚动区、窄屏无文档溢出。                                                                                              |
| 清理              | `responses-test-cleanup.json`：恢复原默认配置，移除 4 个测试渠道及 4 个绑定、对应凭证，测试目录无残留；关闭自己的 3020/4034 服务，保留用户 3002 服务。                                                                     |

本轮浏览器验证聚焦渠道协议和管理表单；原用户选择器的浏览器证据仍是前述 `browser-validation.json`，不把它计入本轮 13 项。测试账号使用本地测试接口登录，未发送真实验证邮件。

证据文件均位于 `testing/model-channel-assessment-20261104/`。真实第三方平台的 Responses、结构化输出、图片输入和工具兼容性，以及部署后的 Cloudflare 网络，仍需单独验证；未提交、推送或部署。

## 预览渠道快照与分场输出额度修正（2026-11-05）

请求侧预览重绘原先只传递默认模型槽位，遗漏文本渠道绑定，图片审核拒绝后的提示词软化可能改走平台兜底。现在复用已有的 loadModelRuntimeConfiguration() 加载完整配置；直接预览入口采用同一加载方式，工作流内预览继续继承父任务快照，不在运行中重读当前绑定。

分场、角色与场景设定、镜头列表原先提前按内置目录计算输出额度，自定义模型因此落入未知模型的 32,000 token 默认值。新增独立的 llm-output-budget.ts 计算入口，复用现有目录转换与 getMaxOutputTokens()：在各步骤解析实际凭证后，兼容渠道读取其绑定快照中的上下文和最大输出，原有网关与原生渠道保留内置规格。分场和设定仍按上下文的 65% 计算，镜头列表仍按完整上下文计算，均受最大输出限制。

上游局部接入点仅为 shot-preview.ts 的配置传递和 scene-split-workflow.ts 的预算计算位置；未改数据库结构、页面配置、渠道优先级或鉴权处理。后续合入上游时重点复核预览的父子快照传递、三个分场阶段的模型选择及输出参数。原有鉴权测试的兼容渠道 Mock 补齐了真实凭证契约要求的 route 字段，测试断言和鉴权业务逻辑保持不变。

本次整合验证：9 个相关测试文件、145 项全部通过，包含预览新增 3 项和分场预算新增 8 项；原有分场 36 项用例保留并通过。命令覆盖 shot-preview、scene-split-output-budget、scene-split-workflow、max-output-tokens、configured-text、workflow-text-model-routing、no-mid-run-reads、workflow/client 和 scoped-workflow-models 测试。全量 bun typecheck 通过；改动 TypeScript 文件的 type-aware lint 为 0 错误，保留上游桥接文件两条已有 no-unnecessary-condition 告警。

上述生成与异常均为本地 Mock。本次未调用真实供应商、写用户数据库、执行完整浏览器审核拒绝流程或生产构建，未推送或部署。真实网关下的审核拒绝、提示词软化及长剧本输出仍需独立验收。

提交前未使用代码检查发现的 12 项导出已清理：11 个仅模块内部使用的声明改为私有，删除 1 个没有引用的币种常量；不改变配置、调用或计费行为。

## 合入后二开对抗性审查（2026-11-05）

配置读取与保存前目录校验、凭证读取使用现有 D1 onPrimary；两套管理保存回调绑定发起时的缓存会话代次，退出、换号或会话被拒绝后不再回填管理元数据。通用 durable LLM 辅助调用也按实际失败的组织凭证携带安全鉴权来源。

具体反例、二开与上游归因以及本轮验证边界见 [二开对抗性审查记录](adversarial-review-20261105.md)。路由优先级、平台兼容渠道的失败策略、不可变凭证引用和已启动任务的快照语义继续按前文执行。
