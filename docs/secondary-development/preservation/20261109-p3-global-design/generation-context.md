# P3 全量职责设计：生成上下文与工作流生命周期

日期：2026-11-09。**状态：planned；不是P3完成报告，也不是逐路径语义批准。**
固定源S：db3ea57b5f419f69c51369c28819de17515b21f5；纯上游B：2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0；P2历史源：ce321c885f67e40fec1c8598bb759790d89359c9。
完整owners/call flow、批次依赖/验收/停止与回退见 [generation-context.json](generation-context.json)。

## 总体决策与分母

- 主线程全量分母为1,219路径：src M 606、src A 411；P2 1,128路径仍全在，新增91。历史79行为号含仅历史FR08属于全局分母，本组不冒认全部；明确覆盖BD-00～12、AEG-02、C-08/C-13及真实跨域关联。
- P2 BD-*、AEG-02、C-08/C-13种子共352条；沿真实入口补充API/MCP/助手及新增路径。历史号可以多职责共享。不是仅修18冲突或仅推广四试点。
- 本轮读取根AGENTS.md、.codex/project-rules.md、architecture、P2 behaviors/followup及S实际代码/diff。registry仅指纹/历史关联，p3Disposition仍pending；旧reviewed/tested不代表本轮语义批准。
- 保留上游执行骨架、组织/权限/钱包/API/MCP；按领域收敛二开准备/引用与费用投影/固定文字。不复制核心到扩展目录，不造万能context或插件框架。
- 按整合裁决/MC-13保留scoped.ts:563 loadModelRuntimeConfiguration现有composition root；保留assistantRequestModel的chatModelFor/vision/收费编排，不新增通用resolver。本组没有相反源码证据。
- AnalyzeScript scene-split/location-matching保留：2→2调用、8→8显式赋值、核心接入移除0；为retain-justified，不能虚报8→0。
- CONTINUE-LLM-SOURCE保持deferred；未来禁止BYOK、人民币售价/账本不在本轮实施。

## 不合并不同生命周期边界

| 边界                     | 所有者/用途                                    |
| ------------------------ | ---------------------------------------------- |
| storyboard slot          | sequences.claimWorkflowSlot，序列级互斥        |
| artifact selection claim | 各DB guarded promote/clear；保持媒介差异       |
| paid image attempt       | stills恢复已提交/已存/未知同步POST，非钱包hold |
| reservation              | billing组织资金，shared/private owner不同      |
| provider capacity/lease  | 原BytePlusGovernor/voice/provider；模型域决策  |

## 全部入口矩阵

| 入口族                           | 实际服务/调度边                                                            | 职责           |
| -------------------------------- | -------------------------------------------------------------------------- | -------------- |
| 网页/API/MCP/助手                | middleware→runOneShotCreate/createSequences或MCP_TOOLS→同域服务            | GC-01/02/06    |
| 创建/完整重试/重生成             | createSequences、executeSmartRetry、triggerStoryboard                      | GC-06/07/11    |
| Continue/Update all/plan execute | prepareContinue、prepareUpdateStale、planGeneration/executeGeneration      | GC-07/12       |
| fresh handoff                    | freeze-generation-plan→freezeFreshGenerationPlan→spawn-continue            | GC-03/07       |
| 增加模型/局部重试                | addModelToSequence、executeSmartRetry各分支                                | GC-07/08/13    |
| single/variants/upscale          | prepareShotImageGeneration、generateShotImage、selectShotImageVariant      | GC-08/10/11/12 |
| prompt编辑/重写/预览             | shot edit/prompt服务、ShotSpecRewrite/RegenerateShots、triggerShotPreview  | GC-04/08/12    |
| cast/location/looks/element      | cast-generation、sheet trigger、bible/matching/recast/replace/vision       | GC-03/09/12    |
| 上传与权利检查                   | storage upload/multipart、classifyUpload/upload-check、attach/copy element | GC-01/06/09    |
| poster/portrait/framing grid     | configured-poster、runSheetPortraitStep、ShotImages fan-out                | GC-03/08/10    |
| motion/draft/final/lipsync       | generateShotMotion、renderAtQuality、MotionBatch/Motion/Lipsync            | GC-03/13       |
| voice/dialogue/music             | enqueue voice、dialogue edit/take/upload、generateMusic/rewriteMusicPrompt | GC-11/12/13    |
| Studio/生成素材                  | createStudioAssets/createGeneratedAsset→/studio、/asset                    | GC-10/14       |
| 模型辅助/导出                    | Enhance/shorten/duration/styles/watchClip；startExport                     | GC-04/13       |

## 职责与单职责批次

### GC-01 可信请求身份与任务语言入口

