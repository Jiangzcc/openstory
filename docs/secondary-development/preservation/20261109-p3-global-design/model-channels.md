# P3 全量职责设计：模型配置、文本/图片渠道与报价策略

日期：2026-11-09。源码固定为 `db3ea57b5f419f69c51369c28819de17515b21f5`；B=`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`；P2 历史源=`ce321c885f67e40fec1c8598bb759790d89359c9`。

本稿是可实施设计；没有修改应用源码、提交、测试、构建、供应商调用或远程数据库操作。`planned` 表示待实施；`retain-justified` 表示当前职责归属有静态保留依据，不表示全部路径或运行状态已验收。逐项结构与证据见 [model-channels.json](model-channels.json)。

## 1. 范围、历史与当前边界

- 范围依据长期二开职责，不以待合入文件或今日18个文本冲突选题。主线提供的 B→S 分母为1219路径、src 1017；P2的1128仍在、另增91、旧范围27个blob变化。指纹台账属于覆盖证据，不等于语义完成。
- 复用 `20261108-p2/candidates.jsonl`、`domains/behaviors-C.md`、`behaviors-BD.md`、`behaviors-F-C.md`，以及 `followup-20261109` 的更正、原断言追溯与暂缓记录。这里只重新核对本域实际拥有者、关键调用链和改造边界，不逐行批准全部171+路径；历史通过不转成本轮验收。
- 上游已有目录、native/fal/LLMTR适配、组织钱包、Stripe、API/MCP、Workflows、R2与claim。二开已实现管理员默认/内部模型、文本/图片渠道、增量目录、配置快照、兼容协议和USD规格价卡。
- 全面禁止BYOK、人民币销售价/版本化汇率、默认私有均未实施。个人人民币钱包和新增卡密商业改造已取消；本设计保持组织能力及现有美元账务。
- `e09e4a225` 只统一 `resolveLlmCallRoute` 的API分类；`2c7853d88` 只让单镜头复用准备bundle/quote。两项保留，不能据此称全域策略、报价或生命周期已收敛。

## 2. 推荐边界与最小改造

配置描述能力和事实；领域策略决定如何选择及接纳；适配器执行准确协议；原执行器继续控制流、恢复、结算及存储。保留现有server fn/API、ScopedDb、server/db和允许的platform组合根，不建立巨型route/context、通用供应商执行器或新配置平台。

| 目标                 | 处理                                 | 维护收益与约束                                              |
| -------------------- | ------------------------------------ | ----------------------------------------------------------- |
| 完整图片请求能力接纳 | MC-B01：两份同义判断归入models纯函数 | 从两份完整谓词变为一个来源，保留两个错误/展示包装；首批优先 |
| 配置文本供应商成本   | MC-B02：算式归入billing纯模块        | 协议与成本策略分别拥有；不改上游成本分派、预检或收费        |
| 图片钱包精度接纳     | MC-B03：谓词归入billing纯模块        | 模型价卡形状与USD钱包接纳分开；不重算另一套费用             |
| 其余10项职责         | retain-justified                     | 现有归属及必要桥接更小；不为新增helper而搬运上游执行器      |

三个新模块均为**拟建，当前不存在**，不是现成公开API。各批无代码前置依赖，建议串行交付，一次一个职责；不增加基础设施、数据库迁移、供应商与运行成本。若只增加导出/文件而没有删除重复规则或澄清真实所有权，该批停止。回退为撤销该批结构提交，继续原入口；不得改旧任务、旧凭证或账本来完成回退。

## 3. 全部职责与当前调用链

以下历史编号只认领本节说明的部分，可与其他设计组共享；JSON的 `historicalBehaviorIds` 不构成该编号所有行为已关闭。

### MC-01 默认推荐、用户选择与内部模型（retain-justified）

历史：C-01/C-05/C-13/FC-05。`getModelConfigurationFn → loadModelConfiguration → modelConfiguration.get → resolveModelConfiguration`；`getModelConfigurationOptions/createModelConfigurationSchema`用当前目录验证22个槽位。模式切换走`default*Model/applyGenerationMode`，创建经`parseConfiguredSequenceInput/createSequences`，Studio经`composer-prefs`。
默认四槽、turbo/quality八槽、newSequenceVideo及sceneSplit/vision/studioDraft/promptShortening/styleRecommendation/poster/shotPreview/talentVideo/watchClip分别保留用途；辅助调用仍用各自实际模型和via计费。显式作品/用户选择优先；推荐不等于上下架。模型已在models集中，场景偏好留所属领域，进一步统一会混淆语义。
证据：`src/models/model-configuration.ts:41,370,433`；`src/models/generation-mode.ts:137`；`src/sequences/server/configured-sequence-input.ts:5`；`src/studio/ui/composer-prefs.ts:96`。原生视频槽限制保留；系统指令全文与语言传播交语言组/生成与工作流设计。

