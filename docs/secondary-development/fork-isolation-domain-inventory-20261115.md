# 二开全域隔离盘点（2026-11-15）

状态：本页保存 D 阶段前置盘点的原始观测；C 已正常提交并完成其记录的验证，I 固定为 `3f09e2b424e30eac5adbdb9cb8a12c60d783b573`。后续实际收口、最终全域处置和保留原因以[隔离实施结果](fork-isolation-results-20261115.md)为准。本文件覆盖盘点时全部 `src` 净差异路径和历史 60 职责/66 动作的领域归属，不把 54 个冲突文件作为重构边界。路径归类不是逐 hunk 语义批准，历史“保留有据”也不等于没有可进一步退出的职责。

## 比较对象与完整分母

- B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`；L：`fbf4396c6c241b834cf73fd7695a0b8cfa92fe2d`。原试点和 40 窗口比较继续使用原口径，见 [重构计划](fork-isolation-refactoring-plan-20261115.md)。
- U：`5da052c46d4a9ab232d865781f76e993a7667b2c`；本次按 `git diff --name-status --no-renames U -- src` 加未跟踪 `src` 文件取集合，保留实际工作内容的 SHA-256。HEAD 为 `ac9b56d913549e14c413d3c761531e69a1a9a12f`，MERGE_HEAD 为 U。
- 工作区并行适配中，以下是 **2026-11-15T04:50:47.858135+00:00** 的暂存前观测，不能冒称已提交树。新修改或最终 merge 后须更新比较对象；原 B/L/U 和试点分母不跟着漂移。

| 域              | 上游已有生产文件修改 | 新增生产扩展 | 语言资源 | 测试/故事/夹具 | 合计 |
| --------------- | -------------------: | -----------: | -------: | -------------: | ---: |
| models          |                   37 |           68 |        0 |             63 |  168 |
| billing         |                   11 |            8 |        0 |             15 |   34 |
| sequences       |                   54 |           45 |        0 |             88 |  187 |
| shots           |                   87 |            6 |        0 |             28 |  121 |
| cast            |                   79 |           16 |        1 |             53 |  149 |
| look            |                   20 |            7 |       24 |              9 |   60 |
| stills          |                   13 |           16 |        0 |             34 |   63 |
| studio          |                   17 |           11 |        0 |             26 |   54 |
| motion          |                   22 |            4 |        0 |             17 |   43 |
| audio           |                    6 |            0 |        0 |              1 |    7 |
| assistant       |                   19 |            8 |        0 |             17 |   44 |
| platform        |                   47 |           15 |       15 |             55 |  132 |
| routes          |                   60 |            1 |        0 |              1 |   62 |
| ui              |                   46 |           14 |       44 |             11 |  115 |
| stitches        |                    3 |            0 |        0 |              1 |    4 |
| 组合根/生成文件 |                    3 |            0 |        0 |              0 |    3 |
| 测试支持        |                    0 |            0 |        0 |              1 |    1 |
| 合计            |                  524 |          219 |       84 |            420 | 1247 |

“上游已有”指路径存在于 U，排除语言与测试类后仍有本地修改；“新增扩展”只说明 U 没有该生产路径，不证明它已经低耦合。语言类包括 `locales`、独立 `prompts/zh-CN` 和 `*.zh-cn.ts`，不把含业务 builder 的双语模块算纯译文。测试类含 413 个测试文件、2 个故事及 5 个夹具/支持文件，新增/修改来源仍逐行保留，不能全部记作新增覆盖。

完整路径与读取时内容指纹分别见 [核心修改](refactoring/20261115-domain-inventory-core.tsv)、[新增生产扩展](refactoring/20261115-domain-inventory-extensions.tsv)、[语言资源](refactoring/20261115-domain-inventory-locales.tsv)、[测试及支持](refactoring/20261115-domain-inventory-tests.tsv)。四表互斥且并集等于上述集合；`?` 仅表示尚未跟踪，不表示本盘点创建了应用文件。`routeTree.gen.ts` 属生成文件，应由路由生成，不手工借机重写。

本分母只统计 src。`packages`、scripts、构建/CI、账号邮件相关外部模板、项目配置和文档的职责仍纳入下表与历史台账；未将它们藏在“无 src 差异”后宣布完成。

## 全域职责与真正可退的范围

| 域与历史职责                                                        | 已有隔离/本轮上游接管                                                                                              | 尚需退出或缩小的具体点                                                                                                                                                            | 必须保留的桥接、删除条件                                                                                                                                         | 下一批及验证                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| models（MC-01—MC-13）                                               | 管理配置、文本/图片 registry、快照 codec、协议、价卡、公共目录分别已有模块；静态数组没有被运行时注册改写           | `models.config.ts` 仍收 overlay 的 lookup/selection/预算/vision；`models.ts` 的图片可读身份、静态 endpoint 与配置 guard 混在一起。预算已定位单一可退消费点                        | `AnalysisModelId`/图片身份须保留 custom 类型，公开目录不能泄漏执行凭证；静态表不被运行时改写，内置退休状态仍保留。仅在各动态消费者已迁移并验证后恢复对应静态函数 | 先 D-M1，再分开做 D-M2/D-M3；不整体恢复两个 registry 文件                                                |
| billing（GC-07/11，MC-04/06/09/10/11）                              | B2 让 `estimatePlanCost` 退出路由和参数传播；配置文本成本、图片价卡精度、计划分区已有 owner                        | `cost-estimation.ts` 的其它图像/Storyboard 入口仍有配置参数链；应逐函数确认能否复用已存在的 configured billing 组合，不能因 B2 完成而整文件宣称恢复上游                           | `imageSource`/`llmSources` 和 reservation 必须来自实际调用凭证。上游没有等价收费来源证明前不得删除。USD/组织钱包和已有暂缓项不改                                 | 先列剩余签名的实际调用者，再选一条配置报价链；混合内置/custom、未知价、零价、金额及预占释放断言保留      |
| sequences（AB-07，GC-02/03/05/06/07/10/11/12/13）                   | `configured-sequence-input`、prepare、lifecycle/notification DB 模块独立；C 已将旧风格定义迁到上游 resolver 新落点 | `launchers.ts` 的模型快照读取、`create-sequences.ts`/smart-retry 的默认值与能力规则仍接核心；须让模型规则退出，而不搬 claim/dispatch 骨架。两种 runtime loader 目前不等价，见后文 | 必需 `promptLocale`、可信 snapshot、root owner、失败清理及通知认领不能删除；仅当上游有同等约束且原恢复测试通过才删本地保证                                       | D-M2 的创建/增强/重试消费者先收口；再对 loader 做停用模型对照。继续/重试/空白/原 root admission 契约验证 |
| shots（GC-08/12/13，PL-04/05）                                      | 配置报价 bundle、版本/claim、领域显示适配已有独立边界；C 接上游 manifests/spec 版本和历史                          | `shot-image-input.ts`/`shot-preview.ts` 仍做请求模型准备与报价 handoff；`prompt-context` 的 custom 身份消费可随模型身份边界迁移。UI 显式翻译不能靠复制整页撤出                    | selection claim、staleness hash、对白范围和 parent snapshot 属 shot 业务；不能迁到通用模型执行器。只有另一处重复规则实际退出才提取                               | 在 U 的 manifest 适配验过后一次选 still 或 preview 一条；参数/哈希/实际费用与旧结果不覆盖新指针回归      |
| cast（GC-03/09/10/12/13，MC-07/11，PL-04）                          | `sheet-image-request.ts` 已让计划/直接 sheet 共用规格投影；组织角色/地点/look 仍属上游                             | `cast-generation`、各 sheet workflow 的 locale/模型/quote/终态接入仍是核心修改；已有 projection 不重复再造一层。先查 model-lookup 规则是否还能移出，未证安全退出不强拆            | 组织共享、claim/promote、默认 look、用户挂入实体不可被 analysis 重写、钱和 attempt owner 保留；上游等价 owner 契约是删除条件                                     | 选一类 sheet 的真实 DTO/快照/价款链，比较原核心 hunk 与新增接缝；不同时改三类 sheet 生命周期             |
| look（GC-05，PL-04）                                                | recipe/样例译文在 `look/localization`；C resolver 复用上游模块，旧 `create-sequences` 定义退出                     | `auto-style.ts` 的 locale-aware schema/fallback 仍在原文件；其 preprocessing 与英文 schema 有真实绑定，未见可直接删除的重复 owner                                                 | 保存 recipe 不能随界面语言/活目录回读。仅当可将语言选择移到已存在调用边界且不复制 schema/coercion 时再缩小                                                       | 对 collapse fallback 和来源 recipe 的中英/用户编辑/clone 保存快照回归；没有已证下一处 source-exit 时保留 |
| stills（GC-08/10/12，MC-07/10/11/12）                               | compatible transport/bytes/response/attempt/step 各自独立；入口只先派发配置渠道，原生执行骨架继续上游              | `build-image-request.ts` 的 custom 分派与静态 builder、`image-generation.ts` 的配置早返回及 builtin 收窄仍有桥接。D-M3 需核清调用者后才能恢复静态函数                             | 一个 generate step 内存储、未知结果不重付费、实际 via 与错误归属必须保留；静态 builder 不得索引 custom，绑定 builtin 也不能落错原生 via                          | D-M3 只做身份/静态访问的一项职责；原生与compatible、引用/蒙版、inline bytes 和 record retry 均保持原断言 |
| studio（GC-14，MC-01/08/09/10/11，PL-08）                           | `prepare-studio-image`、configured step、controls/draft/output helpers 已独立                                      | `create-studio-asset.ts` 仍接 configured quote、asset id/reservation、queued provider 与 runId；这些接入属于不同生命周期，不能整段包进通用 helper 只藏 diff                       | source ownership、likeness/compliance、权属、单次快照、预占和终态须留原业务 owner。待真正重复准备规则可退出时才收口                                              | 先复查模型目录/准备规则，后选一段 duplicated projection；数量/参数/停用/编辑来源/触发不确定结果回归      |
| motion（GC-03/04/13，MC-07，PL-10）                                 | bilingual prompt builder、显示原因映射已有模块；原生 via/视频型号和执行仍上游                                      | `motion-workflow` 的 stored analysis ID、配置/locale 传递属于模型域可下沉的身份规则；UI 文案没有通过 B1 门槛的替代方案                                                            | job via stamp、音频切片、packed clip、modelConfiguration/locale 父子传播保留；不能为少参数重建全局读配置                                                         | 先随 D-M2 调整身份消费者，再核对 root→motion/music 子任务回放；不动视频模型协议                          |
| audio（GC-03/12/13，PL-05）                                         | 原录音/音乐/对白服务和内容边界保留；显示语言与用户对白分开                                                         | `music-edit.ts`/`music-staleness.ts` 的 stored custom identity 规则应归模型身份层；locale 只做已有入口快照传递                                                                    | whole speech、shot section、claim 和声音生命周期不能抽到图片 attempt；上游等价保存/回放才可退出                                                                  | 与 D-M2 身份消费迁移同测；音乐 prompt、staleness、原声线/对白内容不变                                    |
| assistant（AB-04/06/09/10/11/12，PL-09）                            | C 让上游 `approvals.ts` 接管状态/composer gate，删除旧生产 helper；SDK 身份保护迁入统一入口；MCP 卡片使用同一 HTML | `chat-model.ts`/`assistant-chat.ts` 的 overlay lookup/vision 可随 D-M2 退出静态 core；schema 适配和 host locale 各归现有模块，不再加助手专用工具执行器                            | typed/generic 签名、绑定身份、旧 snapshot 防双击、HTTP/SDK 持久化和工具权限仍必需；上游完全覆盖才删本地校验                                                      | D-M2 同测 custom tools/vision/管理员默认值；保留真实 SDK 审批/恢复、MCP host 隔离与未知错误原样展示      |
| platform（AB-01/02/04/05/13/14/17，GC-01/02/03/04/11/12，PL-07/09） | locale/request 工具、prompt 中文资源、准备 trigger/failure 边界已有独立模块；scoped 是允许的组合根                 | `scoped.ts` 的模型内容投影可考察缩回 model-owned loader，但当前两种 image catalog 语义不同，不能搬完就称去重；`client.ts`/base/await-child 接线保留                               | auth/organization、SQL/client-server/domain-blind、可信配置覆盖、每子任务必填 locale 和窄 DB 面属于边界，不能用万能 context 隐藏。上游等价接线可删额外层         | 先验证两个 loader 的原语义，再决定是否有重复决策可删；credentials/primary/codec/父子断链和边界测试       |
| routes（AB-03/07/08/17，PL-01/03/06/08/10）                         | route 只调用现有领域 service；locale/head/session 与 SSR owner 保留；C 采用上游公共首页独立路由                    | 页面显式翻译、少量默认配置/schema 入参桥接仍改上游文件；仅在已有组件/service 正好拥有重复职责时迁移，不复制路由或重新启用 B1                                                      | 页面导航/URL/search/权限、公开 docs session 首屏一致、API固定语言与输入契约不可删除；上游等价预取后删除重复 session await                                        | 复查新首页和 docs 的最小接线，中英 SSR/水合/返回/元信息/匿名和登录态验证                                 |
| ui（AB-01/02/03，PL-01—PL-06/08）                                   | i18n runtime/resources、格式化、markdown、动态错误/通知 helper 已分开                                              | layout/settings/shadcn 的显式文案是剩余大面；B1 已有语义反例，不以 DOM替换/编译规则迁移替代逐处显式翻译。`query-client.ts` 两处身份世代 guard 不是文案                            | request-local SSR i18n、异步语言、原用户内容、未知错误和迟到身份回调保护继续保留；上游同等 i18n/缓存 guard 才删除                                                | 沿原 owner 复用重复展示块，每批必须有真正退出的 hunk 和维护成本证据；无收益就停止提取，保留显式翻译      |
| stitches（AB-08，PL-10）                                            | 独立包 labels 接口与应用文案分离，同一播放器；发布权属服务仍上游                                                   | `create-stitch.ts`/`publish-stitch.ts` 的 locale 分类输入是薄接线，没有可直接撤掉的平行实现                                                                                       | 公共资源发布/真实人物检查、静态 bundle 与 app schema 不可混成新生成器；上游有语言契约后再删参数                                                                  | playback labels/键盘/字幕/公开发布权属测试；生产 Container 单独未验证                                    |
| 组合根与测试支持（AB-14/17/22，PL-01/02）                           | Router、server、routeTree 和 test/setup 有固定 owner，生成噪声曾独立恢复                                           | `router.tsx` 的 i18n provider/SSR hydrate 是必要接线；仅生成噪声可由原工具恢复，不能把生成 diff 算架构退出                                                                        | 单请求 i18n、全局测试资源和客户端导入边界继续保留                                                                                                                | 最终生成/类型/构建/边界及有效测试；不复用历史测试总数冒称本轮验收                                        |
| src 外工程与治理（AB-15/16/18/19/20/21/22，GOV-01）                 | 项目 Hooks/技能、Windows argv/path、preview DB guard、维护报告归工程 owner                                         | 逐项复核上游新版已修的 workaround：例如 Vite inspector 只有真实受影响 Windows 路径测试后才能退出。依赖/包发布不是功能重构                                                         | 上游组织/预览库身份、正常 hooks、hermetic E2E 和本地生成产物边界保留；等价上游行为是删除条件                                                                     | scripts/CLI/preview/Workerd/Storybook 与生产环境区别记录。未授权外部发布、迁移和部署仍不执行             |

上述表覆盖 `AB-01…AB-22`、`GC-01…GC-14`、`MC-01…MC-13`、`PL-01…PL-10`、`GOV-01` 共 60 项；[历史职责](preservation/20261115-p3-completion/responsibilities.jsonl)与 [66 动作](preservation/20261115-p3-completion/actions.jsonl)只用作范围/原断言追溯。原状态 `original-structural-disposition-complete` 不转成 D 已完成，不重新建立一套 60 行逐条打绿台账。

## 模型目录四层边界与消费链

当前不是全局注册机制：`SCRIPT_ANALYSIS_MODELS`/`IMAGE_MODELS` 始终静态，`mergeTextModelCatalog` 在局部新建 Map，routing 以显式参数和 `scopedDb.models` 的已解快照传递。本轮不会增加进程级 registry、启动注册或 mid-run 配置回读。

| 层                                            | 实际当前职责                                                                                                        | 本轮判断                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `models.config.ts`                            | 内置注册表/默认值；另加 custom type/语法、stored identity、lookup/selection/vision/预算 overlay                     | 可逐函数恢复静态实现，不能整文件恢复并丢弃 custom 类型与历史可读身份                                            |
| `models.ts`                                   | 静态媒体表；TextToImageModel 扩成 custom union，静态 endpoint helper 加 builtin guard；通用 valid/safe 接受配置身份 | 图片类型在持久化/DB/workflow/API广泛使用；必须先分清“可识别”“可选”“可执行”，再缩小 runtime import/静态访问修改  |
| `text-model-catalog.ts`                       | 公共 entry/routing 投影成模型描述，保留 builtin 名次/退休，替换限额/能力并增加 custom；不解密凭证                   | 这是已有动态 owner，可承接 lookup/selection。不能直接用 `mergeTextModelCatalog` 接执行 key，也不能让 UI拿 route |
| `server/configured-text.ts`                   | compatible 协议参数、能力、实际 route 限额、usage 归一及 E2E host guard                                             | 预算 owner 已存在，可先让 route budget 从 static core 退出；普通/流式/助手参数仍各保持原 wire 约定              |
| `model-runtime-configuration`/workflow codecs | 捕获默认槽位与 text/image routes，显式 pack/unpack 冻结 credentials reference、能力和价格                           | 保留现有 payload/codec 与 snapshot，不为缩小 import 取消精确执行绑定                                            |

全部当前显式符号引用见 [消费点快照](refactoring/20261115-text-model-consumers.tsv)：15 个目标符号，含 production 和 test/story，逐行保存路径、行号和源码。它是检索覆盖，包含 import/定义/注释，不将行数当函数调用数；变动后的行号只供定位，不当最终提交证据。

| 消费类别                   | 已核对的实际入口                                                                                                                                                                                         | 必须保持                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 公共/管理员目录与默认值    | `ui/use-text-model-catalog`、`ui/use-admin-model-configuration`、`model-configuration`、`server/db/model-configuration`、`platform/server/db/scoped`                                                     | public entry 不带 endpoint/credential；catalog overlay 优先，同 id 内置退休位仍保留；native video-understanding 槽位不接 custom |
| 创建/增强/继续/重试        | `models/ai.fn`、`sequences.fn`、`create-sequences`、`launchers`、`script-enhancement`、`studio-asset-actions`                                                                                            | 显式选择、管理员默认值、structuredOutput 能力与 request snapshot；禁用 custom 无可用 route 时拒绝，不能静默改内置默认           |
| 助手/选择器显示            | `assistant/chat-model`、`assistant-chat`、`assistant-store`、`ui/pickers/model-badge`                                                                                                                    | tools/vision、区域策略、用户偏好及已有 builtin retirement，不仅按 id 是否在数组里判断                                           |
| Durable 调用与 scene split | `llm-call-helper` 两条普通/stream路径、`llm-client`、`llm-output-budget`、`scene-split-workflow`                                                                                                         | 凭证每次实际解析后，compatible 用其 frozen route，native/网关用原预算；scene/bible 65% 与 shots 全预算不改变                    |
| 保存身份和历史 fallback    | `music-edit/music-staleness`、voice enqueue、`prompt-context`、`update-stale-plan/references`、`regenerate-shot-prompt`、smart retry、soften、motion workflow；UI generation settings、script/scene list | 可读 custom 身份不等于可执行，缺路由时不发未知模型；同名用户数据/未知标签不翻译                                                 |
| 纯内置显示/估时            | `model-label`、`eval-sequences-mobile`、`time-estimate`、空白创建的 id归一                                                                                                                               | 原名字 fallback/粗估/保持已选 custom 标识的行为不能因动态 lookup 迁移被顺手改变                                                 |

特别的非等价点：`launchers.loadStoryboardModelConfiguration` 从 active image routing 构造 `toImageModelCatalog`；`scoped.loadModelRuntimeConfiguration` 从完整配置构造 `imageModelCatalogFromConfiguration`，后者包含不可用 custom 的可读条目。它们不能按“代码很像”直接互换；应先用停用 custom、builtin binding 停用、缺 credential、读默认值与实际新建的对照明确差异归属。本盘点不把这个可能行为问题伪装成已批准修复。

## 可立即实施的最小 source-exit：D-M1

目的仅为退出静态 core 的动态预算职责：

1. 将 `models.config.ts::getMaxOutputTokens` 恢复为 U 的原签名 `(modelId, fraction = 0.5)` 和原函数体。它的 production 第三参消费者只有 `server/llm-output-budget.ts`；另一个 custom 第三参断言在 `workflow-text-model-routing.test.ts`。
2. 在已存在 `server/configured-text.ts` 复用/收拢 route clamp，让现有 `getLlmMaxOutputTokens` 按已解析 key.route 取得预算，不再为了一个 budget 创建 catalog 再交回静态表。只允许单一配置预算算式，不复制原生预算表或创建通用 executor。model/route id 不匹配时保留当前 fallback 语义，不悄悄按错误 route 算价或预算。
3. `getContextWindow` 的 extraModels 在全 src 没有调用，测试也只有一参数内置用例；可同批恢复 U 实现。所有 custom 预算断言迁到真实 key/route 边界，保留 pack/unpack→预算这一消费证明。
4. 原生未知模型上限 32,000、fraction clamp、minimum 1、configured 的 context/output 双 ceiling、0.65/1.0、两种协议 wire 与同 snapshot 在后续改配置后不漂移都须保留。继续使用 `scene-split-workflow.test.ts` 的真实 credential-aware 预算回归，并测 `max-output-tokens`、`configured-text`、workflow-routing、LLM调用边界。

预期可核验产物是两个静态函数的签名和函数体与 U 一致、dynamic→static 的额外参数边退出、无新增生产文件，以及行为契约通过。`models.config.ts` 还有其它 type/lookup/vision 修改，因此不承诺文件退出冲突；也不承诺固定 40 窗口或未来合并数量下降。执行前保存 C 集成对照 I，完成后按函数/接口/差异块比较，不以 helpers 数量宣称成功。

## 随后的批次与停止门槛

- D-M2：只处理动态 lookup/selection 归属。以既有 `text-model-catalog` 接收显式 catalog 为 owner，迁移所有带 overlay 的调用，恢复 static lookup/selection 原签名和函数体；保留 custom type和stored identity。不要把“语法可读”“当前可选”“本次可执行”合成一个布尔。`isCustomAnalysisModelId` 与 `isCustomTextModelId` 目前长度规则不同，不能直接相互替换以冒充去重。
- D-M3：再单独选择 vision fallback 或图片静态访问一项职责。前者涉及 snapshot能力与实际key能力两次不同时间的判断，后者涉及 static table索引/历史custom/绑定builtin的区别。先完整消费点对照再改，既有上游调用不凭空接 dynamic context；若只是新增 wrapper、无法让原core职责退出，就不扩大。
- 其余域依前表逐条确认剩余 owner，优先删除上游已覆盖实现，其次让已有扩展承接重复规则，最后保留有必要的桥接。无安全退出证据时明确保留和删除触发，不以“全域盘点”推导出全域完成。
- D 应覆盖整个 src 净差异及 src 外职责，不能只做模型域或 C 的 54 个冲突点。每批一个职责，原行为、实际退出 hunk、所增接缝、原断言/新增差异契约和未验证边界一起记录；发现外部行为变化先停止该批设计。

上述候选与“下一批”列描述盘点时点，不自动转成最终树的待办或完成项。I 已固定；D 的各次实际提交、R、源码退出及验证见[隔离实施结果](fork-isolation-results-20261115.md)。U 已整合后，对 U 的零冲突仅是祖先关系。未来 V 出现后才用同一 V 比较 I/R 的合并成本；此前只报告可审查的源码退出和当前行为证据。C 的成功、60职责覆盖或测试总数均不替代 D 的最终验收。