- 状态：**retain-justified**；historicalBehaviorIds：AEG-02 / AEG-03 / AEG-04 / BD-07 / C-13。
- 已实现：网页默认zh-CN、助手原始Request语言、外部API/MCP固定en；内部promptLocale必填。 上游原行为：B已有session/OAuth/API Key、组织角色/权限及共享MCP工具；没有任务语言选择。
- 真实owners：src/platform/middleware.fn.ts:293 authWithOrganizationRequestMiddleware / :436 authWithOrganizationMiddleware；src/platform/i18n/prompt-locale.ts:16 promptLocaleFromRequest / :6 EXTERNAL_PROMPT_LOCALE。调用链：真实principal/organization/scopedDb及权限校验→middleware显式promptLocale→各domain actor/context→共享服务。 助手Request→toolContext→MCP_TOOLS；外部API/MCP显式en；storage upload/multipart显式读取Request语言。
- 目标：语言解析归platform/i18n；认证/租户归现有middleware；领域上下文只显式承载必需字段。 保留：认证、组织钱包、OAuth scopes、API/MCP服务与错误语义；保留assistantRequestModel的chatModelFor/vision/收费组合，不造通用resolver。 必要桥接：入口的语言赋值区分网页与外部默认值，不能删除或变为公开API参数。 locale显式向下传，不放全局可变状态或ScopedDb。
- 批次：G01-verify〔middleware、API/MCP、助手、storage及domain actor〕保留薄接入；仅为实际断链安排后续修复，不增加上下文包装器。 依赖：无
- 验收：内部zh-CN/en和外部固定en到最终服务参数保持；Cookie缺省/非法值行为保持。 停止：只剩显式字段透传就保留；不复制认证/API/MCP、不通用化助手resolver。
- 未决：本轮静态设计；API/MCP、助手中文会话及全部入口组合未逐一运行。 证据：src/platform/middleware.fn.ts:367-380,495-501；src/platform/server/mcp/server.ts:160-184；全部证据、升级冲突与回退见JSON。

### GC-02 模型配置快照捕获、封装与消费

- 状态：**retain-justified**；historicalBehaviorIds：AEG-02 / C-08 / BD-05。
- 已实现：默认/helper槽及文本/图片路由、能力/限额/费率/credentialId随任务冻结；消费不装载当前配置。 上游原行为：B已有payload、WorkflowScopedDb与窄读取hatches；无管理员运行快照。
- 真实owners：src/platform/server/db/scoped.ts:563 loadModelRuntimeConfiguration；src/sequences/server/launchers.ts:82 loadStoryboardModelConfiguration；src/models/model-runtime-configuration.ts:24 packModelRuntimeConfiguration / :41 unpackModelRuntimeConfiguration。调用链：可信请求捕获ModelRuntimeConfiguration→options.modelConfiguration→triggerWorkflowRun覆盖body配置并封装→binding.create。 base验证user/org/promptLocale→toWorkflowScopedDb解码为scopedDb.models；缺旧配置只用代码默认/空路由，非当前管理员设置。
- 目标：模型组拥有快照类型/codec/策略；platform保留现有composition root；本组负责可信捕获点和传播契约。 保留：WorkflowScopedDb writes、credentials/claims/liveRead和限定planning hatches；SQL留server/db。按MC-13保留scoped.ts:563的组装，不为搬文件迁出。 必要桥接：root trigger一次封装、base一次消费不可移除，否则各工作流重复装载。 仅传credentialId；密钥在花费step解析，优先级/轮换交模型组。
- 批次：G02-verify〔root dispatch、codec、WorkflowScopedDb与调用者〕保留composition root与薄桥接；核对准备所用对象也作为可信option进入任务。 依赖：MODEL-SNAPSHOT-CONTRACT
- 验收：body不能覆盖trusted配置；undefined/显式空路由各保留wire含义。 停止：模型策略未外溢就保留，不引入万能context/插件框架/live配置hatch。
- 未决：loader跨多条D1读取；不声明全局原子配置版本，也不增版本表。 256KiB是图片路由分量，非整个payload/checkpoint/生产heap证明。 旧codec可读不等于缺promptLocale历史任务可运行。 证据：src/platform/server/workflow/client.ts:168-179；src/platform/server/workflow/base-workflow.ts:195-213；全部证据、升级冲突与回退见JSON。

### GC-03 父子任务、重试与恢复调度

- 状态：**retain-justified**；historicalBehaviorIds：AEG-02 / BD-05 / BD-06 / BD-12 / C-08。
- 已实现：父promptLocale与scopedDb.models进孩子；共享reservationId显式传，ownsReservation不机械继承。 上游原行为：B已有每父实例子ID、AlreadyExists复用、_parent通知、超时状态恢复、engine abort透传和终态通知。
- 真实owners：src/platform/server/workflow/await-child.ts:157 spawnAndAwaitChild / :296 notifyParent / :327 notifyParentOfFailure；src/sequences/server/workflows/analyze-script-workflow.ts:208 scene-split / :260 location-matching。调用链：领域父任务构造childPayload(locale/user/org/reservation/业务snapshot)，独立提供modelConfiguration:scopedDb.models。 spawnAndAwaitChild在原spawn step打包、注入_parent并按父实例生成childId→原wait/status恢复；根dedup复用不改旧payload。
- 目标：platform只持dispatch/等待；领域父任务持业务输入、资金owner与失败传播。 保留：原step名、child ID、timeout、先后次序和通知/reconcile；scene-split失败不创建location-matching。 必要桥接：AnalyzeScript两处保留2→2调用、8→8显式赋值、移除核心接入0。 reservationId与ownsReservation独立传递；不能复制整父context到孩子。
- 批次：G03-verify〔所有spawnAndAwaitChild及工作流内trigger，包括replace/recast、voice、lip-sync、preview/framing grid〕按真实父子边核对传播，保留两处已评估薄调用。 依赖：G02-verify
- 验收：并发父任务的身份/语言/配置互不污染；最终binding.create消费父快照。 停止：只剩字段传播即停止；不得虚报8→0或搬AnalyzeScript骨架。
- 未决：旧P3契约回归是历史Mock/codec证据，非本轮或Cloudflare引擎重启验收。 证据：src/platform/server/workflow/await-child.ts:133-145,181-213；src/sequences/server/workflows/analyze-script-workflow.ts:208-281；全部证据、升级冲突与回退见JSON。