### MC-02 管理保存、凭证与发布投影（retain-justified）

历史：C-08/C-09/BD-00。管理页 → `*.fn.ts → systemAdminMiddleware → adminScopedDb → *-channel-service.saveChannel/saveModel → server/db.commitConfiguration`。三个配置命名空间复用app_metadata，秘密单独AES-GCM加密；渠道更新以revision+旧JSON做CAS，D1 batch把新凭证与配置更新关联；读取经onPrimary。
默认配置的`modelConfiguration.save`是验证后upsert，**没有revision/CAS**；多registry读取也不是跨键原子发布。当前单管理员不构成新增全局发布epoch/多管理员协同的依据。文本UUID是metadata命名空间引用，图片引用用ULID，不为统一外形迁移旧引用。
证据：`src/models/server/db/model-configuration.ts:49`；`server/db/text-channels.ts:82,129`；`server/db/image-channels.ts:125`（均在src/models下）；`src/platform/server/db/scoped.ts:491,563`。存储各自保留，SQL只在server/db；地址变更需新Key，旧密文保留不保证供应商未撤销旧Key。

### MC-03 管理UI、只读发现、公开目录与会话（retain-justified）

历史：C-10/C-11/C-12/FC-07。`AdminModelsPage → useAdmin* → get/save/sync*Fn`；发现仅`GET <baseUrl>/models`，文本按所选协议筛endpoint metadata，图片按图片元数据筛选。候选只建立禁用草稿，不能自动保存、启用或推断价格/能力。
`toTextModelCatalog`与`projectImageModelCatalogEntry`提供公开投影；地址、上游ID、凭证引用不公开，图片supplierCost不公开。`AuthCacheGeneration`保护迟到保存/发现结果。保持既有URL页签、表单和翻译；管理权限继续复用platform middleware，不按组织owner/admin授予平台写权限。
证据：`src/platform/middleware.fn.ts:513`；`src/models/ui/use-admin-text-channels.ts:109`；`use-admin-image-channels.ts:129`；`src/models/text-channels.ts:312`；`src/models/image-channels.ts:396`。共享语言/认证组仅核对展示与会话接口，不复制权限或发现实现。

### MC-04 文本凭证优先级与付款来源（retain-justified）

历史：C-02/C-03/BD-01。`apiKeys.resolveLlmKey → resolveLlmKeyForModel`：内置模型先适用组织native，再mapped LLMTR/OpenRouter/fal，然后管理员compatible绑定，最后原平台回退；`custom:`直接要求绑定。绑定secret/能力/请求失败不改走其他渠道。
`resolveLlmSources`接实际会调用的去重模型；生成域`resolveStoryboardLlmSources`列analysis+sceneSplit。`requireCredits/reserveRunCredits → hasOwnCoverage`消费source，`assistantRequestModel/handleAssistantChat`按实际组织或平台来源预检。`via`表示路由，`source`表示付款凭证归属，不能互推。
证据：`src/models/server/llm-key-routing.ts:33,60`；`src/models/server/db/api-keys.ts:412`；`src/billing/server/preflight.ts:49,62`；`src/sequences/server/launchers.ts:96`；`src/assistant/server/assistant-chat.ts:342`。现有来源解析已集中，无须第二个总context。
**CONTINUE-LLM-SOURCE暂缓且未修复**：Continue遗漏实际文本sources，有效组织fal Key可使平台文本工作豁免不足余额。沿用`followup-20261109/deferred-decisions.json`，本轮不改Continue/preflight，不新增修复门禁；后续禁止BYOK须覆盖现存组织Key及全部入口，不能只隐藏配置页面。

### MC-05 文本协议、能力、输出预算与API分类（retain-justified）

