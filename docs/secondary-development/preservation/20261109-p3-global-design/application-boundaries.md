# P3 全量职责设计：认证、公共入口与运行边界

日期：2026-11-09。固定源码 S=`db3ea57b5f419f69c51369c28819de17515b21f5`，基线 B=`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。本稿是结构设计与静态依据，不是运行验收。详见 [application-boundaries.json](application-boundaries.json) 及其结构化职责明细。

本区复用 P2 AEG/F-AEG 及补证，覆盖身份、Assistant、API/MCP、ScopedDb、工程兼容和非 src 归属。`retain-justified` 只说明静态依据支持当前 owner；每个路径的 P3 处置仍待逐块核对，不能永久批准历史 patch。

## 1. 上游权威与必要二开边界

- Better Auth、组织成员/角色、资源授权、共享钱包、Stripe/Gift Code 继续是原权威；不引入个人钱包、个人空间或管理员作品禁阅。
- 网页语言、外部 API/MCP 语言、任务语言和 iframe 显示语言分别核对；不把 cookie 语言当授权条件。
- Assistant 继续复用 MCP_TOOLS；schema 包装、审批/恢复、SSE 日志和扣费仍属于各自原控制流。
- SQL、raw Db 工厂、platform composition root 和 workflow 三类读 hatch 继续遵守现有边界，不为隔离二开增设例外。

## 2. 全部职责目录

每项详细当前调用链、必要桥接、原行为、计划、验收、停止条件及源码行证据在结构化明细。下面的暂留不等于本轮运行通过。

| 职责                                             | 静态状态         | 当前 owner 与拟处置                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AB-01 认证、组织与角色是上游权威                 | retain-justified | src/platform/server/auth/config.ts、src/platform/middleware.fn.ts；逐次升级复核上游权威与薄桥接；无等价缺口则保留原 owner，不复制 auth 或组织服务。                                                                                                                                       |
| AB-02 身份世代与迟到回调隔离                     | retain-justified | src/platform/ui/auth/auth-cache-generation.ts、src/platform/ui/auth/client.ts；以现有最小 helper 保留正确性；跨组新增消费者复用本契约，不统一搬迁所有 hook。                                                                                                                              |
| AB-03 公开页面的 session SSR 快照                | retain-justified | src/routes/docs.tsx、src/platform/session.fn.ts；每次 Router/SSR 升级比较上游预取语义；上游同等覆盖后删除本地重复预取。                                                                                                                                                                   |
| AB-04 语言只在入口解析，逐层显式传递             | planned          | src/platform/i18n/prompt-locale.ts、src/platform/middleware.fn.ts；单独收口助手语言读取：Caller 增字段，systemPrompts/toolContext 消费同一值。                                                                                                                                            |
| AB-05 MCP/API principal 与管理员能力             | retain-justified | src/platform/server/auth/request-principal.ts、src/platform/server/mcp/auth.ts；升级时对照真实验证和分类矩阵；上游等价修正后采用上游实现并保留行为回归。                                                                                                                                  |
| AB-06 助手入口消费模型策略并校验完整历史         | retain-justified | src/assistant/chat-model.ts、src/assistant/server/assistant-chat.ts；主线程核对 assistant-chat.ts:149/289：两段分别是 chat-specific 选项与约19行请求组合；没有足够证据支持搬出后降低重复。与 MC-01/04/05/07 保留现有 owner 一致，不把移动记作结构收益。                                   |
| AB-07 公共创建/增强的输入与配置契约              | planned          | src/platform/server/api-v1/input-schema.ts、src/platform/server/api-v1/create.ts；先对照 API 的配置推荐谓词与 models/网页现有策略，确认真正重复部分及最小归属，再决定提取；保留 public 函数兼容薄桥接，组织凭证解析与各场景默认值不得被通用化。若只有单处组合或移动文件则按停止条件保留。 |
| AB-08 上传、导出与发布沿用业务服务               | retain-justified | src/routes/api/storage/upload.ts、src/routes/api/storage/multipart.ts；在语言/模型批次后做边界对照；只删除上游已提供的重复桥接。                                                                                                                                                          |
| AB-09 共享工具目录与助手 schema 适配             | retain-justified | src/platform/server/mcp/server.ts、src/platform/server/mcp/tool-context.ts；SDK/Zod 升级时验证 raw/eager/lazy-discovered 请求体；若上游原生生成等价 object parameters，删局部 safeExtend 桥接。                                                                                           |
| AB-10 审批绑定与恢复按 SDK 身份执行              | retain-justified | src/assistant/ui/assistant-approvals.ts、src/assistant/ui/assistant-conversation.tsx；每次 AI SDK 升级先比较公开 interrupt API；原生绑定完整覆盖后移除相应旧形状分支。                                                                                                                    |
| AB-11 助手 HTTP 错误、日志恢复与收费生命周期     | retain-justified | src/assistant/ui/assistant-connection.ts、src/assistant/server/assistant-chat.ts；SDK 升级核对错误保真/四种请求隔离；仅上游提供等价 typed error 通道时删除桥接。                                                                                                                          |
| AB-12 页面上下文、附件与 MCP Apps 主机契约       | retain-justified | src/assistant/ui/use-page-context.ts、src/assistant/ui/page-context-from-cache.ts；展示组变动只消费 host/label 契约；上游新增协议能力时逐项合并，不把显示重绘当业务重启。                                                                                                                 |
| AB-13 ScopedDb 聚合、primary 读取与工作流窄面    | retain-justified | src/platform/server/db/scoped.ts、src/platform/server/db/scoped-workflow.ts；主线程核对 scoped.ts:563-576：约14行组合已有 getSnapshot/catalog/get 方法，无第二份模型决策。与 MC-13 保留快照边界一致。仅搬到 domain 并回调注入 Db 不构成收益，本设计不要求迁移该组合根。                   |
| AB-14 客户端、SQL、domain-blind 和请求上下文守卫 | retain-justified | src/platform/client-server-boundary.test.ts、src/platform/domain-blind.test.ts；每次上游 guard/解析器升级用当前规则做正反例对照；等价原生路径处理/并发覆盖后删局部重复。                                                                                                                  |
| AB-15 Windows 路径、CLI 与失败退出兼容           | retain-justified | e2e/start-webserver.ts、playwright.config.ts；逐次升级比较上游 env/launcher；仅在 Windows/POSIX 都同样传参、退出并保持 seed 顺序后删除相应本地 patch。                                                                                                                                    |
| AB-16 Windows Worker inspector 临时绕过          | planned          | vite.config.ts；下次 Node/CF Vite/Miniflare/workerd 升级，先在隔离 checkout 恢复默认并对照具体失败链；满足条件即删除 win32 分支。                                                                                                                                                         |
| AB-17 测试环境隔离与供应商防误调用               | retain-justified | playwright.config.ts、src/routes/api/test/route.ts；每次升级独立复核 replay 环境继承及 guard；上游提供等价 hermetic runner 或可控时钟后才删除重复适配。                                                                                                                                   |
| AB-18 E2E 准备通知、请求完成与原断言             | planned          | e2e/fixtures/test-utils.ts、e2e/fixtures/base.ts；上游具明确 readiness/完整响应等待时替换本地准备循环；单独保持一次业务提交与原断言。                                                                                                                                                     |
| AB-19 预览 D1 晋升、删除和 fork 仓库身份         | retain-justified | scripts/preview-db.ts、scripts/preview-db.test.ts；上游有同等原子晋升/删除保护和显式仓库语义时采用上游实现；分别核对竞态和失败重试。                                                                                                                                                      |
| AB-20 项目本地工具与 Hooks 执行边界              | planned          | .codex/hooks.json、.codex/hooks/command-policy.mjs；在实际宿主/Node 升级批次验证信任、事件形状、路径与失败传播，按覆盖等价性精简；不本轮安装或执行。                                                                                                                                      |
| AB-21 依赖与本地化开发支持的运行预算             | planned          | package.json、bun.lock；每次升级根据现存 importer 与模型/展示组契约重算最小依赖图，单独审锁图异常；保持原 heap 保护。                                                                                                                                                                     |
| AB-22 生成产物、机器噪声与忽略范围               | planned          | worker-configuration.d.ts、.gitignore；在确认 runtime/type hash/body 等价后收敛生成注释噪声，恢复上游一致形式或采用主线程确定的稳定生成规则。                                                                                                                                             |

## 3. 集成时的明确裁决

1. **AB-06 保留助手薄组合。** `assistantRequestModel`（assistant-chat.ts:289）约19行，组合已有目录、配置、`chatModelFor`、视觉检查及凭证解析；`modelOptionsFor`（:149）属于聊天搜索选项。没有证据支持新增通用 resolver，不能把移动这些代码计为收益。模型契约对接 MC-01/04/05/07。
2. **AB-13 保留允许的配置组合根。** `loadModelRuntimeConfiguration`（scoped.ts:563）约14行，只组装现有 snapshot/catalog/get 方法，无新增 SQL、权限或模型重选。与 MC-13 保持一致；不为了让文件变短迁出后注入 Db。后续若发现独立模型规则，再单立提取。
3. **AB-07 先核对默认上下文。** API 无参数默认与网页带模式、比例、保存偏好的默认不天然等价（use-generation-settings.ts:143/181）。仅提取确认相同的模型策略；不能用“配置/凭证相同”强行统一原本不同的行为。
4. **AB-04 是语言边界候选。** 助手从 Request 重复解析、外部 en 多种拼法可按完整入口集合评估。若只是增加 Caller 字段和多处传播而无实际简化，按停止条件保留原薄调用；不能重复此前上下文试点的形式提取。

## 4. 跨组契约

| 契约       | 归属                                      | 必须保持                                                                                                                                                                                    |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X-LOCALE   | 本组公共入口、展示/提示词组、工作流组     | Locale/promptLocale 必填；内部 cookie→zh-CN/en，外部 v1/MCP→en。无公开 locale 字段；任务、子任务/重试取冻结值；hostContext.locale 仅显示。                                                  |
| X-MODEL    | 模型策略/协议组、本组入口                 | 使用真实 model id/显式选择/省略默认、目录能力、可用性、实际 LlmKeyInfo.source/via/route、报价与错误；不暴露 secret，不猜 resolver，不静默跨供应商回退。模型组决定具体最小接口，本组只消费。 |
| X-WORKFLOW | 工作流/媒体组、模型组、本组 ScopedDb 接线 | 新任务冻结配置/locale/credential refs；原 instance 不覆盖载荷；SQL 留 db；三读取 hatch、claim、生成 step 内存媒体和小 checkpoint 保持。原 model wire 兼容与缺 locale 不兼容分别执行。       |
| X-VIEW     | 展示组、本组助手/公共入口                 | 显示标签/已知状态可翻译；用户内容/字段/资源 id/tool args/result/HTTP error code/MCP envelope 不变。iframe host 协议及只读 allowlist 不扩大。                                                |
| X-UPGRADE  | 主线程工程/验证、本组提供退出条件         | 每次升级逐项比较实际上游等价保障；先隔离恢复单个 patch 并复核原行为。新运行证据合格才删，不能以历史测试或依赖版本号永久保留/自动删除。                                                      |

契约采用当前真实接口；总设计的 roadmap 明确对应职责。X-* 是复核交接点，不代表等待另造一套接口，不把所有模型/展示批次作为每个入口整理的强制前置。

## 5. 公共入口内的批次依赖

| 顺序 | 批次   | 范围与验收目的                                                                    |
| ---- | ------ | --------------------------------------------------------------------------------- |
| 1    | AB04-a | 一次只收口助手语言读取，两个 Caller 构造点同步；保持外部行为。；依赖 X-LOCALE     |
| 2    | AB04-b | 独立规范外部 en 常量/传递，保持 storage 原认证和任务载荷。；依赖 AB04-a、X-LOCALE |
| 3    | AB07-a | 模型组给出最小配置推荐 owner 后，让 API/Enhance 只做薄消费。；依赖 X-MODEL        |
| 6    | AB22-a | 独立清理确认仅机器路径的生成注释噪声；非运行修复。；依赖 无                       |

AB21-b 对现有报告工具与 Storybook 的 Git/路径/失败退出、离线和请求/语言隔离验证属于当前 P3；只依赖显示契约复核。CI 接入单列 P4，不作为该动作完成门槛。

上述是本区候选顺序；全局首批与其它领域一起由总设计确定。AB-06/13 的保留复核不再伪装成迁移待办。任何提取均须先证明相同决策重复或原归属错误，保持 HTTP/HAL/SSE、工具参数/结果及外部 principal 的行为。

## 6. 非 src 的全部归属

固定 S 的非 src 共202路径：109在 P2 后未变、10旧路径再次变化、83新进入范围。这是归属，不是语义审批。

| 组              | 路径数 | 责任与退出条件                                                               |
| --------------- | -----: | ---------------------------------------------------------------------------- |
| NS-GOV          |    128 | 主线程治理/历史文档；各架构功能 owner 供事实修订建议；治理来源由总设计维护   |
| NS-AGENT-DOC    |     17 | 主线程治理；AB-20                                                            |
| NS-AGENT-EXEC   |     12 | 工程边界；规则正文仍归主线程；AB-20                                          |
| NS-E2E          |     15 | 工程/测试；业务契约交对应领域；AB-15、AB-17、AB-18                           |
| NS-LOCALE-TOOLS |     11 | 展示组语义；本组 CLI/Git/path/运行边界；AB-21                                |
| NS-CLI          |      5 | 本组入口契约；模型/提示词领域提供实际能力；AB-04、AB-07                      |
| NS-PREVIEW      |      2 | 工程运行安全；AB-19                                                          |
| NS-PORTABLE     |      5 | 工程跨平台与质量退出；AB-15                                                  |
| NS-INSPECTOR    |      1 | 工程临时兼容；AB-16、AB-21                                                   |
| NS-DEPS         |      2 | 工程集成；模型/展示组解释必要 importer；AB-21                                |
| NS-ARTIFACT     |      2 | 工程/主线程产物政策；AB-22                                                   |
| NS-STITCH-VIEW  |      2 | 展示组公共组件标签契约；README 由该 owner 供事实并由主线程整合；AB-12、AB-21 |

Windows/运行补丁每次相关上游或依赖升级逐项重审：先在隔离环境恢复单个上游实现，再核对 Windows/POSIX argv、退出、路径、环境、原断言和本地资源。等价证据成立才移除；依赖版本号或历史通过不能自动批准保留或删除。

具体退出条件包括：当前身份与迟到回调、docs SSR session、实际 principal、SDK schema/审批绑定/恢复、Windows inspector 握手、replay 隔离、E2E readiness、preview 原子晋升/删除，以及生成注释与忽略范围。没有证据时登记原因，不能为减少冲突移除必要安全保障。

## 7. 验收与未决

本轮没有运行测试、构建、服务、远程数据库、真实邮件或供应商；实施时各批复核原断言和相关 D1/Mock/Workerd/浏览器证据，历史计数不带入当前通过状态。

- 助手注释 session-only 与现有 osk_ 可解析面不一致；保留真实行为并登记，限制 principal 另需明确行为任务。
- X-* 在总设计的跨组契约与 roadmap 中明确 owner；均沿用既有接口，接口变更须重新核对，不各建 resolver/context。
- modelConfiguration 多次读取不等于原子快照；无本轮多管理员协调需求。
- AEG-17/18 为有意输入差异，custom schema 接纳不等于可运行；专门 MCP custom-storyboard 验证仍欠。
- generated-assets provider 的 ImageVia 类型扩展归模型/媒体组；stitch player 标签、报告工具语义归展示组。
- CONTINUE-LLM-SOURCE 继续 deferred；原组织 BYOK 当前仍存在，禁止声称全面禁用已实现。
- 治理 docs/agent 文本交主线程；registry1219 和本文件 non-src202 覆盖均非语义审批。

完整22项职责均为静态设计/复核结论。原始路径台账仍为 pending；实际实施、必要桥接逐块最小性、当前原断言追溯及跨职责验收关闭前，P3 不完成。