### GC-04 系统指令和领域自然语言资源

- 状态：**planned**；historicalBehaviorIds：BD-07 / BD-08 / C-13 / AEG-03。
- 已实现：3 text/16 chat注册模板已有独立中文资源；辅助指令、风格兜底和派生包装显式按任务语言选择，用户内容/协议保持。 上游原行为：B的英文模板、role、变量/Schema、duration解析标记和供应商token已存在；二开新增中文及选择参数。
- 真实owners：src/platform/server/ai/prompts-index.ts:63 getPrompt / :91 getChatPrompt；prompts/zh-CN/*；src/models/server/auxiliary-prompts.ts；src/models/enhance-duration.ts:167 buildDurationPromptParagraph / :180 buildDurationCorrectionPrompt。调用链：durableLLMCallCf/durableStreamingLLMCallCf与直接scene-split按context.promptLocale选模板。 模型辅助、vision/Studio/assistant、still/motion/poster各领域builder组装固定说明；旧spec派生不做翻译。
- 目标：注册表归platform/ai；领域二开文字归现有独立资源/纯builder；本地化组持配对表和人工语义复核。 保留：英文原文、role顺序、变量、Scene/TOTAL、引用、Seedance/Kling/MiniMax语法、用户/历史作品文本。 必要桥接：locale参数是必要执行输入，不隐藏；platform不value-import业务域。 复用既有auxiliary/scene-split/poster/motion/Studio/vision资源，不造全域文案框架。
- 批次：G04-resources〔poster/enhance/script-enhancer、still/reference、motion/dialogue/lipsync、vision及Studio固定文字〕一次一个builder，将尚混在上游组装中的二开固定文字收至本领域资源；原控制流/组装顺序保留。 依赖：LOCALIZATION-OWNER-MAP；G04-semantics〔所有相关zh-CN指令、派生描述、风格兜底〕与本地化组逐段核对全文约束；AST维护报告只发现变化，不自动批准含义。 依赖：G04-resources
- 验收：同输入英文最终消息逐字保持；中文role/变量/数值/引用/解析token保持，用户内容不变。 内容约束、拒绝/软化、自由描述和格式逐项对照，未获语义/质量证据保持待验收。 停止：仅移动/复制整个上游builder或徒增包装则停止。
- 未决：中文全文语义及真实生成质量未由旧catalog/前缀测试证明；本轮不调用供应商。 助手chatModelFor/vision/收费编排保持，不在文案抽取中通用化assistantRequestModel。 证据：src/platform/server/ai/prompts-index.ts:63-116；src/models/server/auxiliary-prompts.ts:1-40；全部证据、升级冲突与回退见JSON。

### GC-05 风格配方和保存内容所有权

- 状态：**retain-justified**；historicalBehaviorIds：BD-08 / BD-07 / C-13。
- 已实现：平台模板精确原文匹配；创建/明确选择时解析，保存实际配方；自动风格clone取来源sequence快照。 上游原行为：B已有模板、style version/pointer、自动风格占位/保存与历史；组织访问保留。
- 真实owners：src/sequences/server/create-sequences.ts:83 resolveStyleSource；src/look/localization/style-content.ts:24 localizeTemplateStyleConfig；src/sequences/server/db/sequences.ts:630 create / :808 update resolvedStyleConfig。调用链：服务读取可访问style→仅平台已知字段按locale解析→resolvedStyleConfig交原version/pointer batch。 auto-style从冻结script/locale生成→条件落库并snapshot；子任务/重试/staleness使用保存的配方，不重读目录译文。
- 目标：look/localization持模板/兜底；原sequence服务持库/自动/clone；DB只收配方不收locale。 保留：库模板不可被run覆盖；旧spec/用户文字不重译；版本/pointer/claim demotion和hash投影保持。 必要桥接：resolveStyleSource一次解析+DB可信配方是stamp/verify一致所需，不能只翻payload。 未知/编辑字段原样；中文slug兜底不影响ULID。
- 批次：G05-verify〔resolveStyleSource、create/update、deriveAutoStyle、style-content与look测试〕保留已分离资源与薄服务/DB接入，核对选择/克隆/运行中换风格。 依赖：G04-semantics
- 验收：目录/译文/界面语言改变不重算旧配方；显式换配方按原hash变化。 停止：只剩一次解析/可信传参则保留，不复制style create/clone核心。
- 未决：精确匹配覆盖不是未知配方翻译保证；中文配方语言质量仍待人工复核。 证据：src/sequences/server/create-sequences.ts:83-120；src/look/localization/style-content.ts:18-47；全部证据、升级冲突与回退见JSON。

### GC-06 新建与完整重试的请求准备快照

- 状态：**planned**；historicalBehaviorIds：BD-01 / BD-02 / BD-05 / BD-06 / AEG-02 / C-08。
- 已实现：创建/full retry已用配置默认值、能力、实际LLM来源和图片报价；保留原预占/storyboard。 上游原行为：B的createSequences共享网页/API/MCP创建、权限/上传、fan-out、style/sequence写入、资金/失败清理；smart retry复用原生命周期。
- 真实owners：src/sequences/sequences.fn.ts:193 createSequenceFn.validator；src/sequences/server/configured-sequence-input.ts:5 parseConfiguredSequenceInput；src/platform/server/api-v1/create.ts:379 parse / :418 createSequences；src/platform/server/mcp/tools/structure-edits.ts:211 createSequences。调用链：网页validator用loadModelConfiguration注入默认值，createSequences再装载完整运行配置；API先持configuration解析，却未把它交createSequences。 create核心用自身配置报价/来源/reserve/payload/trigger；attach/copy元素及upload-check另有根任务触发边。
- 目标：序列域可信准备持defaults/校验/捕获结果；模型组提供快照；既有platform loader composition root原位保留；launcher持mutex/dispatch。 保留：原Schema/错误、上传权利检查顺序、显式选择优先级、多个analysis fan-out、DB/资金生命周期。 必要桥接：只能服务器内部传可信配置，不向公开Schema加modelConfiguration或接客户端配置。 辅助根任务归属需逐边确认，不冒充全部都是child。
- 批次：G06-capture〔configured-sequence-input、网页/API/MCP入口、createSequences/full retry〕在可信准备阶段捕获完整配置并复用到默认值/能力/报价/来源/dispatch；拟新增内部传参，不迁移现有loader，不造通用resolver。 依赖：MODEL-SNAPSHOT-CONTRACT/G01-verify；G06-auxiliary〔attachDraftElementUploads/copySequenceElements及相关element-vision/upload-check根触发〕同次创作操作复用可信快照，独立上传自己捕获；保留原权利/创建/付费顺序。 依赖：G06-capture/G03-verify
- 验收：捕获后管理员修改配置的可控对照中，该请求后续模型/路由/费率保持，后续请求可见新值。 创建成功后才启动的sheet与原失败清理保持；locale始终显式。 停止：不能保持验证/权限/权利检查时机则停止该入口；没有重复决策收益就保留。
- 未决：多次装载是静态事实，实际管理员并发修改的用户可见影响未复现；不声明原子多表revision。 Start validator/auth顺序与辅助根任务边界须实施时定向核对；不能据此预先改外部行为。 证据：src/sequences/sequences.fn.ts:193-205；src/platform/server/api-v1/create.ts:379-421；全部证据、升级冲突与回退见JSON。

### GC-07 计划报价与执行衔接

- 状态：**planned**；historicalBehaviorIds：BD-01 / BD-02 / BD-05 / BD-06 / C-08。
- 已实现：Continue/Update all/fresh/retry/add-model冻结计划；configured图片用实际引用/模型/分辨率报价，估算非账单。 上游原行为：B已有generation plan、stopAt、Continue开关、Update all、fresh handoff、plan token/digest/PLAN_CHANGED及floor/partial语义。
- 真实owners：src/sequences/server/continue-plan.ts:98 continueImageEstimate / :181 prepareContinueEstimate / :226 prepareContinue；src/sequences/server/freeze-fresh-generation-plan.ts:21 freezeFreshGenerationPlan / :77 remainingPlanCost。调用链：Continue按未保存picker模型/分辨率override规划；fresh仅在freeze-generation-plan读取刚创建rows，后续只消费冻结plan。 continueImageEstimate/remainingPlanCost都单独计图片后把still/sheet/ref四类counts归零再叠加；Update all取floor；execute重新prepare并比较digest。
- 目标：图片费用分区归既有billing/configured-image-plan-billing；生成单位/排程/stopAt/digest仍归sequence/shots。 保留：floor/partial/unknown区别、未保存选择、PLAN_CHANGED、fresh顺序、Continue/Update并行排程。 必要桥接：billing只接plan/routing/counts，不控制Workflow。 执行继续从快照重建/校验参数，不能把浏览器预览或请求quote当持久化结算凭证。
- 批次：G07-partition〔configured-image-plan-billing、continueImageEstimate、remainingPlanCost〕仅收敛二开“图片subtotal+排除已报价counts”纯职责，先替换这两处重复，不合并生成控制流。 依赖：G09-reference-projection/MODEL-IMAGE-QUOTE-CONTRACT；G07-callers〔Update all preview/run、plan/execute、smart-retry、sequence-models各分支〕按完整入口矩阵核对同义投影复用；原claim/reserve/dispatch留原位。 依赖：G07-partition/MODEL-SNAPSHOT-CONTRACT（只复核现有快照，不等待G06代码实施）
- 验收：mixed built-in/configured、多模型、reference-only、零图、未知价、待保存picker、draft480及720/1080保持。 预览后状态改变仍按原digest拒绝；部分已启动任务可查询且hold不被收回。 停止：共享投影若改变floor/排程、引入中途读或修复暂缓项即停止。
- 未决：CONTINUE-LLM-SOURCE缺实际llmSources；有效组织fal key、平台文本收费/余额不足且无其它强制平台门禁等条件下可误豁免，按用户决定暂缓。 digest绑定request/work material/estimate，不宣称完整路由身份/费率版本绑定。 证据：src/sequences/server/continue-plan.ts:98-178；src/sequences/server/freeze-fresh-generation-plan.ts:88-129；全部证据、升级冲突与回退见JSON。

### GC-08 单镜头、变体、放大与预览准备

- 状态：**retain-justified**；historicalBehaviorIds：BD-01 / BD-02 / BD-05 / BD-06 / AEG-02。
- 已实现：单张已返回workflowInput/modelConfiguration/imageBilling复用请求报价；variants/upscale各自捕获并传入配置，执行独立校验。 上游原行为：B已有prompt/model优先级、shot精确引用、hash查重、并发claim、sourceVariantId、预占/失败清理和reference-only预览。
- 真实owners：src/shots/server/shot-image-input.ts:102 prepareShotImageGeneration / :382 prepareShotImageWorkflowInput；src/stills/server/shot-image-generation.ts:62 generateShotImage / :217 generateShotImageVariants / :374 selectShotImageVariant。调用链：准备引用/模型/hash/配置报价→requireCredits→返回结果；原位查重/createPendingClaim→reserve→releaseReservationOnThrow(trigger)→stamp run。 variants/upscale保持独立任务/来源帧/幂等键；请求preview捕获全配置、run内preview继承父配置；冻结计划builder与请求准备含义不同。
- 目标：shots/stills原准备与编排；billing与模型路由各自持职责，不添通用包装。 保留：点击写prompt版本、引用排序/frame anchor、grid选择/来源模型、claim竞争及失败清理。 必要桥接：既有prepareShotImageWorkflowInput facade保持调用者；quote仅是request-local结果。 configured分支调共享step，unbound native/fal原step和路径保持。
- 批次：G08-verify〔single/variants/upscale、batch still、preview/redraw及新增lifecycle测试〕保留已消除的单张重复报价，逐入口验证真实规格/引用/快照，不机械推广单张接口。 依赖：G02-verify/G10-attempt-verify
- 验收：单张请求报价一次；claim胜负、余额不足、reserve/trigger失败释放及unbound无新增hold保持。 停止：无第二份同义二开决策即保留；不合并prepare与编排为万能context。
- 未决：旧P3局部证据未覆盖全部variants/upscale/入口组合；本轮未重跑。 证据：src/shots/server/shot-image-input.ts:286-314,348-385；src/stills/server/shot-image-generation.ts:106-213,266-354,443-456,528-553；全部证据、升级冲突与回退见JSON。

### GC-09 cast/location/looks输入投影与组织所有权

- 状态：**planned**；historicalBehaviorIds：BD-02 / BD-06 / BD-09 / BD-10 / C-08。
- 已实现：角色/looks/地点归组织，sequence只持链接；face/referencePhoto/地点照片贯通报价与执行；缺referencePhotoUrl旧任务拒绝。 上游原行为：B已有组织共享、analysisMayNotRewrite、条件sheet claim、rendering/照片guard和portrait。
- 真实owners：src/cast/server/sheets/character-sheet-trigger.ts:65 buildCharacterSheetDraft / :135 buildRegenerateCharacterSheetPayload；location-sheet-trigger.ts；src/cast/server/cast-generation.ts:62 regenerateCharacterSheet / :265 regenerateLocationSheet / :382 recastLocation。调用链：可信入口读look/bible/face或地点照片→snapshot/hash→实际引用报价→原claim/reserve/trigger；执行按同snapshot组装refs。 plan另投影default photo/non-default face/location/element；UI readiness只作显示，不授权缺face任务。
- 目标：cast纯投影持解析后sheet DTO→model/aspect/ref-count；billing消费报价；UI保留不同readiness；模型组持协议/绑定。 保留：default look id/effective styling/rendering、attached/shared防重写、null sequence组织存储/channel、软删/声音持有。 必要桥接：真正任务actor/payload才加locale；SheetPayload/draft/hash DTO不混语言。 投影可共享，条件claimSheet/claimReference/promote和ownership不可挪给统一生成器。
- 批次：G09-reference-projection〔cast sheet snapshot/trigger、两direct入口、billing referenceSheetImageRequests〕新增或复用cast纯投影模块（拟建），只统一实际model/aspect/ref-count，消除plan/direct重复规则。 依赖：MODEL-IMAGE-QUOTE-CONTRACT；G09-ownership-verify〔cast/location独立页、sequence、analysis、recast/replace/element/vision/upload-check/portrait〕保留原组织ownership及薄桥接，核对各入口。 依赖：G09-reference-projection/G03-verify
- 验收：default无/有照片、non-default有/缺face、location多照片、element1:1、mixed model报价/执行引用一致。 attached/shared不被analysis覆盖；无sequence存组织并报自身channel；移除link不释放声音。 停止：仅共享确定投影；需改hash/schema/guard/ownership则停止。
- 未决：UI接readiness、服务端接snapshot，当前接口不能宣称等价。 BD-10是已恢复上游guard；不能据语言历史策略推导照片兼容，也非P3新增。 证据：src/cast/server/sheets/character-sheet-trigger.ts:65-125,135-143；src/cast/server/cast-generation.ts:97-159,287-349；全部证据、升级冲突与回退见JSON。

### GC-10 兼容图片attempt、防重复付费与同step存储

- 状态：**retain-justified**；historicalBehaviorIds：BD-03 / BD-04 / BD-06 / C-08。
- 已实现：组织限定attempt；生成与全部输出存储同step；后续只重试小metadata；未知已提交结果禁止自动付费重发。 上游原行为：B已有生成step内R2存储、url/path过checkpoint；native/fal job/via/polling各自控制流；无同步compatible付费attempt账。
- 真实owners：src/stills/server/workflows/configured-image-step.ts:49 attemptIdentity / :139 trackedGeneration / :167 runConfiguredImageStep；src/stills/server/db/image-generation-attempts.ts:106 createImageGenerationAttemptsMethods；src/stills/server/configured-image-attempt.ts。调用链：run+step+params+captured route→attempt→recover stored→credit guard→atomic claimAttempt→generate→store全部输出；generate step只返回小metadata。 record step complete；submitted/unknown无结果拒绝自动重发；engine abort透传；普通optional poster/portrait失败保持各自语义。
- 目标：stills持attempt/存储回调；业务域持R2路径/输出数量/落地；模型组持协议、预算、错误/via/poll。 保留：native/fal原路径、step名、stream storage、版本/provenance/扣费点；不泛化同步attempt到所有媒体。 必要桥接：各image/sheet/variant/upscale/poster/portrait/Studio configured分支是必要薄接入。 optional media各自资金/失败边界不合并catch，engine abort先透传。
- 批次：G10-attempt-verify〔全部shared configured step调用者、attempt DB与原storage helper〕保留共享执行；核对完整存储/收费/恢复，参数重复解析优化先由模型组固定契约。 依赖：MODEL-IMAGE-QUOTE-CONTRACT
- 验收：并发/replay只一次paid POST；metadata失败仅重试record；未知/部分存储不重提交。 停止：无重复决策即保留；不拆成生成bytes/另一step上传，不自动重发未知POST。
- 未决：供应商已付费但无可恢复输出的风险未由Mock消除。 step与adapter各做纯报价是否值得合并，需模型契约；不得删除执行校验。 无本轮真实引擎恢复、账单或heap证据。 证据：src/stills/server/workflows/configured-image-step.ts:49-66,83-188；src/stills/server/db/image-generation-attempts.ts:54-103,106-143；全部证据、升级冲突与回退见JSON。

### GC-11 组织钱包预占、扣费与失败释放

- 状态：**retain-justified**；historicalBehaviorIds：BD-00 / BD-01 / BD-02 / BD-03 / BD-06 / AEG-02。
- 已实现：沿用USD microdollar组织钱包；来源/报价接原reservation；零价免空hold，负值/缺价不当零。 上游原行为：B已有原子reserve/capture/zero、幂等扣费、本人envelope+未预占余额、共享/私有资金owner；Stripe/Gift Code保留。
- 真实owners：src/billing/server/preflight.ts:49 resolveLlmSources / :108 requireCredits / :136 reserveRunCredits / :169 releaseReservationOnThrow；src/billing/server/db/billing.ts createBillingMethods；src/billing/server/workflow-deduction.ts:92 deductWorkflowCredits。调用链：preflight只检查→reserve建立envelope→花费后原幂等capture→剩余由资金owner zero。 共享孩子只传reservationId；私有叶ownsReservation才由base终态释放；Studio每item独立hold，部分失败只清未启动项。
- 目标：billing持金额/事务/门禁；业务编排持资金owner；模型组提供来源事实，本组不重写凭证策略。 保留：money、billing DB、workflow-deduction与B blob相同；组织共享钱包/兑换/支付不迁移。 必要桥接：imageSource/llmSources是来源事实，不能以管理员绑定存在代替实际来源。 ownsReservation不等于claim；共享envelope、Studio item、optional portrait不统一。
- 批次：G11-verify〔所有生成入口的reserve/capture/cleanup〕按资金owner核对幂等键/清理，保留原钱包实现。 依赖：G07-callers/G14-image-prepare
- 验收：余额竞争、重复/短capture、预占/dispatch失败、dedup reuse、partial fan-out与abort恢复保持。 停止：需改组织/钱包/支付/权限或合并资金owner即停止。
- 未决：CONTINUE-LLM-SOURCE未修；未来禁止BYOK单独处理。 供应商账单/真实成本/远程D1不在本轮验收。 证据：src/billing/server/preflight.ts:49-93,108-185；src/billing/server/workflow-deduction.ts:92-139；全部证据、升级冲突与回退见JSON。

### GC-12 选择claim、staleness与不可变版本

- 状态：**retain-justified**；historicalBehaviorIds：BD-05 / BD-06 / BD-09 / BD-10 / BD-11 / BD-12 / AEG-02。
- 已实现：语言不进hash；生成/验证用同内容投影；旧run不覆盖新选择；保存响应取本次版本；中文地点区分保持。 上游原行为：B已有claim/clear/promote、diverged历史、shot级引用/hash、限定planning hatches与版本链；二开保存响应修正/Unicode匹配另保留。
- 真实owners：src/stills/server/db/frame-variants.ts createPendingClaim/selectIfPendingPromoteIs；src/cast/server/db/character-looks.ts claimSheet；locations.ts claimReference；src/shots/server/workflows/shot-spec-rewrite-workflow.ts finalVersionId；src/shots/server/workflows/update-stale-shots-workflow.ts。调用链：触发固定DTO/hash/版本ID，点击写用户编辑；完成持claim guarded update，失败仅清自己claim，失权只留历史。 后续render读child返回finalVersionId（含retired碰撞结果），不追selection pointer；保存响应读已保存版本，staleness沿同投影。
- 目标：各DB持claim/版本/pointer事务；domain持hash/DTO；platform只约束读面。 保留：原pipeline无claim的固定例外、music prompt例外、staleness/generationPlanning各唯一允许入口保留，不顺带扩充。 必要桥接：locale只控制系统文字；实际保存配方/内容影响既有hash；纯content DTO不夹locale。 mutex/selection claim/paid attempt/wallet reservation互相独立，不能统一。
- 批次：G12-verify〔所有准备/投影/文案批次与原claim/staleness断言〕逐输入核对stamp/verify及落地权利，不重写选择状态机。 依赖：G04-resources/G05-verify/G08-verify/G09-ownership-verify
- 验收：运行中编辑/look/style/ref改变后旧结果只入历史；失败不清新claim。 停止：抽取要求改选择权/新增live read即停止。
- 未决：BD-12历史断言trace不是全部路径/全部运行状态语义证明；本轮不重跑。 证据：src/platform/server/db/scoped-workflow.ts:246-309；docs/architecture/workflow-snapshots-and-content-hash-staleness.md:294-298,419-461；全部证据、升级冲突与回退见JSON。

### GC-13 动态、对白、声音、音乐与导出

- 状态：**retain-justified**；historicalBehaviorIds：BD-05 / BD-06 / BD-07 / AEG-02 / C-08 / C-13。
- 已实现：motion/dialogue/music语言与模型槽随任务传播；协议/对白内容/音色/导出保持原控制流。 上游原行为：B已有shot级usesStartFrame、合镜/draft→final/lipsync、一次batch speech、录音claim/流式切片、music版本和export。
- 真实owners：src/motion/server/shot-motion-generation.ts:89 generateShotMotion / :671 renderShotAtQuality；src/motion/server/render-at-quality.ts；src/motion/server/workflows/motion-workflow.ts；motion-batch-workflow.ts；dialogue-audio-workflow.ts及同域dialogue-take/upload/lipsync。调用链：冻结shot/segment/dialogue/audio→原claim/预占→motion/batch/quality；locale和快照显式进入语言builder/孩子。 batch对白先录一次再fan-out；voiceProviderOf决定终生provider；export只复用基类context，不加通用模型机制。
- 目标：motion/audio/cast持pipeline/内容/claim；GC-04持语言资源；模型组持凭证/via/预算/费用事实。 保留：releaseVoiceIfUnreferenced、appendSpeech原batch、range+stream切片、audioClips/manifest、music hash复用及当前cut导出。 必要桥接：仅翻固定自然语言；Seedance时间/cut to、Kling multi_prompt、MiniMax [English]/<d>和用户对白保持。 lip-sync/music/voice接父快照，不统一成image attempt。
- 批次：G13-verify〔motion/合镜/draft/final/add-model、dialogue edit/take/upload、voice/music、API/MCP export〕保留生命周期，核对资源抽取/传播后的完整入口矩阵。 依赖：G03-verify/G04-resources
- 验收：shot级reference-only、draft/native路径和lip-sync子输入保持。 停止：改变对白/协议/录音次数/音色释放/资金owner即停止。
- 未决：本轮不运行真实音视频、native/fal供应商或production-only export Container；音频质量/恢复均未验收。 证据：src/motion/server/workflows/motion-batch-workflow.ts:178-235；src/motion/server/render-at-quality.ts:119-157；全部证据、升级冲突与回退见JSON。

### GC-14 Studio及生成素材的准备、排队和终态

- 状态：**planned**；historicalBehaviorIds：BD-01 / BD-02 / BD-03 / BD-06 / BD-07 / C-08 / C-13 / C-15。
- 已实现：Studio configured图先解析规格/refs/mask报价并保存runInput；每item先独立hold再row/dispatch；资产终态/provider来源保持真实。 上游原行为：B已有Studio/image/video/reuse、generated-assets、权利、逐项预占、partial success、queued/status和单图checkpoint；实际provider更新与模型组按C-15另核对。
- 真实owners：src/studio/server/create-studio-asset.ts:358 createStudioAssets / :136 snapshotInput / :192 zeroUnusedReservations；src/studio/server/studio-image-capabilities.ts:9 requireStudioImageCapabilities；src/studio/server/configured-studio-image-step.ts:12 runConfiguredStudioImageStep。调用链：image配置→prepareConfiguredImageBilling/capabilities→原权利检查→全部item reserves→各row/runInput/locale→trusted配置dispatch；启动项各自终结资金。 runInput冻结有效channelParameters；generate-image同step存全部；upload→uploads旧checkpoint只消费；通用asset保留endpoint Schema及触发后runId回写失败不误报失败。
- 目标：Studio持configured准备结果/snapshot；stills持attempt；模型组持provider/protocol；原create骨架不搬。 保留：图/视频不同输入、count/reuse/draft/reference、权利、partial success/dedup及独立item资金。 必要桥接：quote/operation/参数/provider/endpoint/trusted配置来自同次解析；builtin沿原capability/estimate。 prompt-draft只改新文字；普通asset仍沿原endpoint Schema/权限，不强接管理员图片路由。
- 批次：G14-image-prepare〔createStudioAssets configured image分支及Studio准备投影/既有capabilities模块〕收敛quote/有效参数/operation/配置引用为Studio单一准备职责；原rights/reserve/insert/dispatch顺序不动。 依赖：G02-verify/G10-attempt-verify/MODEL-IMAGE-QUOTE-CONTRACT；G14-asset-verify〔generated-assets/asset-generation、Studio actions/upload/prompt-draft、MCP generation-uploads〕核对其他入口的语言/身份/终态薄接入；provider持久化事实与模型组共验。 依赖：G14-image-prepare/G01-verify
- 验收：generate/edit/mask、多ref、native n/总数、reuse/分辨率/画幅最终参数一致，不静默相乘总数。 触发前失败标failed；触发后runId回写失败保留真实running，原dedup保持。 停止：需搬原rights/资金/create骨架、合并item envelope或复制核心即停止。
- 未决：新准备结果是拟建契约；需模型组先明确有效参数/quote。 真实gateway总数/partial账单/cross-deploy checkpoint未验收。 证据：src/studio/server/create-studio-asset.ts:368-391,477-502,529-645；src/studio/server/configured-studio-image-step.ts:19-57；全部证据、升级冲突与回退见JSON。

## 可执行首批与跨组接口

首批建议G09-reference-projection：只收敛cast实际sheet请求投影，direct/plan消费，不改UI readiness、claim、资金或控制流。模型组确认现有quote契约、父任务分配实施后可开始；本轮仍仅设计。

| 顺序 | 单职责批次                | 前置与输出                                                                |
| ---- | ------------------------- | ------------------------------------------------------------------------- |
| 1    | G09-reference-projection  | 图片quote契约；统一实际face/photo/ref-count                               |
| 2    | G07-partition             | 依赖1，同billing文件顺序实施；图片subtotal和counts排除，保留floor/unknown |
| 3    | G07-callers               | G07-partition + 现有快照契约；核对全部消费入口，不等待 G06 代码           |
| 4    | G14-image-prepare         | GC-02/10与模型契约；Studio准备结果单一owner，原资金循环不动               |
| 5    | G06-capture / auxiliary   | 模型快照、GC-01/03；复用可信对象，保护validator/auth/权利时序             |
| 6    | G04-resources / semantics | 本地化owner map；每次一个builder，英文/协议/中文全文分别验收              |

- 模型组负责策略、协议、凭证/via、有效参数/quote及成本来源；本组消费已有快照类型与事实，负责生命周期/传播，不改变平台组合根，不静默跨供应商。
- 本地化组负责英文owner/中文资源配对、维护报告与人工全文语义；本组提供最终消息/locale/保存边界。AST指纹不自动批准含义。
- G09与G07共享billing文件须顺序实施；资源/调用点与其它组由主线程协调，避免同时改同文件。

## 验收、停止与回退

- 后续实施先核对最新HEAD并保留/解释原断言。使用bun run test <co-located test>、createTestDb和明确供应商Mock；本轮没有跑测试/构建/服务。
- 验最终binding.create/模型参数/保存结果，不只验locale前缀/测试数；逐段人工核中文约束，英文原文、用户内容、role/变量/协议独立对照。
- 10项静态blob equality已在JSON保存：money、billing DB、workflow-deduction、reconcile、frame variants、character looks、locations、character/location sheet variants、styles DB均与B相同；无需搬移这些核心，不代表运行验收。
- 关注各职责upgradeConflicts：trigger/options、payload/codec、step/child ID、plan counts、版本/claim条件、stream storage和Studio checkpoint。保留已知解码兼容，不伪造缺语言任务兼容。
- 若要新增运行中可变配置读、改钱包/组织/权限/API/MCP、复制核心、改hash或修复用户暂缓项，则停止该结构批次交父任务；回退按单builder/投影/入口，不重写旧payload/历史hash，不换attempt ID重付费。
- 仍待验证：全部调用点组合/逐块语义、中文真实生成质量、供应商账单、Workflows引擎重启/跨部署、Workerd heap、远程D1、生产导出及部署。
- 本轮仅写本MD/JSON；既有routeTree.gen.ts保留，不修改应用/其它稿件/主计划，不提交或真实调用。