历史：C-03/C-05/C-13。`callLLM/callLLMStream/durableLLMCallCf/durableStreamingLLMCallCf → resolveLlmCallRoute → 各自options → createAdapter/chat`。既有helper只判实际API形状；fal仍是OpenRouter形状+Key鉴权。
`configuredTextApi/ModelOptions/Capabilities`保持Chat的max_tokens/stream_options及Responses的max_output_tokens分流；结构化、工具、vision缺能力先拒绝。`createAdapter`用准确upstreamId、protocol、Base URL、有效User-Agent、workersSafeFetch及SDK重试0。User-Agent缺省/空值/省略更新语义保留。
`getLlmMaxOutputTokens`在解析实际key后读绑定限制；分场/设定65%与镜头列表完整上下文的原预算区别保留。普通与durable采样/reasoning默认不同，不抽成通用options工厂；MC-B02只迁成本算式。
证据：`src/models/server/llm-call-route.ts:9`；`configured-text.ts:34,40,71`；`create-adapter.ts:207`；`llm-client.ts:760`；`llm-call-helper.ts:229`；`llm-output-budget.ts:5`（均在src/models/server）。

### MC-06 配置文本供应商USD成本（planned → MC-B02）

历史：C-03/BD-00/BD-12。`configuredTextUsage → configuredTextCostUsd`；`llmCostFromUsage(usage, model, 实际key)`按compatible快照单价计费，不信网关同名cost。缺失/负数/非有限token保留缺成本，明确零价仍为零。原native/LLMTR/fal费用分派与missing-cost报告不变。
拟将`configuredTextCostUsd`及每百万常量原样迁到`src/billing/configured-text-cost.ts`；协议模块保留usage归一化并调用该纯函数，必要时保留薄再导出。`llm-client`只调整该依赖；不搬动流、恢复、助手中间件或deduction。
证据：`src/models/server/configured-text.ts:86,101`；`src/models/server/llm-client.ts:163`；`src/models/server/configured-text.test.ts:82`。新模块只算供应商USD估算，不代表对账或人民币售价；原estimateLLMCost粗预估保留。

### MC-07 native/fal恢复、Files与失败来源（retain-justified）

历史：C-04/C-05/C-14。`regionRetriesFor/callLLMStream/withCallRoute`依据实际key，而非是否保存绑定决定恢复；durable每次重试为目标模型解析凭证。实际compatible不跨渠道，休眠绑定不拦截优先采用的组织/native调用。
`generateImageWithProvider`先分configured，未绑定内置才走`withGoogleRegionFallback/resolveImageVia/generateImageInternal`。Google区域拒绝只在job前恢复，已stamp任务仍按原via轮询；`watchClipForOrganization/analyzeTalentClipForOrganization`直取原生google Key执行Files，文本绑定不能捕获。
`withLlmAuthFailureStream/llmCallStream`只给供应商构造、迭代与drained RUN_ERROR附实际安全组织来源，下载/发布异常不据此标坏Key。保留native参数和LLMTR精确映射，禁止猜邻近slug或把Key送OpenRouter；此处再统一将复制上游控制流。
证据：`src/models/server/llm-client.ts:1029,1088`；`llm-call-helper.ts:335`；`llm-auth-failure-stream.ts:5`；`src/stills/server/image-generation.ts:123`；`src/models/server/watch-clip.ts:37`；`src/cast/server/talent/analyze-talent-media.ts:97`。

### MC-08 图片身份、目录、绑定与停用（retain-justified）

历史：C-06/C-07/C-12。`saveChannelImageModelFn → assertModelIdentity/saveModel → createImageModelRoutingSnapshot`；`imageModelCatalogFromConfiguration → projectImageModelCatalogEntry → mergeImageModelCatalog → isSelectableImageModelId`。
内置ID保留名称/引用，generate/edit分别声明准确upstreamModel。active内置绑定优先原native/fal，停用恢复原内置路线；custom-image停用保留历史可读而拒绝执行。读取默认保留可识别的历史图片身份；新保存/执行另行校验。可读、可选、可执行不能合成一个enabled语义。
证据：`src/models/image-channels.ts:363,442,457`；`src/models/image-model-catalog.ts:104,120`；`src/models/server/image-channel-service.ts:169`。保持内置builder窄类型、GPT Image编辑endpoint、ImageVia/视频MediaVia边界，不新造全模型registry。

### MC-09 图片完整请求能力与中性规格（planned → MC-B01）

