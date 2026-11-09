# P3 全量收敛设计：展示与语言

日期：2026-11-09。设计处置仅为 `planned` 或 `retain-justified`。未修改应用，未运行测试、构建、服务或远程操作，未提交。下文“二开已实现”仅描述固定源码存在的接入，不代表本轮运行验收。

## 1. 范围、来源与判断规则

- 纯上游 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`；源码 S：`db3ea57b5f419f69c51369c28819de17515b21f5`；P2 历史源码 P：`ce321c885f67e40fec1c8598bb759790d89359c9`。
- 采用主线程全量分母：B→S 1,219 路径（653M/566A），其中 src 1,017（606M/411A）；P2 1,128 全部仍在，新增 91，旧范围内 27 个 blob 再变。范围由长期需求和真实调用集合确定，不以 18 个冲突样本取范围。
- 复用 `20261108-p2/candidates.jsonl`、`domains/behaviors-F-root.md`、`behaviors-F-AEG.md`、`behaviors-F-BD.md`、`behaviors-F-C.md`、`behaviors-AEG.md` 及 `followup-20261109/`，并核对当前源码。历史测试不计为本轮通过。
- 主线程净路径关联 78 个历史编号，合并/historical-only 并集为 79；额外 FR-08 在历史证据。本区关联 43 个相关历史号；一个编号可跨职责共享，只覆盖本区切面，不批准该号全部业务。
- **FR-08 明确纳入 PL-02/03/04**：历史合并中的组织字段、对白刷新、上传格式/时长、分辨率和缺提示文案进入当前资源/原断言复核，不能因没有净路径关联而遗漏。源：`20261108-p2/domains/behaviors-F-root.md:14`。
- 已读根 AGENTS、.codex/project-rules、react-patterns、语言/扩展约定及相关架构文档。未发现子目录 AGENTS。原有 `src/routeTree.gen.ts` 工作区改动不纳入写入。
- 目录只是待审入口集合，不能按目录批准保留。未逐句裁决者为 **pending语义复核**；retain-justified 只论证具体接缝。全量职责设计不等于全量语义审查完成。

## 2. 上游、现有二开与仍规划

| 类别                   | 本区处理                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 上游已有               | Router/Query SSR、匿名首页/认证、组织邀请/切换/共享/角色/钱包、Stripe/礼品码、创作与模型目录、Studio、帮助/法律、账号邮件、助手/MCP、播放器/导出/发布是复用基础。                                                  |
| 二开已实现（源码观察） | 默认中文/浏览器记忆、每 router i18n、22 对应用/4 对平台资源、t/Trans、prose/英文锚点、账号邮件语言值、领域格式化/错误窄适配、模板身份显示、MCP hostContext、stitch labels。模型/渠道及 Studio 配置另有业务 owner。 |
| 仍规划/另案            | 人民币售价/核算、全面禁 BYOK、默认私有及正式部署选型，不通过译文实施；不恢复已取消的个人钱包/卡密商业改造，不删除现有组织/API/MCP。                                                                                |
| 跨组边界               | 网页 locale 交现有 promptLocaleFromRequest；任务/子任务/系统模板/风格快照归 generation-context；模型/凭证/规格/报价归 model-channels；身份/工具恢复归 application-boundaries。                                     |

## 3. 目标职责及当前完整接入链

### PL-01：locale、SSR 与 head（planned）

`getRouter → createApplicationI18n → createI18n` 创建独立实例；根 beforeLoad 经 `readLocale/readCookie` 读取 Cookie，dehydrate/hydrate 传 locale，RootLayout 输出 html lang。`useLocale.changeLocale` 切实例后写/读回 Cookie，失败显示 saveFailed。证据：`src/router.tsx:11-34`、`src/routes/__root.tsx:58-97,150-165`、`src/ui/i18n/use-locale.ts:7-26`。
`route.head → localizeMeta → LocalizedHead` 只更新带原句/namespace 标记的文字；canonical/URL/robots/图片值保留。登录同时有 route.head 直接 t 和 usePageTitle effect（`src/routes/_auth/login.tsx:21-37`），是可收敛候选，尚非运行缺陷结论。目标保留原 runtime/组装，统一现有 head 链；**登录不增加切换控件**。历史号：FR-01、AEG-06、F-AEG-01/04/06。

### PL-02：资源与消费契约（planned）

`ui/i18n/resources.ts → applicationResources` 与 `platform/i18n/resources.ts → resources` 分层；邮件/卡片无需应用全集。固定文案使用英文完整原句键；`translateStaticLabel` 先本 namespace 再 labels，未知回退；rich-text 保护插值。证据：`src/ui/i18n/resources.ts:46-95`、`src/platform/i18n/resources.ts:10-18`、`src/platform/i18n/labels.ts:4-14`。
传播放大来自组件、字典、静态目录/帮助和测试同步。Support 在 admin/studio/帮助中的不同含义不能自动去重。目标按原句+上下文+全部消费者确立 owner，保留有意异译；未审项 pending语义复核。差异脚本只找候选，不批准含义。历史号：FR-02/07/08、FBD-10、AEG-05/06/07。

### PL-03：外壳、账号/组织、设置、管理及公开页（planned）

未改的 `/_app/index → NewSequencePage` 是匿名首页；`/_app.beforeLoad` 预取 session/vias/balance/admin 后进 AppLayout。OrganizationSwitcher 仍 list/setActive→成功 reload；admin 父路由先鉴权。证据：`src/routes/_app/index.tsx:18-32`、`src/routes/_app/route.tsx:13-54`、`src/ui/layout/user-sidebar-footer.tsx:192-217`。
目标在真实 layout/settings/auth/反馈/搜索/法律组件原地 t/Trans。RouteErrorFallback 的 404/会话分支、resetQueryErrors→reset→invalidate，以及 QueryClient 401/403、旧身份响应、globalError 是控制流，不能当翻译冗余删除。OgImage 正文仍直接输出 SITE_CONFIG.description（`src/ui/marketing/og-image.tsx:38-39`），列待语义复核。历史号：F-AEG-01/02/03/04/06、FR-01/05/08、FC-01、AEG-01/11/12。

### PL-04：创作、模板与规范字段（planned）

`NewSequencePage/ScriptView → resolveComposerStyleSync` 区分自发 URL 同步/外部导航；明确 Try/随机才选择双语示例，切语言不清草稿。useTemplateTranslation/filterStyles 只对真实 isTemplate 加译名/搜索项。RenderingField 将 visible 译名与 hidden rendering 原值分离，schema enum 用 index→JsonValue。证据：`src/cast/ui/rendering-field.tsx:7-36`、`src/look/ui/library/style-library-view.tsx:90-101`。
`useUpdateScene → updateSceneFn → 合并服务器确认 updated → invalidateStructure` 原样保留（`src/shots/ui/use-scene-structure.ts:97-123`）。GenerationStopSlider 只译 pipeline 标签；移动海报已有 No preview yet 与真实 badge 兄弟节点（`src/sequences/ui/eval/eval-sequences-mobile.tsx:374-382`）。目标分清显示/规范值/缓存交互，不按文件长度或 hook 数迁移 core；prompt/对白/签署版本/ID 不随 locale 改。历史号：FR-02/06/08、FBD-01 至 FBD-07、FBD-09/10、FC-03/09。

### PL-05：格式化、错误与异步通知（planned）

useLocaleFormatting 只传 locale；通用相对时间 floor/月年与 history.relativeTime 的 round/30天后日期策略不同，不为统一改阈值（`src/ui/format-date.ts:10-39`、`src/sequences/ui/history-page.tsx:36-45`）。USD/微美元保留真实数值/精度。
localizeHistorySummary、localizeAssetLabel、localizePricingText 与 cast/reference/upload 窄适配只认已知完整输入；reference 被 cast/Studio/shots 跨目录消费。未知/歧义/用户/供应商文字回退。OpenStoryError 有 details 容器，但不能假定这些错误都有结构化 reason 参数。
`useLiveTranslation → getFixedT(null, namespace)` 稳定注册函数、完成时读当前语言，Mermaid effect 不应因翻译重复业务；邮件/任务固定发起语言。目标复用已有 owner，逐注册点核对，不批量换 hook。证据：`src/ui/i18n/use-live-translation.ts:5-10`、`src/ui/docs/mermaid-diagram.tsx:42-77`。历史号：FR-02/04/06、F-AEG-06、FC-01/02/04/09、FBD-02/03/07/08。

### PL-06：帮助、FAQ 与依赖图（retain-justified）

content-collections include→allDocs→/docs/$ loader 先 parse 英文取得 heading IDs；DocsArticle→localizeMarkdown(prose)→parseDocsMarkdown(译文,原ID)，围栏/链接/锚点保留。图只译 label/summary/note，节点/边/URL/search/onChange 保持原数据。证据：`content-collections.ts:5-24`、`src/routes/docs/$.tsx:11-40,57-84`、`src/ui/docs/markdown-ast.ts:116-133`。
P2 后 /docs.beforeLoad→ensureQueryData(sessionQueryOptions) 保证 footer 首屏快照，匿名 null 仍合法；不能删后让客户端猜。目标保留 AST/局部显示接缝，逐篇审 prose/FAQ JSON-LD/图说明，不复制中文整页。历史号：FR-01/03、F-AEG-01/04、AEG-07。

### PL-07：账号邮件（retain-justified）

sendVerificationOTP→resolveLocale(ctx Cookie)→sendOtpEmail→OtpEmail/EmailLayout；邀请从 request Cookie 得 locale 后传 sendOrganizationInvitationEmail。subject/body/preview/html lang 同源，经原 renderEmail/sendEmail。证据：`src/platform/server/auth/config.ts:254-266,327-350`、`src/platform/server/emails/email-service.tsx:112-148`。
目标保留发起时 locale、OTP/有效期/收件人/邀请 URL/失败路径。账号模板默认中文；公共 EmailLayout 默认 en 仍供其它邮件，不扩真实发送或非账号类型。历史号：AEG-01/06、F-AEG-01。

### PL-08：模型管理与 Studio（planned，仅展示/异步）

Route.useSearch(tab)→AdminModelsPage→forceMount 面板→useAdminModelConfiguration，复用 Suspense/query/mutation、真实 schema/AuthCacheGeneration。Studio 从 defaults/显式偏好→useConfiguredImageControls→evaluateStudioImageSettings，只在 ConfiguredImageStatus 翻 issue.key/values。
canSubmit 保留 defaultsReady/prefsLoaded/modeReady/上传/蒙版/rights；create mutation 等 invalidation 再交 queued tiles，轮询按 queued/running。部分交付只显示真实 requested/actual/outputs。证据：`src/studio/ui/studio-composer.tsx:386-458,897-914`、`src/studio/ui/use-studio-assets.ts:54-81,120-149`。
P2 后 characterSheetReferenceImageCount 的默认 look 照片计数已进费用提示，属操作判断，不能作为纯 t 撤回。目标消费模型/生成组已审结果，复用 Status/Estimate/Output，不在 UI 重算默认/规格/报价。历史号：F-AEG-05、FC-02/05/06/07/08/09、FBD-04/05/06、AEG-01。

### PL-09：助手 MCP 卡片（retain-justified）

McpAppFrame→getMcpViewFn→共享 SEQUENCE_CARD_HTML；mcpResultStyleId→useStyle→mcpAppHostContext 仅对 isTemplate===true 映射风格名。初始化/host-context-changed 传 locale，卡片 applyHost 重绘；React Provider 不穿透 iframe。证据：`src/assistant/ui/mcp-app-context.ts:8-38`、`src/assistant/ui/mcp-app-frame.tsx:69-114,170-198`。
tools/call→callMcpReadToolFn→VIEW_CALLABLE_TOOLS→原 MCP tools，不扩权限。保留小 mcpViews、协议/sandbox/轮询终止/一次通知；站内随 UI，外部无 locale 回退 en；用户标题/未知状态/原错误保留。历史号：AEG-03/06/09、FR-04。

### PL-10：stitch 与播放展示（retain-justified）

/stitch/$id.loader→getStitchFn→StitchPage→useStitchPlayerLabels→StitchedPlayerSurface，剧场复用 labels。独立包真实可选接口只有 playback/download/exporting，缺省英文；没有 StitchedPlayer locale prop。官方 I18nProvider 未传 locale，按本地官方文档继承 lang（`packages/stitch/src/stitched-player-surface.tsx:35-78,453-460`；`node_modules/@videojs/react/docs/reference/api/i18n-provider.md:23`）。
保留 labels/provider、lazy/mounted、媒体事件与错误重试；字幕 srcLang/对白/cues 不由 UI 语言推断。剧场服务端导出、公开 stitch 自有浏览器下载、manifest 和社交发布是不同原功能，保持路由/生命周期/安全。历史号：AEG-08/10、FC-04、FBD-08、FR-01/04。

## 4. 全职责覆盖与不可避免的接入

| 用户流/内容                                               | 全部待审入口集合                                                          | 最少接入及保留项                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 匿名首页、认证、设备/OAuth、gift                          | routes/_app/index、_auth、device、oauth/consent、gift                     | 原鉴权/回跳；实际组件 t/Trans/head。                               |
| 导航、组织/成员/邀请、钱包/Stripe/礼品码、开发者/密钥设置 | ui/layout、ui/settings、platform/ui/auth、organization-select、billing/ui | 文案/错误/格式化，不裁剪组织/BYOK/API。                            |
| 序列/剧本/场景/分镜、角色/look/地点/元素、音乐/历史/资产  | sequences/ui、shots/ui、cast/ui、audio/ui、motion/ui                      | 控件附近 t、规范值/claim/动作保持。                                |
| 风格/画廊/模型目录及详情                                  | look/ui、look/localization、models/ui、routes/_app/models/gallery/styles  | 模板身份、静态标签；用户内容/技术 ID 不译。                        |
| 用量/审核/support/模型渠道、Studio image/video            | routes/_app/admin、models/ui、studio/ui                                   | 原权限/查询/保存；真实 ready/issue/estimate/output，保留异步选择。 |
| 法律/举报/定价/connect/OG                                 | routes/_app/privacy/terms/report/pricing/connect、ui/marketing            | 逐长文/链接/真实币种审查；品牌/用户值区别处理。                    |
| Docs/FAQ/依赖图/搜索                                      | content-collections include、ui/docs、platform/ui/search                  | prose/英文锚点、图显示，不动图算法。                               |
| 助手、隔离卡片、预览/剧场/公开 stitch                     | assistant/ui、mcp/ui、motion/ui、stitches/ui、packages/stitch             | hostContext 或 labels；保留各播放/发布/导出通道。                  |
| 账号邮件、错误/表单/编辑器/听写等辅助态                   | platform/server/emails、ui/error/schema-form/text-editor/voice            | 请求时 locale、原输入/错误类别、aria/pending/empty/retry。         |

上述是待审集合，不按目录批准。纯文案 t/Trans、aria/placeholder 是不可避免的局部 diff；依据须是具体原动作/插值/消费者。移动 core、增加 helper 或差异报告不能据此宣称冲突缩减。JSON 列真实 owners、符号、必要桥接及逐批影响路径。

## 5. 可执行批次、前后行为、回归入口与停止条件

全部批次 planned；retain-justified 批次可以只交保留依据，不强制造 diff。先固定新 before SHA 并复核 S 后增量。本轮列的是未来验收条件，没有运行结果。

| 批次/前置                           | 前后对照与动作                                                                                                | 未来回归入口/验收                                                                                                                        | 停止条件                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| PL-B01，无                          | 默认中文/记忆/独立实例不变；核对 Cookie→SSR→hydrate→任务语言交接，保留当前组装。                              | preference/runtime/rendering；双语并发、非法 Cookie、保存失败、刷新/直达子页。                                                           | 全局单例、浏览器 API 进 SSR、身份/任务或未定时区被改。                          |
| PL-B02，B01                         | 登录相同 title/认证；route.head 拟改 localizeMeta(auth)，退出唯一 usePageTitle 调用后确认能否删无消费者文件。 | head.test + 登录 SSR/hydrate/返回导航，OG/canonical/robots 原值。                                                                        | 标记链等效更新未经证实则保留 effect，不用延时猜时序；不记全量冲突收益。         |
| PL-B03，B01                         | 原句键/复数/变量/标签保持；按上下文/完整消费者裁决资源，保留有意异译。                                        | resources/rendering；自定义同名、恶意插值、富文本、敏感政策；未决句 pending语义复核。                                                    | 按重复键自动合包、语义 key、改用户原文或复制页面。                              |
| PL-B04，B02/B03                     | 原 handler/queryKey/search/权限/FormData 不变；逐页审 t/Trans/错误/公开长文，含未改重定向路由。               | auth/organization/admin/pages/localization.spec；匿名/角色/过期会话，双语/移动/键盘/返回，邀请 URL/金额比对。                            | 夹带 BYOK/人民币/组织裁剪，或更改缓存/恢复控制流。                              |
| PL-B05，B03                         | 草稿/dirty/ID/URL/规范值/服务器确认缓存保持；保留模板身份/RenderingField/schema enum，逐块分清显示/业务。     | rendering-field/schema-form.i18n/composer-style-sync/use-scene-structure/mobile；manual-pipeline/characters/locations/editing 流程。     | 改 stopAt/claim/签署原文/模板或配方快照/报价判断；整体迁移 composer。           |
| PL-B06，B03                         | 日期两种原阈值/舍入及 USD/缺价保持；现有领域窄适配，未知精确回退。                                            | history/asset/reference/cast-conflict；生产者对应、固定时钟边界、歧义/用户文本，跨时区单列。                                             | 为消除字符串适配改历史/协议/账务，或造通用错误翻译器。                          |
| PL-B07，B04/B05/B06                 | 仅有证据的长期注册点用现有 useLiveTranslation；提示随当前语言，请求/上传/听写不重复。                         | use-live-translation + QueryClient/受控 Promise；pending/empty/error/retry/Undo、aria-live/焦点/reduced-motion，globalError/身份 guard。 | setTimeout 赌时序、吞异常、locale 重挂编辑器或重复请求；不批量换 hook。         |
| PL-B08，B02/B03                     | include/slug/英文锚点/围栏/链接/图结构及 Docs session 保持；同步 prose/FAQ/图显示。                           | markdown/AST/i18n-markdown/graph/docs-session；直达 hash、语言切换/返回、匿名/登录 SSR、JSON-LD。                                        | 改图算法/slug、复制整页，或把旧 hydration 探针算新浏览器通过。                  |
| PL-B09，B01/B03                     | 同一发起时 locale 管主题/正文/预览/footer；OTP/邀请/失败及其它邮件默认不变。                                  | otp-localization/invitation-localization/emails 捕获；中英并发、缺偏好、发送后切语言、HTML/plain text。                                  | 需真实投递、新邮件类型或非账号通知语言变更。                                    |
| PL-B10，B03/B06+模型/权限契约       | tab/草稿/保存/重载/协议原值/身份 guard 保持；仅接模型真实结果到现有字段/列表/错误 UI。                        | admin image/text-channels/draft/state；双语不丢草稿，失败/冲突/重载/旧身份迟到隔离。                                                     | UI 另算默认/能力/路由或为翻译加 API；交模型/入口组。                            |
| PL-B11，B05/B06/B10+模型/生成契约   | defaults/prefs ready、mask revision、rights/canSubmit、引用/输出/下载保持；复用 Status/Estimate/Output。      | composer-prefs/configured settings/count/controls/draft/mask/gallery/picker + studio.spec；缺价/不可用/迟到/0或部分或全输出/Use again。  | 静默换收费模型、切语言生成/上传、覆盖显式偏好、改生成状态；结算说明待账务确认。 |
| PL-B12，B01/B03/B07                 | 共享 HTML/小资源/真实模板映射/只读 tools 保持；语言更新只重绘，不重启 poll/通知。                             | mcp-app-context/sequence-card/mcp.spec；外部缺 locale/扩展/能力、未知状态、双语 live 切换/同名自定义。                                   | 扩 sandbox/权限/审批/工具或改协议/恢复；交入口组。                              |
| PL-B13，B01/B06                     | 可选 labels/英文回退/官方 lang/lazy 保持；clips/cues/字幕/URL/重试不动，不替换下载/导出。                     | stitch/react、video/scene-player stories、pages/sequence-flow；无 labels 对照，切语言保留 currentTime/开关/焦点，移动/键盘。             | 改引擎/encode/export/发布检查或臆造 locale prop；动态 lang 需浏览器补证。       |
| PL-B14，B04/05/07/08/09/10/11/12/13 | 主线程指纹/历史台账与实际处置对齐，原断言保持或说明等效；报告只辅助，P4/CI 不实施。                           | 每批 before/after SHA、全部消费者、原断言、新增/退出接缝、当前运行证据分别归档。                                                         | 有 pending/跨组未决不得称完成；纯移动/helper/报告不算结构或冲突收益。           |

可立即安排的首批是 PL-B01 的运行时契约核对，再做 PL-B02 两处标题写入的等效验证与单职责退出；不依赖模型商业决策。PL-B03 可以并行开展资源语义裁决，但未决项不作为批量改译依据。后续测试/浏览器运行需由主线程另行分配，本轮不执行。

## 6. 跨组前置、文档依赖与未决

- 模型组确认 default/ready/issue/estimate、参考计数和真实结算；生成组确认任务语言/子任务、模板/风格快照、状态/claim；入口组确认身份/组织、工具白名单/审批/恢复。这里只消费现有契约，不臆造新服务签名或 details 参数。CONTINUE-LLM-SOURCE 仍暂缓。
- 必读依赖：extension-policy、localization-plan、system-prompt-localization；architecture 的 model-configuration、generation-plan、scene-editor-cache、organization-characters/locations、prompt-staleness-dependency-graph、assistant、public-api-internals、social-publishing、asset-download；风格/卡片还依赖 style-localization、assistant-mcp-localization 记录。旧文档历史通过不验收当前 S。
- pending语义复核：全语言资源、法律/帮助长文、OG 正文、动态模板/错误、模型/Studio、MCP/播放器可见句子未逐项批准。retain-justified 不消除此未决项。
- 未确定统一时区；保留原日期政策。未在本轮实测 SSR 并发/hydration、浏览器动态 lang/媒体、桌面/移动可访问性、真实投递/供应商/账单/生产内存。无测量依据不改变懒加载/性能策略。
- 只有后续实现真正退出重复决策/写入、恢复上游差异或删除无效桥接，且有对应 before/after，才报告维护负担变化；现在没有全量冲突缩减或整改完成结论。

最终文件：本目录 `presentation-language.md` 与 `presentation-language.json`。JSON 含 10 个职责、14 个批次、43 个相关历史号、真实路径/符号/证据与未决；本轮只写这两个文件。