历史：C-06/C-07/BD-02/FC-06/FC-07。`quoteConfiguredImageRequest → requireReferenceCapability → resolveConfiguredImageParameters`；客户端`imageCostHint → configuredOperationAvailable → 同一参数解析器/价卡matcher`。完整operation/ref/mask接纳在两处有同义判断，适合首批提取。
参数标准/安全标量/verified状态归`image-parameter-contract/image-channel-parameters`，比例与分辨率映射归`configured-image-specification`，资源接纳归`image-resource-budget`。已有集中模块保留。`configuredImageCount`表达最终1/2/4张与native n/requestCount，不把目标数再乘一次。
拟新增`src/models/image-operation-capabilities.ts`，只接operation binding、operation、真实referenceCount及hasMask，返回纯失败原因；billing保留原三类ValidationError，cost hint保留原issue。`imageModelSupportsOperation`的未指定参考数目录探测及Studio的缺参考引导/mask URL验证各有不同用途，不强套完整请求校验。
证据：`src/billing/configured-image-billing.ts:30`；`src/billing/image-cost-hint.ts:34`；`src/models/configured-image-request.ts:21`；`src/studio/ui/configured-image-settings.ts:88,185`；`src/studio/ui/configured-image-count.ts:14`。

### MC-10 图片USD价卡与钱包接纳（planned → MC-B03）

历史：C-07/BD-00/BD-02/BD-12/FC-02。`quoteConfiguredImagePrice`按operation和实际参数选唯一最具体卡；缺价/同等具体度歧义拒绝。`unitPriceUsd`是现有USD销售价；`supplierCost.currency/unitPrice`是独立原币成本，不能相互替代。
`imageUnitPriceFitsWallet`目前位于models价卡模块，拟归`src/billing/configured-image-price-policy.ts`，复用money的USD↔microdollar函数表达同一可逆精度规则。价卡形状与matcher仍留models，启用保存与运行报价调用相同钱包策略；不复制schema。
先验证单张整数微美元，再按实际有效张数计费；零价不等于缺价，历史非法配置仍可读/纠正/停用。保持totalUsd、priceCardId、错误字符串和原舍入节点，不借提取增加CNY、加价、汇率或修改账本。
证据：`src/models/image-channel-pricing.ts:25,73,91`；`src/models/image-channels.ts:280`；`src/billing/configured-image-billing.ts:64`；`src/stills/server/configured-image-generation.ts:142`；`src/billing/money.ts:14`。

### MC-11 多入口报价消费、平台来源与结果（retain-justified）

历史：C-08/C-15/BD-01/BD-02/BD-06/FC-02/FC-06/FC-08。`prepareShotImageGeneration → prepareConfiguredImageBilling`已返回`workflowInput/modelConfiguration/imageBilling`供单镜头检查及预留复用，不重复该成果。
Studio、人物/地点/造型表、海报、预览、变体/网格/放大与序列编辑各在原领域准备真实规格/参考数，再消费共享quote。`quoteConfiguredPlanImages → planImageRequests/referenceSheetImageRequests → quoteConfiguredImageRequest`处理混合计划；不能用一个单镜头单价代替fanout/参考表明细。
配置图片固定`imageSource=platform`，生成结果`usedOwnKey=false`，按有效actualCount进入原扣费。`generatedAssets.markCompleted/markFailed`保存实际ImageVia；上游组织条件、状态及SQL没有因此新增。保留fal的D1 model_pricing/账单reconcile和native静态卡，不统一为管理员图片价卡。
证据：`src/billing/server/configured-image-billing.ts:23`；`src/billing/configured-image-plan-billing.ts:54,101`；`src/shots/server/shot-image-input.ts:286,379`；`src/studio/server/create-studio-asset.ts:368`；`src/models/server/db/generated-assets.ts:150`。
不同任务的claim、reservation粒度与失败收尾不同；这些薄适配有必要。生成与工作流设计复核生命周期，本域不新造统一预留器。C-15历史回读仅证明传入标记落库，不能证明实际供应商或真实账单。

### MC-12 兼容Images协议、错误与资源（retain-justified）

历史：C-06/C-07/C-15/BD-04。`generateConfiguredImage → configuredImageReferenceFiles/resolveImageChannelKey → generateCompatibleImages`；`validateCompatibleImageInput/Uploads → parseCompatibleImageParameters → buildRequest → images.generate/edit`。
保留官方SDK JSON/multipart、有序image/image[]和mask、0重试/关闭日志、deadline、manual redirect、responseStatus/requestId、安全错误和null可选字段归一。实际bytes经MIME/尺寸/资源预算及像素解码，HTTP200或文件头成功不代表可交付；partial只量有效结果。
模型声明与adapter执行分开，`compatible-image-*`现有分工已足够；通用workersSafeFetch不导入产品域。保持原native/fal执行器及组织素材权限，不建立文本/图片统一transport。
证据：`src/stills/server/compatible-image-client.ts:41,115,145`；`compatible-image-input.ts:24`；`compatible-image-response.ts:19`；`configured-image-generation.ts:27`。预算仅是接纳上限，Worker生产峰值/并发仍待验证。

### MC-13 发布快照与生成组接口（retain-justified）

历史：C-08/C-09/C-15/BD-03/BD-05/BD-06/BD-12。`loadModelRuntimeConfiguration/loadStoryboardModelConfiguration → packModelRuntimeConfiguration → triggerWorkflowRun → toWorkflowScopedDb/unpack → scopedDb.models`。两loader目录投影用途不同，不能机械去重；不声称跨registry原子发布。
现有runtime/workflow类型与text/image codec保留：文本冻结协议、有效User-Agent、准确upstreamId、能力/token/USD rates/credentialId；图片冻结operations/parameters/priceCards/credentialId，v2字典与256KiB admission、既有旧codec读取保留。不得由此兼容缺失组织身份或必填promptLocale。
`credentials.resolveLlmKey(model,routing?)`默认消费快照text路由，`resolveImageChannelKey(id)`只读不可变secret；payload无明文或密文。配置内容与codec归models，platform只保留现有可信接线；旧secret撤销仍失败，不取新Key替换。
证据：`src/models/model-runtime-configuration.ts:15`；`src/models/workflow-image-model-routing.ts:6`；`src/platform/server/db/scoped.ts:563`；`src/sequences/server/launchers.ts:82`；`src/platform/server/db/scoped-workflow.ts:277`；`src/platform/server/workflow/client.ts:174`。

## 4. 首批完整职责闭包、后续批次与跨组依赖

**第一批为MC-B01，仅收口“已给定operation/ref/mask的完整图片请求能否执行”。** 拟新建models纯函数与失败原因常量，替换`requireReferenceCapability`、`configuredOperationAvailable`两处同义谓词；新增一个边界测试入口，保留两处现有对外错误/展示包装。变更范围完整列于JSON，不扩展到未指定参考数的目录探测、Studio表单引导或低层二进制上传校验。

| 批次   | 完整边界与验收                                                                                                                             | 依赖/升级冲突与回退                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| MC-B01 | verified操作、safe integer参考数、上下界、mask条件；服务端quote与客户端hint一致接纳；原错误、undefined参考数待加载、自动尺寸及缺价处理不变 | 不依赖生成与工作流设计代码完成；需主线确认真实referenceCount/hasMask输入契约。冲突仅两个谓词消费者；可撤销本批回到原判断        |
| MC-B02 | 只迁配置文本USD算式；网关cost=999不覆盖配置价；无usage/坏token/零价与全部执行器成本相同                                                    | 无代码前置；保留configured-text必要再导出及llm-client分派。与生成与工作流设计共享实际model/key/source结果含义，不改step/payload |
| MC-B03 | 只迁图片钱包可执行性；0/最小微美元接受，sub-micro/非精确单价拒绝；partial与历史修正入口不变                                                | 无代码前置；不改money本体或账本。models matcher/启用schema接billing纯函数，若出现导入环扩大改动则停止                           |

真实跨组交接：

1. **生成与工作流设计**拥有请求→根/子任务传播、claim/attempt、reservation/结算、同step生成并存R2、旧检查点恢复与staleness。本域给现有配置/凭证/source/quote含义；其入口须提供真实参考数/hasMask/执行resolution，同一配置报价与执行；结果交actualCount/via/实际cost/source。这里约定数据，不复制生命周期算法。
2. **认证与公共入口组**确认systemAdmin、组织Key有效性、网页/API/MCP均走既有服务及公开模型投影。全面禁止BYOK以后另行设计；当前保留上游权限/API/MCP，不由本批重写鉴权或Key入口。
3. **展示与语言组**消费当前catalog、estimate/issue、错误键与USD值，保留loading/null/零价差异；模型名、wire参数、用户内容和币种不翻译成另一种业务值。Studio丰富引导仍归其原场景。
4. 三个首批结构动作均不触碰共享codec、payload、step名与生命周期，因此没有虚构等待所有组完成的代码依赖；**全链路验收**依赖前三组共同核对。若实施暴露必须修改共享契约，暂停该批交主线协调。

## 5. 中性配置与明确二开策略的反例、既有测试入口

以下是实施时应保留的反例/入口，均为本轮静态读取，**没有运行**。不得仅按标题/历史计数认定断言等效。

| 反例                                                                             | 所属边界                   | 既有入口（相对src）                                                                                                                                      |
| -------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 内置组织Key优先，但custom:不查询组织网关；绑定失败不得猜邻近模型                 | 配置路由事实≠凭证选择策略  | `models/server/llm-key-routing.test.ts`、`models/server/db/configured-text-routing.test.ts`                                                              |
| 同为fal凭证，文本走OpenRouter形状+Key鉴权；xAI Responses/Google原生选项不能混送  | API分类≠via/source         | `models/server/create-adapter.test.ts`、`models/server/llm-call-routing.test.ts`                                                                         |
| Responses无Chat专用stream/penalty字段；绑定vision不能代表原生Files               | 协议与能力边界             | `models/server/configured-text-protocol.test.ts`、`models/server/watch-clip.test.ts`、`cast/server/talent/analyze-talent-media.test.ts`                  |
| 休眠绑定不阻止实际native地区恢复；实际compatible不跨渠道                         | 解析事实≠恢复策略          | `models/server/llm-call-helper-region.test.ts`、`stills/server/image-generation-region.test.ts`                                                          |
| 有效组织fal Key不覆盖平台图片；Continue文本漏来源仍暂缓                          | Key存在≠本次付款覆盖       | `billing/server/preflight-routing.test.ts`及followup的`CONTINUE-LLM-SOURCE`记录                                                                          |
| 仅edit模型零参考、越界/小数参考数、无verified mask均拒绝；目录未知参考数仍可探测 | 完整请求规则≠目录/引导规则 | `billing/configured-image-billing.test.ts`、`billing/image-cost-hint.test.ts`、`studio/ui/configured-image-settings.test.ts`                             |
| 同具体度价卡不能选首项；supplierCost不代替售价；单张sub-micro不能靠总价取整通过  | 中性match≠钱包政策         | `models/image-channel-pricing.test.ts`、`billing/configured-image-billing.test.ts`                                                                       |
| 最终4张不等于每次n=4再启动4个任务；partial按actualCount；1080p不可借720p预占     | 规格/数量≠生命周期粒度     | `studio/ui/configured-image-count.test.ts`、`billing/configured-image-resolution-paths.test.ts`、`billing/configured-image-plan-billing-balance.test.ts` |
| 内置停用恢复原路线，custom停用只可读不可执行；HTTP200/正确头部仍可解码失败       | 身份/发布≠执行认证         | `models/image-channel-contract-compatibility.test.ts`、`stills/server/compatible-image-decoder.test.ts`                                                  |
| 轮换后旧任务沿用旧引用，迟到旧会话不能回填；provider回读不能证明供应商调用       | 发布/来源≠运行验收         | `models/server/db/configuration-session.test.ts`、`models/workflow-text-model-routing.test.ts`、`models/server/db/generated-assets.test.ts`              |

## 6. 停止条件、证据与未决

- MC-B01若需要重定义operation推导、目录探测、Studio引导、错误语义或引入secret/price/DB才能复用，停止提取；不得为统一强改不等价调用。两份完整同义谓词确实合为一份且原包装不变才记收益。
- MC-B02若复制算式、移动上游成本分派、改变token/零价/舍入或必须改workflow/账本，停止。MC-B03若改变历史读取、钱包币种/舍入、引入迁移或为解环扩大重构，停止。
- 任何批次碰到claim、attempt未知结果重提、父子快照、step名/检查点形状变化，交生成与工作流设计与主线；发现真实业务回归单立修复，不借P3结构变更处理暂缓或商业功能。
- 实施前固定新before SHA并复核完整导入者；保留B/P2原断言或记录有意差异，使用项目`bun run test`定向Vitest及所需正常typecheck/lint/format。这里只列计划，不声称已执行。各批应在同PR更新相关架构文档。
- 验证账分开记录源码证据、实际本轮验证、未验证；历史P2/此前P3的Mock/测试D1/浏览器记录只作来源。真实供应商、账单、Cloudflare网络、生产内存、远程DB与部署均未验收。
- 本稿13项职责覆盖全域目标，并没有关闭全范围逐块语义复核；10项retain判断不代表其所有调用路径已批准。主线仍需把路径/差异块挂到职责及相应组，收齐原断言/共享契约/实际验证后再评估P3完成。
- `CONTINUE-LLM-SOURCE`、全面禁止BYOK、人民币价/汇率与组织钱包衔接、默认私有保持明确未决/未实施；不作为这三项行为保持批次的暗含依赖或“顺便修复”。
