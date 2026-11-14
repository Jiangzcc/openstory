# 上游业务保留与二开长期维护计划

版本日期：2026-11-15。状态：P0、P1 已完成；P2 历史范围与补证保持归档，1项计费缺口按用户决定暂缓。P3原全量结构范围已收口，60项职责、66个动作、最终差异处置与实际验证见[P3完成记录](p3-completion-20261115.md)。此前暂停的共享设定图代码已补全、验证并提交；原历史清单及59条日志前缀保持，环境验收、未来触发和独立可靠性边界另列，不承诺全局冲突数下降。P4未执行；普通上游同步按原准入规则推进。

本计划覆盖已经发生的二开、历史合入、当前缺口，以及后续新功能和上游更新。目标是尽可能保留上游业务逻辑和实现，在可解释、可验证的少量接入点上二开，降低持续升级成本。

用户先授权执行 P0、P1，固定范围与实际结果见 [P0/P1 实施记录](upstream-preservation-p0-p1-20261108.md)，后续已授权执行 P2，范围、处置与当前验证状态见 [P2 实施记录](upstream-preservation-p2-20261108.md)。结构收口、CI 和商业功能分别按实施状态推进；制定计划不表示这些工作已完成，也不自动开展推送、部署、生产数据库操作或真实供应商调用。用户后续授权某阶段后，连续完成该阶段内的必要工作，不为每个常规步骤重复索取确认。

## 1. 最终要达到的状态

1. 已合入的上游范围明确，能指出尚未合入的更新，历史与实际代码分别核对。
2. 已有二开的每处业务差异都有归属：现行需求、必要兼容、安全修正或已验证缺陷；无法解释的偏离不作为默认实现继续扩散。
3. 组织、角色、钱包、创作、工作流、API/MCP、存储和发布等上游执行骨架尽量保留，新增职责集中在所属领域，核心文件只做必要接入。
4. 上游原测试断言持续保留或有可追踪的等效迁移；新增二开测试不替换原业务保障。
5. 关键默认路径与明确二开策略都有可重复的当前验证。每批同步有固定范围、明确结束点和实际成本记录。

这不要求绝对零修改上游。默认中文、平台渠道以及未来明确批准的凭证或售价策略本身会产生行为差异，验收目标是差异集中、必要、可解释、可验证。安全修正也不能为追求表面一致而撤回。

## 2. 现状与固定起点

以下是 2026-11-08 最近一次成功核验的快照。实施开始时重新检查引用、工作区和需求状态；后续 fetch 不自动移动本计划某一执行批次的范围。

编制本计划时再次 fetch 遇到 `Connection was reset`，刷新失败，因此下表 U 沿用最近一次成功引用；6 个主线节点是该快照的差额，不能据此宣称此刻上游没有更多更新。

| 对象                   | 快照与结论                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 历史审查的纯上游基线 B | `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`，也是本次核验的 `origin/main`                                                            |
| 历史审查的本地起点 L0  | `b4973d7fb1f563b5181970388d810bc147e60263`，当时二开 `develop`                                                                      |
| 已核验的开源上游引用 U | `66416dfa1dfa2da480b0bf3eadf3f26ad3188650`；相对 B 多 6 个主线节点、8 个历史提交，尚未合入                                          |
| 本地 main              | `003e2df7c4986fc236ea9a1c67c3f18089874d48`，较旧，不用它冒充最新上游                                                                |
| 历史完整性             | B 的全部提交已进入 L0，缺失为 0；这不能证明合并后的业务逻辑完全保留                                                                 |
| 初始差异范围           | 相对 B 有 649 个既有路径修改、467 个新增路径；其中 603 个是既有 `src` 路径。没有删除基线文件                                        |
| 合入过程候选           | 已枚举 26 个第一父链 merge，其中 15 个有冲突解决或额外适配差异；尚未逐块完成保真审查                                                |
| 审查与 CI 状态         | 当前只有核心热点审查；`Test` 工作流响应 `push main` 和任意目标 PR，直接 push develop 不触发这份工作流，不能假定二开已有完整远端门禁 |

以上数量包含翻译、测试、文档和工具，不能全部算作核心业务侵入。它们是首轮审查分母，每轮新增、改名、删除及跨文件影响都要重新计算。

P0/P1 执行另固定 L 为 `a1dd140dabd381a35366a0d6404b3b4c55cdf700`，不替换表内历史 L0。此次 fetch 成功，固定 U 为 `6a9dcadb33d915fbedf80720a844968a6a8bea62`（B 之后 7 个主线节点、9 个历史提交，未合入）。执行起点净差异为 649 修改、468 新增；完整候选与来源见 [P0 清单](preservation/20261108-p0/README.md)，保留原始待审查快照。P2 另按其固定起点补充完整候选；2026-11-08 记录的范围覆盖、处置及收尾验证见 [P2 实施记录](upstream-preservation-p2-20261108.md)。2026-11-09 复核确认范围分母，纠正已发现的行为映射/提交引用并补充原断言对应；定向补证不自动证明全部路径的全部业务状态，当前结论以补证及明确暂缓项为准。

### 已确认的问题与例外

| 项目                 | 已有证据                                                                                                                                                                                        | 当前状态与后续处理                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 地区恢复被扩大禁用   | `src/models/server/llm-call-helper.ts` 的 `withCallRoute` 按平台绑定是否存在决策，实际组织 Key 也受影响。8 项隔离对照中，上游 4 项、本地未绑定 2 项通过，本地绑定存在但组织 Key 胜出的 2 项失败 | P1 已修复并提交；实际非兼容渠道恢复，实际 compatible 固定渠道，Google 并发初始状态保留 |
| 上游执行测试被替换   | `AnalyzeScriptWorkflow` 原 4 组、8 项运行回归被本地鉴权测试替换；复制原断言后首跑 8/8 通过                                                                                                      | P1 已恢复并提交；原 8 项执行断言保留，本地 3 项鉴权测试迁移后继续运行                  |
| 旧角色表任务兼容     | 历史二开在 `sheet-snapshots.ts` 将缺 `referencePhotoUrl` 归一为 null，区别于上游拒绝                                                                                                            | P2 经用户确认恢复上游拒绝规则；实际处置与验证见 P2 实施记录                            |
| MCP 身份分类         | Cookie session 与 API Key 区分，管理员 `osk_` 上游跨组织能力仍保留                                                                                                                              | 已有安全修正，单列依据，不据已取消的管理员浏览规划扩大限制                             |
| 平台与组织凭证优先级 | 文本渠道已有适用组织 Key 优先等明确规则；图片绑定另有自己的平台路由规则                                                                                                                         | 按具体调用和已确认需求审查，不能把不同媒体策略混为一条，也不能假定全面禁 BYOK 已实施   |

前两项可追溯到历史二开提交 `23bde5064108ae45800ddc57850bb3977c749a9f`，所以审查不能只看最近的上游 merge。

原始证据保存在本地忽略目录 `.tmp/upstream-preservation-audit-20261108/`。这些临时材料不保证存在于其他检出；实施时把必要回归纳入正式测试，并在本目录记录结论。历史全量 8999 项通过不能替代本次保真审查。

## 3. 分阶段交付与依赖

| 阶段              | 工作                                              | 依赖                                   | 交付与完成条件                                                                               | 当前状态                                                         |
| ----------------- | ------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P0 固定审查范围   | 核对 B/L0/U、需求、索引和工作区，形成完整候选清单 | 无                                     | 范围、来源、未合入提交和验证环境可追踪；已有用户改动保留                                     | 已固定，完整候选清单已建立                                       |
| P1 修复已证实缺口 | 恢复 8 项上游执行回归，修正地区恢复边界           | P0                                     | 保留原断言；旧代码反例失败、最小修复通过；真实 compatible 仍不跨渠道回退；分别提交           | 已完成，分别提交并验证                                           |
| P2 全范围保真审查 | 审查全部净差异、历史 merge 解决及间接调用契约     | P0；实施修复沿用 P1 规则               | 所有候选路径归类；所有非平凡业务差异有依据和处置；原断言变化可追踪；风险场景有证据或明确边界 | 历史范围已归档；已发现问题定向整改，1 项用户暂缓，闭合程度见补证 |
| P3 全量职责收敛   | 按整个 fork 的现行职责整理全部长期差异            | 对应 P2 来源可追溯，当前版本逐职责核对 | 每处差异有处置；二开决策集中；必要接入有依据；保留上游行为并有前后验证                       | 原结构范围完成，当前证据与边界见P3完成记录                       |
| P4 建立持续守卫   | 差异报告、原测试变化检查、关键契约及 develop CI   | P1；随 P2/P3 分批扩充                  | 先校准报告，再阻断确定错误；本地与远端触发方式清楚，正常 hooks 保留                          | 待执行                                                           |
| P5 纳入新增上游   | 对固定候选目标逐项评估、适配、合入和验证          | P1；批次涉及的关键领域有充分 P2 证据   | 上游映射与业务差异两层核对；最终集成验证通过；实际合入后更新基线                             | 目前仅有未合入快照                                               |
| P6 长期运行       | 后续二开准入、固定同步窗口、成本与质量复盘        | 上述机制逐步可用                       | 每个新功能动态进入清单；每批范围与证据明确，维护成本可比较                                   | 待执行与持续维护                                                 |

主执行顺序为 P0 → P1 → P2 高风险领域 → P5 对应更新。P5 满足 P1 和相关 P2 证据即可开展；P3 按全量职责目标分批实施，不由当天上游改动或局部试点缩减范围，也不作为普通同步的强制前置。P4 从 P1 开始逐步加入，P2 其余领域持续完成，各阶段最终必须按自身全部范围闭合。

安全、数据丢失或错误收费的紧急上游修复可及时评估和隔离处理，不机械等待全部历史审查结束；它影响的二开契约仍须验证。普通更新不在审查过程中悄悄扩大范围。

按领域和验收点交付，不用一次大重构承载所有阶段。首个审查批次取得实际耗时后再估算剩余工作量，不在缺少数据时承诺总工期。

## 4. 之前的二开如何完整清理：P0—P2

### 4.1 建立可核对的总清单

候选来源同时包括：纯上游 B 与当前本地的净差异、从初始分叉至 L0 的本地提交及合并解决、工作区变化、已变更接口的全部调用者。路径没有交叉，不代表行为没有交叉。

每个路径先归类为：翻译资源/展示、独立新增职责、必要桥接、业务规则变化、安全或缺陷修正、测试及工具、生成或依赖文件、尚未解释。一个路径可对应多个行为，不能给整文件贴“国际化”标签就跳过其中业务改动。

每个非平凡行为块记录一行：**路径或入口 → 上游原行为 → 当前差异 → 现行需求或修复依据 → 保留/回归上游/修正/待决策 → 验证证据**。清单可以使用 Markdown 加机器清单，不要求为每个文件另建文档。

新增文件也要检查注册、初始化、公开导出及调用关系，确认没有复制整套上游执行器或在未参与本次调用时改变原行为。配置、依赖、锁文件、脚本、CI 与文档均纳入，不能只完成 603 个 `src` 路径就宣布全范围完成。

### 4.2 按风险分批审查全部领域

| 顺序与领域                       | 上游应保留的重点                                                               | 已有二开和必查差异                                                                    | 验证要求                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A 身份、组织与资源权限           | 登录、匿名升级、邀请/切换/共享、角色、OAuth/API Key、组织隔离                  | 语言上下文、MCP 身份分类、管理员模型配置权限；不恢复已取消的管理员浏览规划            | 身份/角色矩阵；原组织接口和权限断言；关键未改文件可用 blob 同一性证明             |
| B 钱包与生成状态                 | 真实币种、预占/扣费/释放、幂等、claim、选择指针、stopAt/continue、未知结果恢复 | 平台调用来源、渠道价卡、配置快照、部分图片交付；区分已有 USD 计价与未实施人民币规划   | 真实测试 D1 状态、并发/重试反例、同输入 Mock 对照；不能只看返回码                 |
| C 模型与供应商调用               | 内置目录、原生/fal 路径、普通/流式/durable 执行、usage 与错误处理              | 默认/辅助模型、文本/图片绑定、自定义目录、凭证优先级、地区恢复、Google Files 原生路径 | 无绑定、绑定未胜出、实际兼容渠道、原生路径四类对照；准确凭证来源和路由断言        |
| D 创作流水线与持久化             | 分析/分场、角色/地点/镜头、提示词、参考素材、过期判断、子任务、同 step 存媒体  | 任务语言、模型快照、规格派生、放大/变体、重试、旧参考图任务兼容                       | 恢复上游执行测试；父子快照、步骤顺序、hash、失败和旧结果不得错误晋升              |
| E 助手、公开 API/MCP、分享与导出 | 工具注册、审批、权限、协议 Schema、页面上下文、分享/下载/导出                  | Schema 桥接、审批兼容、模型配置和中英文卡片；上游已有能力不被二开裁剪                 | 原工具/端点存在与行为；真实 SDK 加 Mock；保留 Cookie/API Key/OAuth 安全例外       |
| F 页面、帮助、邮件及系统指令     | 表单、导航、hydration、异步刷新、原内容/单位与供应商协议                       | 中英文资源、默认中文、浏览器记忆、模板选择、风格与预置配方                            | 中英切换不触发重复业务；SSR/客户端一致；变量、标记与用户原文保留；桌面/移动浏览器 |
| G 合入修正、工程与部署配置       | 上游依赖/锁文件、Workerd、工作流和 cron wiring、本地与生产绑定边界             | Unicode 地点匹配、SSE 补读、预览 D1 清理、E2E 准备/清理、Codex 工具与 hooks           | 逐项追溯；脚本 SQL/条件竞争测试；确认 CI 实际触发，项目配置局部生效               |

A—D 优先，其他领域仍必须完成。每一批允许并行只读审查；共享索引、merge 状态、ScopedDb/workflow types 等交叉入口由主执行者串行整合。同一服务、端口和测试资源指定一个所有者。

G 类同时核对 schema、历史 migration、journal/snapshot 与生成类型是否漂移。没有二开变化时记录零差异；审查本身不要求生成迁移、执行迁移或访问远程数据库。

### 4.3 P1 的具体关闭标准

- 测试恢复：将固定上游 4 组、8 项 `AnalyzeScriptWorkflow.runImpl` 回归纳入正式仓库，保留其业务断言；本地 onFailure 鉴权测试继续存在，必要时另设文件。
- 地区恢复：以实际解析凭证决定 compatible 限制；未使用配置渠道的调用保留上游恢复，每次恢复重新解析目标模型凭证。覆盖两种 durable 入口以及普通调用的一致性，不把恢复策略扩展成任意供应商互相切换。
- 两项分别提交，用当前版本新增纠正提交，不改写历史。临时审查用例转换成可持续测试，失败证据与修复结果分别记录。
- 旧任务兼容、其他凭证优先级等差异作为独立审查项，不借 P1 自动调整；当前明确要求缺少 `promptLocale` 的历史任务不兼容，继续遵守。

### 4.4 全范围审查的完成判据

同时满足：候选路径全部归类；全部非平凡行为块有处置；未解释的业务覆盖和关键断言丢失为零；高风险场景完成当前验证；待决策及环境限制明确登记。未关闭的严重缺陷不得写成“审查通过”。

“审查覆盖完成”与“验证通过”分别统计。待决策、待修复或待验证事项可以登记，但不能计入验证闭合；本批承诺验证的场景未执行或失败时，仍保持未通过。事先明确不覆盖的外部环境作为范围边界单列。

文件扫描、测试标题、没有删除文件、Git 可达和测试总数只能提供部分证据。完成上述审查也不等于数学证明所有业务状态等价；报告必须区分静态判断、真实模块加 Mock、真实本地持久化及浏览器证据。

## 5. 怎样减少现有升级成本：P3

P3 的范围是整个 fork 的长期二开职责与全部差异。先确认保留的行为，再集中二开决策、恢复可撤回的偏离，并为剩余最小接入保留依据。不能只处理某一轮冲突，也不能完成几个 helper 就将阶段收口。全量范围、四组职责、跨组契约、实施批次与验收见 [P3 全量收敛设计](upstream-preservation-p3-global-design-20261109.md)。

### 5.1 本轮全量起点

固定源码 S 为 `db3ea57b5f419f69c51369c28819de17515b21f5`，相对已合入基线 B 的净差异为 1,219 个路径：653 修改、566 新增；其中既有 src 修改 606 个。P2 的 1,128 个路径全部仍在，之后另有 91 个路径进入范围，旧范围内 27 个路径再次变化。完整指纹、P2 关联和复核方法见 [全量范围证据](preservation/20261109-p3-global-design/README.md)。

清单包含新增模块、既有核心、测试、文档和工程兼容；路径枚举不等于语义审查完成。P2 的旧 reviewed/tested 结论作为来源，不直接批准当前 P3 处置。此后改动按批追加，不静默移动固定起点。

### 5.2 按职责确定目标边界

- 展示与语言：资源、locale、SSR、格式化和错误展示各归其层；组件只保留必要文案接入。不能通过 DOM 替换或复制上游页面消除可见 diff。
- 模型配置与渠道：默认模型、管理员配置、凭证决策、协议、规格与报价归所属领域；各入口消费同一决策结果，保留原提供商语义。
- 生成与工作流：请求端形成不可变快照；原工作流继续拥有调度、claim、预占、扣费、存储及失败释放。传播重复与生命周期职责分别判断。
- 认证与公共入口：组织、session、角色、Assistant、API/MCP 和本地运行边界保留上游机制，只接入实际需要的语言、模型或兼容策略。

优先使用现有模块和接口。独立策略、薄桥接和必要局部修改分别记录；不建设万能 context、通用插件框架或一套平行上游实现。一次只拆一个职责，结构整理保持外部行为。

### 5.3 完成判据

1. 全部差异块及新增模块都有职责、需求来源和当前处置；同一文件的不同职责分别核对，不按目录批量批准。
2. 可撤回的偏离已恢复上游，可集中决策只有一个实际来源；必要接入列出位置、原因、契约及后续升级关注点。
3. 每批提供真实 before/after：删除了哪些重复决策或恢复了哪些差异，剩下哪些必要调用；不能只以文件移动、helper 数量或文档数量证明收益。
4. 上游原断言保留或有可追踪的等效迁移，受影响入口与完整生命周期有本轮验证；未验证与用户暂缓项单列。
5. 全量台账不存在未经解释的待处置项，所有职责及跨职责依赖关闭，才可宣布 P3 完成。单次 merge-tree 冲突数量只是辅助证据，不作为范围或完成判据。

### 5.4 既有四批成果的实际边界

[任务上下文结果](upstream-preservation-p3-context-20261109.md) 保留两个原薄调用并增加契约回归；[渠道路由结果](upstream-preservation-p3-routing-20261109.md) 集中 API 分类；[单镜头生成准备结果](upstream-preservation-p3-generation-20261109.md) 复用一次已解析配置与报价；[翻译维护结果](upstream-preservation-p3-localization-20261109.md) 提供只读差异报告。这些成果继续保留，但没有证明全部结构已收敛。

此前四批前后，既有修改路径均为 653、既有 src 修改均为 606，恢复到上游的路径为 0；同一待合入上游样本前后均有 18 个冲突文件。[已归档对照](preservation/20261109-p3-global-design/prior-pilot-comparison.json) 用于纠正先前收益口径，不将这 18 个文件当成治理范围。

### 5.5 全量设计后的实际实施（2026-11-09—2026-11-13）

`G09-reference-projection` 已完成：before 为 `b85e8c2728259b7902dad6e1cc9aa3757dfb3b6e`，代码提交为 `456046a25269371dd42729f0a2f9343e07942c4d`。[批次记录](preservation/20261109-p3-g09-reference-projection/README.md) 列出全部入口、删除的重复决策、必要桥接、原断言去向和本轮验证；机器证据见 [implementation.json](preservation/20261109-p3-g09-reference-projection/implementation.json)，后续实际进展追加到 [实施台账](preservation/p3-implementation-log.jsonl)。冻结设计的 planned 字段保留其原始时间含义，当前实施状态查追加台账。

本批统一 cast sheet 真实 DTO 的模型、比例和引用数投影，供两处直接生成入口和计划报价共同消费。16 文件、258 项通过；最后测试类型修正后受影响的 20 项复跑通过；typecheck、lint、dead-code、构建和正常提交钩子通过。本批格式检查通过，全仓 format:check 的 2,215 个范围外格式问题单列。源码、单元与构建证据不代替真实供应商、Workflows 引擎重放、远程数据库或浏览器端到端验收。

2026-11-10 完成 `G07-partition`：before 为 `4b6788db7da445abfca26d413ddec47a36be4e0b`，代码提交为 `ecd0a77f787f4d0b38ab3d25da85a7ea86173882`。[批次记录](preservation/20261110-p3-g07-partition/README.md) 和 [机器证据](preservation/20261110-p3-g07-partition/implementation.json) 固定本批范围。Continue/fresh 的图片小计选择与四类 counts 排除从两处收敛到既有 billing 模块一处，原配置快照、生成和资金控制流保持。原 6 文件的 159 处 matcher 断言全部保留；最终集成 12 文件、135 项通过，typecheck、lint、dead-code、构建及正常提交钩子通过。本批 7 文件格式通过，全仓格式没有在本轮重跑。新增测试的类型、金额预期和网络 spy 作用域问题及修复后的复跑关系写入记录。

同日完成 `G07-callers` 的 18 项入口矩阵复核与本轮补测，状态为 `reviewed-with-open-risks`，尚不标全面验收完成。before 为 `02b57a441646d2c165251c1d602fd129967aa2f6`，测试及功能文档提交为 `f23d1b320c7d32def4d0fb21bcfb4278dd9e08e6`。相关生产源码没有改动；原 66 处 matcher 断言全部保留并增加 3 处，跨入口 18 文件、249 项通过，正常提交钩子通过。[批次记录](preservation/20261110-p3-g07-callers/README.md)、[入口矩阵](preservation/20261110-p3-g07-callers/caller-matrix.json) 逐行标明真实内存 D1、mock、helper 与源码证据。三类原上游继承风险——音乐 claim 异常的新 hold 清理、motion 时长估价、引用路由估价——有 B/当前 AST 对照，仍未修复，详见 [开放风险](preservation/20261110-p3-g07-callers/inherited-risks.json)。

同日完成 `MC-B01`：before 为 `9ee843cbb5128704c577c3e4690640aeb3ca3f31`，代码提交为 `d5dfe869d15942567495253348ea0aa61e480d13`。配置图片报价与公开费用提示的两份完整能力谓词收敛到 models 纯函数，保留两个包装的原消息、错误优先级及 undefined 参考数待加载。原两个测试文件和 65 处 matcher AST 完全保留；15 文件、200 项通过，类型检查、lint、构建及正常提交钩子通过。[批次记录](preservation/20261110-p3-mc-b01/README.md) 与 [机器证据](preservation/20261110-p3-mc-b01/implementation.json) 记录实际收益及边界。本批增加两个 MC-09 源码/测试路径，不据此宣称减少既有上游核心修改路径或未来冲突数。

同日完成 `MC-B02`：before 为 `ef6563cb75180bfc18982ef282ac3f38bdb59734`，代码提交为 `c4c584a7fa9ded32aa2393e78857baea4851827c`。configuredTextCostUsd 及每百万 token 常量原样迁入 billing；函数 AST、适配模块其余声明和 llm-client 非 import AST 完全保留。原 6 文件的 328 处 matcher AST 保留，改前/改后各 7 文件、186 项通过，类型检查、lint、构建及正常提交钩子通过。[批次记录](preservation/20261110-p3-mc-b02/README.md) 与 [机器证据](preservation/20261110-p3-mc-b02/implementation.json) 分开标明 pure、mock SDK、mock workflow 和 assistant 接线的验证。MC-06 新增两条源码/测试路径；本批是职责移动，原有单一算式仍是一份，不宣称减少重复公式或未来冲突数。

同日完成 `MC-B03`：before 为 `a5c8e6261e4d5564f57a7c500ff96aacbec970c0`，代码提交为 `95863667e4b58ac43718bd7a15f244787e97094b`。imageUnitPriceFitsWallet 归入 billing 纯策略，保存与报价直接共用 money 的精确往返换算；价卡匹配、最高售价、历史读取与 supplierCost 约束保持。原三个测试的 103 处 matcher AST 保留；进一步与 before 对照，已选 15 个原测试文件和 664 处 matcher AST 均未改。新增 33 项边界先在旧实现通过，改前 4 文件、93 项，改后扩展至 16 文件、288 项通过，类型检查、lint、构建及正常提交钩子通过。[批次记录](preservation/20261110-p3-mc-b03/README.md) 与 [机器证据](preservation/20261110-p3-mc-b03/implementation.json) 区分真实 schema／内存 D1、mock supplier／workflow 和 React 静态渲染。新增两条 MC-10 源码／测试路径；原单一谓词仍为一份，不宣称减少未来冲突数。

同日推进 `G01-verify`：before 为 `4a6df66fb27f0bbf39a31ce1a22ea7108e7b2585`，测试及功能文档提交为 `822f098cafc426eebd23463e7f1379912c400e7b`，状态保持 `reviewed-with-open-risks`。生产源码未改，新增 middleware／上传入口测试及 MCP 语言、可信身份与共享音频服务回归，18 类入口按证据边界登记。最终互不重叠的 21 文件、477 项通过，其中新增 134 项；19 个原测试文件的 964 处 matcher AST 全部保留，类型检查、lint 及正常提交钩子通过。本批未重跑生产构建，沿用 MC-B03 相同生产源码的构建证据。[批次记录](preservation/20261110-p3-g01/README.md)、[入口矩阵](preservation/20261110-p3-g01/caller-matrix.json) 与 [机器证据](preservation/20261110-p3-g01/implementation.json) 区分真实回调、真实内存实现和 mock。七个具名声明的上游 AST 对照不外推为完整语义批准；完整 HTTP 认证、真实 membership／compliance 与共享服务的组合，以及 REST create／enhance 和全部 UI HTTP 入口仍待验证。用户本轮取消尺寸、复杂度、嵌套及强制常量／枚举规则，归档指标仅描述事实，不作为硬门槛或整改债务。

2026-11-12 完成 `G01-composition`，补齐 `G01-verify` 的两条有限技术契约验证。before 为 `2d98cc8274691fd371c4edcfa19a76ddd6a744c2`，测试及功能文档提交为 `99c6838b73bc782d7f5ce97208d47f7d2aab8e38`。MCP 和 REST create 组合真实生产认证配置、内存 D1 成员／compliance、共享创建服务与 workflow admission，最终在无工作量的 binding.create 替身核对可信身份、原文和外部 en；REST enhance 以真实英文指令／SSE 与替身认证、LLM 单独验证，未拼称完整增强 HTTP。网页源码清单从六文件补到 19 文件、51 个 server function，五种身份／权限形态经真实 session、Start middleware、validator 和 handler 动态验证，末端共享服务为替身。最终互不重叠的 28 文件、686 项通过，其中新增 155 项；25 个原测试归一化源码完全保留，上轮 19 文件的 964 处原 matcher AST 仍保留。类型检查、lint 与正常提交钩子通过，生产源码未改，未重跑构建，不宣称减少未来冲突。[批次记录](preservation/20261112-p3-g01-composition/README.md)、[入口矩阵](preservation/20261112-p3-g01-composition/caller-matrix.json)、[完整网页清单](preservation/20261112-p3-g01-composition/web-callers.json) 与 [机器证据](preservation/20261112-p3-g01-composition/implementation.json) 明列 Node 调度／编译适配、未执行浏览器／Workerd HTTP、OAuth 授权码与真实供应商等边界。G01 有限验证批次完成，GC-01 逐文件处置未批量关闭。

2026-11-12 完成 `G02-verify` 的有限任务配置快照验证。before 为 `ce67452ad64c02bda60b6ff867bae238096eaefb`，代码与功能文档提交为 `98346494abc05e7a268e2e2bbbb6f4807d96a3da`。真实 root/D1/加密凭证/JSON wire/workflow base 组合与 codec 边界测试验证排队后仍用旧配置；调用者审查覆盖 32 个 root/共享服务派发点、29 个具名函数及 27 个准备/loader 符号的 72 条直接调用边。发现并修复两处断链：旧 wire 缺图片路由时 fresh-plan 回读当前配置，以及 smart retry 的 motion/music/music-prompt 分支丢失可信外层配置。两项分别有改前 2/5、5/15 失败及修复后通过证据，未把合成报价或参数传播解释成实际钱包错账。最终 36 文件、640 项通过，其中新增 4 文件、42 项；32 个原测试源码保持。类型检查、lint、生产修复后的新构建和正常提交钩子通过，lint 146 条范围外警告单列。[批次记录](preservation/20261112-p3-g02/README.md)、[调用者矩阵](preservation/20261112-p3-g02/caller-matrix.json) 与 [机器证据](preservation/20261112-p3-g02/implementation.json) 区分原始 sourceBefore 发现与 sourceAfter 修复；52 个审查来源仅上述两处改变。绑定/step runner/外部调用替身、未建立全局原子配置版本及完整 HTTP/Workerd/持久重放未验收均保留边界。G02 有限验证批次完成，GC-02、MC-13 与原 inventory 不批量关闭，也不宣称减少未来冲突。

2026-11-12 启动、2026-11-13 收尾 `G03-verify`，状态为 `reviewed-with-open-risks`。before 为 `00cc4625c3823affa92186fbe98b66850e6e755a`，代码及功能文档提交为 `0dd178b3e00c2dc3e8a3a5b0ae711113ae37bf14`。静态解析 1,461 个生产 TS/TSX 文件，核对 16 个父工作流的 35 条领域派发边，修复 character/location sheet 经同一 portrait helper 漏传父配置的两条断链；上传请求独立捕获配置、原 step/去重/保存后派发与独立资金 ownership 保持。新增四文件、31 项在最终整合中全通过；最终互不重复的 33 文件、489 项为 488 通过、1 项原 claim surface 冷导入超过 20 秒。单文件 forks/threads 及 sourceBefore 隔离源码均复现该超时，原断言、限制与测试配置未改，不能宣称整套回归全绿。29 个原测试源码保留；await-child 的 11 个具名函数对照 B，仅归一化新增配置属性后相同；三处修复去掉新增接入后整文件 AST 保持。类型检查、lint、新构建及正常提交钩子通过，146 条范围外 lint 警告单列。[批次记录](preservation/20261112-p3-g03/README.md)、[调用矩阵](preservation/20261112-p3-g03/caller-matrix.json) 与 [机器证据](preservation/20261112-p3-g03/implementation.json) 保留起点发现、修复后状态及替身边界。有限传播契约已有证据，全部父任务分支/生命周期、真实持久引擎与供应商未验收；GC-03、MC-13 及原 inventory 不批量关闭。

2026-11-13 执行 `G09-ownership-verify`，状态为 `reviewed-with-open-risks`，验收未完成。before 为 `315081f74472c72ad02e9523d86019193327e68f`，测试提交为 `4dcb039ec534dfbf3cdc2dc8623a7bb893d16b2a`。静态核对 12 文件、94 个 cast 与共享上传 server function 的声明和服务调用链；新增两个常规回归文件、14 项全通过。整合运行 36 文件、515 项为 510 通过、5 失败；失败均为地点新探针。最终去重范围为 37 文件、517 项，512 通过、5 失败，不能宣称整批全绿。地点 9 项探针以原始源码逐字节归档，显式 runner 复跑仍为 4 通过、5 失败；未改成 skip/xfail，也未修改根测试配置。发现三项地点 scoped-db 归属缺口、两项中文 tag/正文 fallback 缺口及一项草稿元素付费视觉描述缺 gate；前五项实现/片段与 B 同源但未在 B 独立跑 D1，草稿 handler 则在 B/current 上各两例隔离复现。34 个原测试、44 个审查生产来源保留，全仓 lint、类型及正常测试提交钩子通过；仅测试/文档变化，未重跑 build。按 GC-09 冻结“需改hash/schema/guard/ownership则停止”的边界，本批不修改生产保护或匹配规则。[批次记录](preservation/20261113-p3-g09/README.md)、[调用矩阵](preservation/20261113-p3-g09/caller-matrix.json)及[机器证据](preservation/20261113-p3-g09/implementation.json)保留六项风险、红灯断言和替身边界。

2026-11-13 用户随后明确授权修复上述六项，并为此调整原 GC-09 停止边界，执行 G09-ownership-repair。before 为 637a7521ff56618af342046084078ff2a7d6f91c，代码提交为 9c51bfb82a201120ea404f9065ddd4af3ad9001e。地点归属保护在原 owner 修复，草稿 handler 复用现有归属/权利 gate，中文 canonical/正文 fallback 保留 stored tag 和英文优先规则。一次整合 48 文件、857 项全过、零跳过，原地点 9 项逐字节恢复并全过；原 34 测试的 494 项及历史证据保留。新 build、全仓类型/lint、格式和正常 hooks 通过，146 条既有 lint 消息无新增。修正中文引用集合可能改变派生 hash、使旧产物读作 stale，不迁移或改写已存 tag/hash。五个最小接入点、原红灯及证据见[本批记录](preservation/20261113-p3-g09-repair/README.md)和[实现记录](preservation/20261113-p3-g09-repair/implementation.json)。这完成六项有限本地修复，不关闭 GC-09 整体验收。

2026-11-13 继续 `G10-attempt-verify` 与 `G14-image-prepare`，起点为 `58c9a69b6f4bc3f453d66bdbe610f052b5838ebd`，准备职责提交为 `7aab7bb9052554512b62c6c178579ca34ef8921e`，来源修复提交为 `1d2cf3d44aed64d29ab7778d9fd1247df363c9ce`。Studio 的配置、原报价、有效参数与渠道标签收敛到单一准备结果，原权利、逐项预占、建记录及派发骨架保持；迁出准备内容以外的 14 个具名函数/创建剩余 AST 对照一致。静态追踪 G10 的 6 个桥接、9 个父工作流，新增 attempt 跨层契约；同时发现并在原角色、地点和元素 sheet owner 修复固定 fal 来源标签，三处仅改用结果的 generation.via。来源 9 项改前为 3 通过、6 失败，改后全过；最终相同 Studio 测试体对旧/新入口各 19 项全过。最终去重 52 文件、714 项全过、零跳过，类型/lint、新构建及两次正常代码提交钩子通过，146 条既有 lint 消息无新增。原 793 测试、冻结 25 文件及旧台账前缀保留；原始开放发现不倒写，后续修复证据另存。[本批记录](preservation/20261113-p3-g10-g14/README.md)、[实现记录](preservation/20261113-p3-g10-g14/implementation.json)区分本地 D1/父工作流及外部替身、真实引擎和供应商待验边界。

2026-11-13 继续 `G14-asset-verify`，起点为 `ffcaf1225a7dee1329721a1941a13fe2083b5fce`，代码提交为 `6b4799aeade34a8d2de2847b1762ff37252b206a`。核对目录资产、Studio actions/upload/draft 及实际注册 MCP/assistant 的可信身份、语言、终态、实际渠道、输出、usage 与 provenance，修复两处来源 key 缺桶前缀、草稿生成禁令漏检、区域回退实际付款方及平台回退前余额预检四类缺口。五个原生产路径作最小接入，新增七个测试文件 321 项及共享夹具；原 797 份 TypeScript 测试逐字节保留。最终按文件取最后结果去重为 54 文件、1,323 项全过、零跳过；初次整合 5 项失败、其后复跑及一次新夹具 hook 超时均如实保留，原 media-upload 5 秒组合超时和新夹具 10 秒初始化时序风险仍开放，未放宽断言、timeout 或根配置。类型/lint、最终生产构建及正常代码提交 hooks 通过，146 条既有 lint 消息无新增。冻结 25 文件、1,219 pending 及旧归档保留，台账仅追加第 14 行。[本批记录](preservation/20261113-p3-g14-assets/README.md)、[实现记录](preservation/20261113-p3-g14-assets/implementation.json)、[验证记录](preservation/20261113-p3-g14-assets/verification-results.json)区分本地 D1/真实适配与供应商、存储、工作流替身；历史来源不回填，真实引擎、供应商与结算未验收。

2026-11-13 执行 `G06-capture`，起点为 `9d14dd318035a0b62b3675673a0675a623835c89`，代码提交为 `657dc9fe1662f99de1caf2f1cf81dc342f57e767`。在网页可信 validator、API 原配置读取点及共享 create core 之间传递同次完整运行配置，保留公开 schema、认证/组织/语言、权利/增强/inline/失败清理时序及 core 原 loader 回退。固定 37 文件、841 项回归全过；类型、lint、生产 build 和正常提交 hooks 通过。全仓 2,763 suites/10,192 项有 3 项在未修改的 ElevenLabs/agent discovery 测试失败，已单独复现并保留为范围外风险。[本批记录](preservation/20261113-p3-g06-capture/README.md)、[实现记录](preservation/20261113-p3-g06-capture/implementation.json)、[调用矩阵](preservation/20261113-p3-g06-capture/caller-matrix.json)和[验证记录](preservation/20261113-p3-g06-capture/verification-results.json)区分真实本地 D1/服务编排与外部替身，未关闭 GC-06 整职责。

2026-11-13 继续执行 `G06-auxiliary`，起点为 `6ab8599f9`，代码提交为 `eab55944f`。将已捕获的 ModelRuntimeConfiguration 从 createSequences 传入草稿元素挂载和复制元素根，使 pending element-vision 使用同次配置；独立 upload-check 仍由 workflow client 自己捕获，element-sheet child 已有父快照因此保持不变。保留权利检查、元素创建、失败清理、storyboard 前顺序、locale 和 ownsReservation 边界。固定 12 个受影响测试文件、98 项全通过；类型、lint、生产 build、格式和正常提交 hooks 通过。本批仅关闭有限辅助传播证据，不关闭 GC-06；未运行真实供应商、远程 D1/R2 或 durable replay。[本批记录](preservation/20261113-p3-g06-auxiliary/README.md)、[实现记录](preservation/20261113-p3-g06-auxiliary/implementation.json)、[调用矩阵](preservation/20261113-p3-g06-auxiliary/caller-matrix.json)和[验证记录](preservation/20261113-p3-g06-auxiliary/verification-results.json)区分已修改入口与复核后保留的根任务。

2026-11-13 完成 `G06-request-edges`：代码提交为 `57824149d`，在 API 一次性创建请求中让脚本增强和延后地点设定图复用同一 `ModelRuntimeConfiguration`；独立增强/地点入口继续保留自身一次捕获，create core、元素 vision、upload-check、element-sheet 与 full retry/regenerate 沿用既有边界。最终 48 个固定测试文件、930 项通过，typecheck、lint、生产 build、格式检查、diff 检查和正常 pre-commit hooks 通过；完整真实 Workerd/供应商/远程存储/结算未验收。[批次记录](preservation/20261113-p3-g06-request-edges/README.md)、[调用矩阵](preservation/20261113-p3-g06-request-edges/caller-matrix.json) 和[验证记录](preservation/20261113-p3-g06-request-edges/verification-results.json)固定本批范围。

2026-11-13 继续执行 `G07-music-hold`：代码提交为 `ab6d584f4`。修复 smart retry 与 add-audio 在余额预占完成后、`claimMusic` 抛错或返回空值时未进入清理保护的窗口；成功 claim、workflow dispatch、claim failure 状态及并发空 claim 的原有 ownership 保持。2 个测试文件、16 项定向回归全过；typecheck、lint、生产 build、格式、diff 检查和正常 pre-commit hooks 通过。G07 的 motion 时长估价与引用路由估价风险仍开放，本批不关闭 GC-07 整体。[批次记录](preservation/20261113-p3-g07-music-hold/README.md)、[实现记录](preservation/20261113-p3-g07-music-hold/implementation.json)和[验证记录](preservation/20261113-p3-g07-music-hold/verification-results.json)记录本批边界。

2026-11-13 继续执行 `G03-motion-music`：测试提交为 `03b6f1ad5`。补充 `MotionMusicPromptsWorkflow` 父主体的真实 `runImpl` 组合证据，核对父模型快照、请求上下文、稳定 child id、music prompt child payload 及结果合并；生产代码未改。1 个测试文件、1 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；没有重复生产 build。G03 其余父主体动态覆盖、lip-sync 分支、原 claim-discipline cold-import timeout 和真实 durable replay 仍开放，本批不关闭 GC-03。[批次记录](preservation/20261113-p3-g03-motion-music/README.md)、[实现记录](preservation/20261113-p3-g03-motion-music/implementation.json)和[验证记录](preservation/20261113-p3-g03-motion-music/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-claim-harness`：代码提交为 `2da80dae4`。将 claim-discipline 测试的 `#db-client` mock 与 ScopedDb 冷导入移出 20 秒测试体，保留原有五项断言和 timeout；单文件 5 项通过，typecheck、lint、格式、diff、生产 build 和正常 pre-commit hooks 通过。该批关闭 G03-TEST-TIMEOUT，但不关闭 GC-03；其余父 workflow 动态覆盖、lip-sync child 分支和真实 durable replay 仍开放。[批次记录](preservation/20261114-p3-g03-claim-harness/README.md)、[实现记录](preservation/20261114-p3-g03-claim-harness/implementation.json)和[验证记录](preservation/20261114-p3-g03-claim-harness/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G07-duration`：代码提交为 `7e92f76e2`。新增统一 motion hold 时长规则，使 smart retry 与 add-video-model 按 shot.durationMs 经模型 duration grid snap、并叠加 Seedance edit 下限进行预估；保留原 payload 时长形状，避免改变 batch packing。3 个测试文件、38 项通过，typecheck、lint、生产 build、格式、diff 和正常 pre-commit hooks 通过。该批关闭当前 motion 时长估价缺口，但 G07 引用路由估价风险仍开放，不关闭 GC-07。[批次记录](preservation/20261114-p3-g07-duration/README.md)、[实现记录](preservation/20261114-p3-g07-duration/implementation.json)和[验证记录](preservation/20261114-p3-g07-duration/verification-results.json)记录本批边界。
2026-11-14 继续执行 `G07-reference-route`：代码提交为 `9ce107f28`。新增与提交侧共用的 per-shot bindable-reference 投影，使 smart retry 与 add-video-model 按实际可上 wire 的引用判断 fal reference-to-video 价卡；覆盖普通角色引用、reference-only 地点-only 引用和 endpoint 不可绑定媒体。3 个测试文件、45 项通过，typecheck、lint、生产 build、格式、diff 检查和正常 pre-commit hooks 通过。该批关闭当前 fal 预占入口的引用路由估价缺口，但 native via、真实供应商账单和 GC-07 整体仍未验收。[批次记录](preservation/20261114-p3-g07-reference-route/README.md)、[实现记录](preservation/20261114-p3-g07-reference-route/implementation.json)和[验证记录](preservation/20261114-p3-g07-reference-route/verification-results.json)记录本批边界。
2026-11-14 继续执行 `G03-parent-bodies`：测试提交为 `de3897271`。新增 `MotionBatchWorkflow` 与 `RecastLocationWorkflow` 的真实 `runImpl` 组合探针，核对父 ModelRuntimeConfiguration、稳定 child id、motion/music 与 regenerate-shots payload、snapshot hash 和 reservation 收尾。2 个测试文件、2 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭两个父主体的有限动态证据，不关闭 GC-03；ReplaceElementWorkflow、ShotSpecRewriteWorkflow、Motion lip-sync child、其余生命周期和真实 durable replay 仍开放。[批次记录](preservation/20261114-p3-g03-parent-bodies/README.md)、[实现记录](preservation/20261114-p3-g03-parent-bodies/implementation.json)和[验证记录](preservation/20261114-p3-g03-parent-bodies/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-parent-bodies-2`：测试提交为 `cec298dc1`。新增 `ReplaceElementWorkflow` 与 `ShotSpecRewriteWorkflow` 的真实 `runImpl` 组合探针，核对 vision 后图片 child 的父模型快照、locale、claim、稳定 child id、引用集合，以及 spec rewrite 的 LLM 快照、claim promote、input hash 和派生 prompts 重建。4 个测试文件、4 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭两个父主体的有限动态证据，不关闭 GC-03；MotionWorkflow lip-sync child、其余生命周期和真实 durable replay 仍开放。[批次记录](preservation/20261114-p3-g03-parent-bodies-2/README.md)、[实现记录](preservation/20261114-p3-g03-parent-bodies-2/implementation.json)和[验证记录](preservation/20261114-p3-g03-parent-bodies-2/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-lipsync-child`：测试提交为 `18d3b742c`。新增 MotionWorkflow 成片后的 lip-sync child dispatch 组合探针，以 Grok 加一条已匹配对话音频走过 planMotionLipsync、primary finalize 和子派发，核对父模型快照、稳定 child id、live scene id、成片/音频 URL、manifest audio provenance、标题、reservation 和 spawn/await 参数。1 个测试文件、42 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 lip-sync child dispatch 的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支和真实 durable replay 仍开放。[批次记录](preservation/20261114-p3-g03-lipsync-child/README.md)、[实现记录](preservation/20261114-p3-g03-lipsync-child/implementation.json)和[验证记录](preservation/20261114-p3-g03-lipsync-child/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-lipsync-failures`：测试提交为 `a1171c1e8`。新增 MotionWorkflow 成片后的两条 lip-sync 失败归属组合探针：子任务已记录自身失败时父任务不重复追加失败版本，子任务未启动时父任务追加失败版本并广播失败事件。1 个测试文件、44 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 lip-sync child failure ownership 的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支和真实 durable replay 仍开放。[批次记录](preservation/20261114-p3-g03-lipsync-failures/README.md)、[实现记录](preservation/20261114-p3-g03-lipsync-failures/implementation.json)和[验证记录](preservation/20261114-p3-g03-lipsync-failures/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-recast-failures`：测试提交为 `e7877b46f`。新增 RegenerateShotsWorkflow 两条失败生命周期组合探针：图片 child await 失败按 allSettled 收敛到 failedShots 并发送 complete，variant-image 派发失败向上抛出并由父级 onFailure 发送 failed recast 事件；原 resolution 转发断言保留。1 个测试文件、3 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 RegenerateShotsWorkflow 失败生命周期的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支和真实 durable replay 仍开放。[批次记录](preservation/20261114-p3-g03-recast-failures/README.md)、[实现记录](preservation/20261114-p3-g03-recast-failures/implementation.json)和[验证记录](preservation/20261114-p3-g03-recast-failures/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-shot-images-failure`：测试提交为 `75afef60f`。新增 ShotImagesWorkflow primary image child 连续失败探针，核对 lone-primary retry 一次后仍失败时返回 imageUrls=[null]、frameVersionIds=[null]；原有直接 variant root 的双语言快照和成功路径保留。1 个测试文件、7 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 ShotImagesWorkflow primary 失败收敛的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支和真实 durable replay 仍开放。[批次记录](preservation/20261114-p3-g03-shot-images-failure/README.md)、[实现记录](preservation/20261114-p3-g03-shot-images-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-shot-images-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-location-sheet-failure`：测试提交为 `ddfe55136`。新增 LocationSheetWorkflow 失败归属探针，核对当前 claim 按自身版本清理并广播 failed、无 `referenceVersionId` 的历史任务按 null 清理并使用 location 自有频道，以及 realtime 广播失败不阻断 claim 清理。1 个测试文件、3 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 LocationSheetWorkflow 失败归属的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-location-sheet-failure/README.md)、[实现记录](preservation/20261114-p3-g03-location-sheet-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-location-sheet-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-recast-parent-failure`：测试提交为 `41e0c49fe`。新增 RecastLocationWorkflow 父级失败探针，先让 regenerate-shots child 拒绝并核对原始错误向上传播，再执行父级 onFailure 验证 `generation.recast-location:failed` 的 sequence channel、location id 和错误文本。1 个测试文件、2 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 RecastLocationWorkflow 父级 child 失败通知的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-recast-parent-failure/README.md)、[实现记录](preservation/20261114-p3-g03-recast-parent-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-recast-parent-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-motion-batch-failure`：测试提交为 `c270e9ab0`。新增 MotionBatchWorkflow 父级失败探针，核对 reservation 释放、`generation.failed` 通知，以及 reservation 清理抛错时仍继续发送失败事件。1 个测试文件、3 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 MotionBatchWorkflow 父级 reservation/failed-event 收敛的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-motion-batch-failure/README.md)、[实现记录](preservation/20261114-p3-g03-motion-batch-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-motion-batch-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-shot-rewrite-failure`：测试提交为 `579a6b83e`。新增 ShotSpecRewriteWorkflow 失败探针，核对 spec claim、visual/motion prompt claim、依赖 variant 的清理，以及开启 streaming 时两类 `shotPrompt.failed` 事件。1 个测试文件、2 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 ShotSpecRewriteWorkflow 失败 claim/事件收敛的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-shot-rewrite-failure/README.md)、[实现记录](preservation/20261114-p3-g03-shot-rewrite-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-shot-rewrite-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-replace-element-failure`：测试提交为 `bdca367c7`。新增 ReplaceElementWorkflow 失败探针，核对 vision 分析中状态降级、未被子任务接手的 image claim 清理，以及不同失败阶段的 `generation.replace-element:failed` 事件。1 个测试文件、25 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 ReplaceElementWorkflow vision/image claim 失败收敛和 failed-event 的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-replace-element-failure/README.md)、[实现记录](preservation/20261114-p3-g03-replace-element-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-replace-element-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-motion-dialogue-block`：测试提交为 `056f59f8a`。在 MotionBatchWorkflow 真实 runImpl 中补充对话音频缺失分支，核对阻塞 shot 的 render segment、terminal motion failure、明确校验错误及 motion/music child 不派发。1 个测试文件、4 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 MotionBatchWorkflow 对话音频缺失阻断的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-motion-dialogue-block/README.md)、[实现记录](preservation/20261114-p3-g03-motion-dialogue-block/implementation.json)和[验证记录](preservation/20261114-p3-g03-motion-dialogue-block/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-motion-partial-failure`：测试提交为 `be1e2117b`。在 MotionBatchWorkflow 真实 runImpl 中令 motion child 失败而 sibling music child 继续收敛，核对 allSettled、reservation 清零和 `{ sequenceId }` 结果保持。1 个测试文件、5 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 MotionBatchWorkflow 部分 child 失败仍完成 batch 的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-motion-partial-failure/README.md)、[实现记录](preservation/20261114-p3-g03-motion-partial-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-motion-partial-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-shot-rewrite-cleanup-failure`：测试提交为 `c455a52d2`。新增 ShotSpecRewriteWorkflow 清理异常隔离探针，令 spec claim 清理抛出数据库错误，核对 visual/motion 两类 streaming failed 事件仍然发送。1 个测试文件、3 项通过，typecheck、lint、格式、diff 检查和正常 pre-commit hooks 通过；测试-only 批次未重复生产 build。该批只关闭 ShotSpecRewriteWorkflow 清理异常不阻断 failed streaming 通知的有限动态证据，不关闭 GC-03；其它父工作流生命周期/失败分支、真实 durable replay 和运行环境证据仍开放。[批次记录](preservation/20261114-p3-g03-shot-rewrite-cleanup-failure/README.md)、[实现记录](preservation/20261114-p3-g03-shot-rewrite-cleanup-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-shot-rewrite-cleanup-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-location-bible-failure`：生产修复提交为 `7a1cdf536`。修复 LocationBibleWorkflow 在子工作流未启动、绑定缺失或等待超时仍未进入终态时只清 claim 不发 failed 事件的缺口；沿用 `isChildFailureError` 区分子级已自行失败的路径，避免父级重复广播，并让 realtime 发送异常不覆盖原始错误。1 个定向测试文件、14 项通过；相关 3 个测试文件合计 49 项通过，typecheck、lint、格式、diff、生产 build 和正常 pre-commit hooks 通过。该批关闭 LocationBibleWorkflow 失败事件归属的有限生产缺口，不关闭 GC-03；真实 durable replay、运行环境和其它父工作流生命周期仍开放。[批次记录](preservation/20261114-p3-g03-location-bible-failure/README.md)、[实现记录](preservation/20261114-p3-g03-location-bible-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-location-bible-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-character-bible-failure`：生产修复提交为 `97beb16a8`。修复 CharacterBibleWorkflow 丢弃 sheet claim 的 `held` 状态、子级未启动时不清 claim/不发失败事件，以及 voice child 已由子级失败时父级重复写 husk 的问题；保留 `held: false` 的并发保护并沿用 `isChildFailureError` 区分子级责任。1 个定向测试文件、13 项通过；相关 3 个测试文件合计 55 项通过，typecheck、lint、格式、diff、生产 build 和正常 pre-commit hooks 通过。该批关闭 CharacterBibleWorkflow sheet/voice child 失败归属的有限生产缺口，不关闭 GC-03；真实 durable replay、运行环境和其它父工作流生命周期仍开放。[批次记录](preservation/20261114-p3-g03-character-bible-failure/README.md)、[实现记录](preservation/20261114-p3-g03-character-bible-failure/implementation.json)和[验证记录](preservation/20261114-p3-g03-character-bible-failure/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-cast-failure-cleanup`：生产修复提交为 `92ad7b61b`。隔离 LocationSheetWorkflow、CharacterSheetWorkflow 和 CharacterVoiceWorkflow 的 claim/husk 清理异常与 realtime failed 通知；历史测试只证明清理异常时仍尝试调用 failed 事件的 emit 替身；未证明通知送达或 durable 重试，内部 catch 的重试缺口由后续失败重试契约批次修正。定向 3 个测试文件、27 项通过；相关 6 个测试文件合计 86 项通过，typecheck、lint、格式、diff、生产 build 和正常 pre-commit hooks 通过。该批关闭三个 cast 子工作流 failure hook 清理异常隔离的有限生产缺口，不关闭 GC-03；真实 durable replay、运行环境和其它父工作流生命周期仍开放。[批次记录](preservation/20261114-p3-g03-sheet-failure-cleanup/README.md)、[实现记录](preservation/20261114-p3-g03-sheet-failure-cleanup/implementation.json)和[验证记录](preservation/20261114-p3-g03-sheet-failure-cleanup/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-failure-notification-isolation`：生产修复提交为 `57d075870`。跨 RecastLocationWorkflow、ImageWorkflow、ShotVariantWorkflow 和 UpscaleShotVariantWorkflow 隔离失败状态持久化/清理与用户可见 failed 通知；历史测试只证明失败行写入、自动 promote 清理或旧缩略图读取异常后仍尝试通知；不能证明广播送达，内部 catch 的重试与中断缺口由后续失败重试契约批次修正。定向 4 个测试文件、13 项通过；相关 15 个测试文件合计 121 项通过，typecheck、lint、格式、diff、生产 build 和正常 pre-commit hooks 通过。该批关闭四个生成失败 hook 通知隔离的有限生产缺口，不关闭 GC-03；真实 durable replay、运行环境和其它父工作流生命周期仍开放。[批次记录](preservation/20261114-p3-g03-failure-notification-isolation/README.md)、[实现记录](preservation/20261114-p3-g03-failure-notification-isolation/implementation.json)和[验证记录](preservation/20261114-p3-g03-failure-notification-isolation/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-sequence-failure-notification-isolation`：生产修复提交为 `9ece4798a`。隔离 AnalyzeScriptWorkflow、StoryboardWorkflow 和 MusicWorkflow 的 auth 分类、sequence 状态/当前状态读取、music claim 清理与用户可见失败通知；历史测试证明这些操作失败时仍尝试调用通知替身；completed 不回退只在状态读取成功时得到验证。读取失败后继续写 failed 的缺口、内部 catch 的重试与中断缺口由后续失败重试契约批次修正。定向 3 个测试文件、24 项通过；相关 18 个测试文件合计 145 项通过，typecheck、lint、格式、diff、生产 build 和正常 pre-commit hooks 通过。该批关闭三个 sequence/audio failure hook 通知隔离的有限生产缺口，不关闭 GC-03；真实 durable replay、运行环境和其它父工作流生命周期仍开放。[批次记录](preservation/20261114-p3-g03-sequence-failure-notification-isolation/README.md)、[实现记录](preservation/20261114-p3-g03-sequence-failure-notification-isolation/implementation.json)和[验证记录](preservation/20261114-p3-g03-sequence-failure-notification-isolation/verification-results.json)记录本批边界。

2026-11-14 继续执行 `G03-lipsync-failure-notification-isolation`：生产修复提交为 `7cf5971d6`。隔离 LipsyncWorkflow 的 shot/render segment 读取、pending promote/失败 video variant 清理与 `generation.video:progress` failed 通知，并直接使用 payload 中冻结的 sequenceId；历史测试证明清理失败或 shot lookup 失败后仍尝试调用通知替身，未证明送达；内部 catch 的重试与中断缺口由后续失败重试契约批次修正。定向 1 个测试文件、2 项通过；相关 3 个 motion 测试文件合计 60 项通过，typecheck、lint、格式、diff、生产 build 和正常 pre-commit hooks 通过。该批关闭 LipsyncWorkflow failure hook 通知隔离的有限生产缺口，不关闭 GC-03；真实 durable replay、运行环境和其它父工作流生命周期仍开放。[批次记录](preservation/20261114-p3-g03-lipsync-failure-notification-isolation/README.md)、[实现记录](preservation/20261114-p3-g03-lipsync-failure-notification-isolation/implementation.json)和[验证记录](preservation/20261114-p3-g03-lipsync-failure-notification-isolation/verification-results.json)记录本批边界。

**截至前述历史批次，P3 整体仍进行中。** G10 有限验证、G14 图片准备及资产入口/来源/草稿修复、G06-capture、G06-auxiliary、G07 音乐预占清理与 motion 时长估价修复及 G03 多个父主体、CharacterBible/LocationBible/LocationSheet 失败生命周期及 lip-sync child dispatch 证据已有边界记录，GC-10/GC-14/GC-06/GC-07/GC-03 不作整职责关闭。GC-06 剩余调用与真实环境验收、GC-14 剩余真环境验收、GC-09 其余职责、G03 其它生命周期/失败分支、G07 native via 与真实计费一致性及其它 P3 工作仍待完成；当前 fal 预占入口的引用路由估价已有边界修复，下一步按最新台账选择依赖已满足且仍有明确代码或验证缺口的职责。1,219 项冻结 inventory 全部保持 pending，不作整文件或目录的批量语义批准；CONTINUE-LLM-SOURCE 按用户决定暂缓，P4 未开始。

### 5.6 全量收口（2026-11-15）

用户授权完成剩余工作后，以最终代码 `2827b099b69f32c9e6043a00be2e55f1586078e5` 对K1～K8及原五条退出条件统一签收。60项职责、66个原动作、1,712个当前路径和2条历史退出有版本化处置；初次全量失败、修复及独立复跑分开记录。Worker类型恢复上游，登录标题双桥退出；共享参考图、入口语言及Storybook污染修复已交付。原1,219项冻结快照不改写为当前批准，59条实施日志仅追加收口记录。详见[完成记录](p3-completion-20261115.md)及[最终台账](preservation/20261115-p3-completion/scope.json)。

当前结论限原结构处置和实际本地验证；源码保留、Mock、本地D1、真实本地Workerd/浏览器与未验部署分开，不宣称全部未来环境通过。更广的根取消/通知/portrait生命周期、商业暂缓与P4不再自动滚入GC-03。S→C生产源码仍净增5,413行，没有已证的全局合并冲突降幅，后续同步仍须按实际新差异做三方评估。

## 6. 未来新增二开的接入流程

任何新功能都经过同一流程，不要求预先修改本计划或技能的能力白名单。

1. **澄清差异**：写明上游当前行为、用户实际目标及哪些行为必须改变。已有上游能力先复用，已取消规划不回流。
2. **选择最小边界**：依次评估已有公开配置/接口、领域模块、薄桥接、必要局部修改。SQL、客户端/服务端、domain-blind、ScopedDb 和工作流读写边界继续有效。
3. **说明状态与兼容**：明确数据/任务字段、价格/凭证/语言快照、原生协议、在途任务、失败和回退。确需 schema 变化时另做迁移设计，不手写结构迁移。
4. **先定义守卫**：保留上游断言，给新策略增加反例；有未配置/未启用状态的功能核对原路径，没有关闭状态的需求定义合适的中性对照，不为每个改动强加开关。
5. **小步实施与交付**：结构整理与业务改变分别说明；明确批准路径和验证，保留正常 hooks。完成后登记新增职责、必要接入与升级敏感点。
6. **下一轮重新发现**：根据净差异、调用链、测试和现行需求识别全部二开。登记表帮助定位，不能替代代码调查。

### 已有商业规划如何进入未来流程

以下仍是未实施或待设计的商业规划，不属于本次历史治理和上游合入的顺带任务。

| 规划                     | 建议的接入位置                                                   | 开始实施前必须解决                                                                             | 保留的上游基础                                                                         |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 全面禁止 BYOK            | 统一服务端凭证策略，覆盖 UI、保存接口、API/MCP、触发与工作流解析 | 在途任务切换规则；组织 Key 不能从其他入口绕过平台计费；不能静默换路线或重复生成                | Organization、成员/角色、组织钱包及创作 API/MCP；用户带 Key 的行为改变作为明确业务例外 |
| 人民币销售单价、成本核算 | 独立报价/价卡和成本核算职责，连接现有生成准备、快照和组织计费    | 人民币报价如何衔接微美元钱包、精度/舍入、锁价/汇率版本、部分成功结算及异常恢复；成本保留原币种 | 现有钱包和兑换卡真实币种；不把人民币直接写进美元字段，不恢复个人钱包迁移               |
| 默认私有素材             | 真实资源授权、媒体读取、主动分享/发布边界                        | 网页/API/MCP/R2、供应商取图授权、分享撤销与在途请求行为                                        | 组织协作、主动分享和上游创作媒体流程；不只隐藏页面或一律封禁媒体读取                   |
| 公网部署与服务分工       | 在当前 Workerd/Cloudflare 架构上评估实际运行需求                 | 现有资源、目标规模、区域、成本与外部服务连通性；依据证据决定托管/自建边界                      | 不预设全面自托管、全部托管或重写运行时                                                 |

个人独立人民币钱包、新增卡密商业改造、管理员默认不浏览用户作品均已取消，不再安排。保留上游 Stripe，不新增在线支付渠道；第三方通用模型调用 API 产品不在首期，但不据此删除上游 API/MCP。

通用国际化或上下文接入能力可评估向上游贡献；是否被接受未知，不作为本计划完成的前提。提交提案或 PR 属于独立外部操作，不因本计划自动发送。

## 7. 后续每次同步如何执行：P5—P6

### 分支与版本职责

- 建议 `main` 保持纯上游镜像，`develop` 承载二开；实际 remote 与引用每次核实。本计划不自动调整分支或触发发布。
- 同步在可恢复的集成分支或隔离 checkout 中进行，沿用仓库分支命名与现有 Git 流程，不重写共享 `develop` 历史。
- 发布版本使用已验收的固定提交或版本标记，上游继续更新不自动改变已经验收的发布范围。

### 每批固定流程

1. 刷新上游并固定旧基线 B、本地起点 L0 和目标 U，记录网络失败或引用时效；把之后新增的上游单列。
2. 生成本批上游主线节点、全部历史及三方差异，沿公开接口和数据契约找直接、间接影响。
3. 逐主线节点审查和合入，不重复带入支线提交。当前节点未解决前不开始下一节点。
4. 核对上游条件、错误处理、状态写入和原测试是否被覆盖；逐项执行定向验证及适用正常 hooks。
5. 最终集成状态执行适用全量检查、构建和受影响浏览器场景；有后续代码修改时补验关联范围，不复用旧结果冒充最终验收。
6. 同时核对历史完整性与净行为差异；完成后才更新上游基线和实施记录，列明未验证项、工作区保留及推送状态。

沿用 [sync-upstream](../../.agents/skills/sync-upstream/SKILL.md) 的现有流程。P4 落地后把保真检查补充到技能及项目入口，技能只引用同一套规则，避免维护相互矛盾的流程副本。

### 节奏与紧急路径

建议试行每周两次集成窗口，先记录连续 4 批成本再调整；这属于运行建议，尚未设置定时任务，也不要求每周都合满两次。可以日常查看变动，不必每出现几个提交就启动完整验收。

安全、数据和收费关键修复及时评估；有实际需求的新能力可提前进入独立批次。批次过大时缩小范围，避免长期积压；没有稳定 release 时使用已验收 SHA，不依赖上游必定提供发布标签。

## 8. 验证矩阵和 CI 落地：P4

| 层次       | 要证明什么                                   | 方式与边界                                                                                        |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 历史       | 固定范围的提交完整、顺序正确、没有未完成操作 | Git 可达与 merge 映射；不能证明合并解决正确                                                       |
| 差异       | 本地改变上游的每个业务块有依据               | 净 diff、merge 解决、需求与调用链审查；不能只按路径或新增目录放行                                 |
| 测试保留   | 原保障没有被新测试悄悄替换                   | 扫描原断言、fixture、skip/timeout 变化并人工追踪改名/参数化/迁移；不以测试总数代替                |
| 默认行为   | 二开不参与的关键路径仍按上游行为执行         | 同输入、同 Mock 对照；仅归一化时间/随机 ID 等无关值，不抹掉权限、收费或恢复差异                   |
| 状态与恢复 | 真实持久化和并发契约成立                     | `createTestDb()` 及真实模块配 Mock；覆盖组织隔离、快照、claim、预占、部分成功、未知结果与重复请求 |
| 用户流程   | 实际页面操作贯通后端与持久化                 | Workerd/Miniflare 回放，查 UI、子任务、日志及清理；页面断言通过不代表所有子任务成功               |
| 外部环境   | 真实供应商、邮件或部署行为成立               | 另有授权时验证；本地 Mock、R2 和构建不冒充生产证据                                                |

CI 分三步加入：

1. **报告型检查**：列新增/改名/删除路径、原测试变化、UI/模板变化及未归属候选。先核实误报，启发式结果不直接一律硬失败。
2. **确定性门槛**：已确认的关键回归、原关键断言无说明丢失、历史或 merge 状态错误应阻断本批完成。把 P1 正式回归和各领域稳定契约逐批加入现有检查。
3. **develop 保护**：复用现有质量/单测/E2E 分片。建议常规变更走目标为 develop 的 PR 和明确检查状态；若继续直接 push develop，则补足对应测试触发。实际仓库规则、必需检查与其他工作流副作用在配置前核实，不能把计划写成远端已启用。

每项先跑相关检查，批次最终状态跑适用全量；正常提交 hooks 保持启用。全仓旧警告、CRLF 格式问题与本次新增诊断分开记录，不批量重写无关文件来制造全绿。

每份证据绑定源 SHA、命令与实际选中用例、环境/Mock、首轮和复跑、通过/失败/跳过/todo/flaky、耗时及日志。长回放指定一个资源所有者，使用合成凭证与隔离本地服务；结束后核对数据库清理、配置字节和端口归属，保留失败证据及必要取证。

## 9. 成本、暂停与回退

连续记录评估、冲突解决、兼容修复、定向验证、全量和浏览器各自耗时，以及重复冲突路径、核心接入点、未归属业务差异、原断言丢失数和首次通过率。先形成实际基线，再设置预算或趋势目标；不为了减少表面 diff 删除必要功能或测试。

出现以下情况时，停止扩大当前修改，先定位和补证据：

- 上游原条件、数据写入或关键断言被删除，无法解释其去向。
- 报价、真实凭证、模型/语言快照与执行不一致，或收费/claim/失败释放存在未解释变化。
- 必须复制整套工作流、扩大平台领域例外或绕过 scoped-db 才能完成整理。
- 为通过验证需要放宽原断言、增加无依据超时、静默补缺字段，或真实请求可能逸出 Mock。
- 回退会破坏已提交任务、媒体、交易或未知供应商结果，尚无状态恢复方案。

当前已验证实现先保留。用独立纠正或 revert 提交恢复代码，不 reset 共享分支、不整文件取上游覆盖二开；涉及数据库和在途任务的变化另做恢复设计。撤回代码不等于恢复数据，也不能通过重复付费推理来“恢复”未知任务。

## 10. 最终交付、完成口径与下一批

本计划执行后应留下：一份可追踪的差异清单、已确认偏离的处置记录、恢复/新增的正式契约测试、更新后的最小接入说明、可复现验证证据，以及实际生效的同步/CI 操作入口。优先在已有领域文档和本目录更新，避免每次升级复制一套说明。

完成状态分开报告：

- **历史闭合**：指定目标全部可达，未合入的新提交清楚。
- **范围闭合**：全部候选路径归类，所有非平凡业务差异有处置，merge 解决和间接影响已覆盖。
- **验证闭合**：关键原断言保留或迁移可追踪，关键默认路径和明确二开策略有当前证据，无未关闭严重缺陷；待决策、待修复及本批应验证而未验证的事项不能计为通过。
- **运行闭合**：本轮服务和配置恢复，用户原改动保留，提交/推送/部署状态明确；环境限制单列。

后续新增功能会扩大清单，以上标准持续适用；不要求未来全部能力预先写进本计划。首个实施批次已完成 P0 与 P1：固化范围、恢复上游 8 项执行回归、最小修复地区恢复，并记录当前证据。2026-11-08 的 P2 执行归档了 1,128 个净路径、277 个历史合并路径对、7 个历史独有路径、4 项代码修复及去重 4,588 项测试和桌面/手机浏览器结果。2026-11-09 纠正已发现的记录与证据缺口；当前结论按实际补证及明确暂缓项解释，不据此确认全部非平凡行为已闭合。范围与验证边界见 [P2 实施记录](upstream-preservation-p2-20261108.md) 及其补充记录。P3的历史局部成果保留，2026-11-15原全量结构范围已按[完成记录](p3-completion-20261115.md)收口；实际验证与独立边界分开，P4及后续阶段未执行。商业改造按其独立需求范围推进。

现行需求仍以 [规则确认单](confirmation.md) 为准，既有能力与实施状态见 [二次开发说明](README.md)，接入约束见 [扩展政策](extension-policy.md)。计划状态随实际交付更新，不以计划条目冒充已实现结果。

2026-11-14 继续执行 `G03-failure-retry-contract`：生产修复提交为 `408a8fe85`。纠正近期 failure hook 内部 catch 成功返回导致必要清理跳过 durable 重试的缺口；以共用失败动作函数保留普通错误与 engine abort 传播，保留已核对的历史 best-effort 边界，并让 Bible 父级失败回收进入具名 durable step。Storyboard 当前状态读取失败后不再盲写 failed；Motion 失败持久化与通知及 blocked-dialogue 调用链完成补测。最终集成 29 个测试文件、477 项通过，typecheck、lint、定向格式、diff、client/SSR 构建及正常 pre-commit hooks 通过；首轮三处 TS2322 经局部 const 窄化修正后的复跑关系留档。此前四批的通知送达、重试与 completed 保护表述已按实际证据更正。该批仅关闭选定错误传播分支的有限验证，未关闭 GC-03/P3；voice claim 两次写入窗口、Storyboard 原有读写竞态、其它失败 hook 和真实运行环境仍开放。[批次记录](preservation/20261114-p3-g03-failure-retry-contract/README.md)、[实现记录](preservation/20261114-p3-g03-failure-retry-contract/implementation.json)和[验证记录](preservation/20261114-p3-g03-failure-retry-contract/verification-results.json)记录本批范围。

2026-11-14 继续执行 `G03-voice-claim-recovery`：生产修复提交为 `c06750446`。将 voice version 失败写入和 pending pointer 清理合为既有 D1 batch，支持补清早期部分写入遗留的 failed 指针，同时保留 row/null、原 error、completed 待 promote、用户选择和新 claim 保护，并补足该方法的组织范围守卫。新增 12 项真实 createTestDb/SQLite 故障注入回归；修复前校正夹具后的 5 项行为失败、首轮集成失败及最终相同命令复跑关系留档。最终 21 个测试文件、426 项全部通过，类型、定向 lint、格式、diff、client/SSR 构建和正常 hooks 通过。该批关闭的是选定 DB 操作在 host-side 模拟器中的部分写入窗口；真实 Cloudflare replay/并发、Storyboard 读写竞态、其它生命周期和 GC-03/P3 仍开放，冻结 inventory 未批量批准，P4 未开始。[批次记录](preservation/20261114-p3-g03-voice-claim-recovery/README.md)、[实现记录](preservation/20261114-p3-g03-voice-claim-recovery/implementation.json)和[验证记录](preservation/20261114-p3-g03-voice-claim-recovery/verification-results.json)记录具体边界。

2026-11-14 继续执行 `G03-storyboard-failure-guard`：源码提交为 `4153a336e`。用一次组织范围条件 UPDATE 核对 Storyboard 当前任务归属及非终态，保留子任务具体错误、completed 状态及新 run；启动器把本次原始 claim 可信快照到内部 payload，以覆盖实际 instanceId 生成后尚未回写的窗口，trigger 异常也复用同一守卫。新增 16 项真实 createTestDb/领域 DB 方法组合回归；修复前 9 项中的 6 项行为失败和首次 exact payload 断言失败均留档。最终 26 个文件、384 项通过，类型、定向 lint、格式、diff、client/SSR 构建及正常 hooks 通过。该批仅关闭选定失败状态写入窗口；failed 写入后的通知重试、真实适配器吞错、UPDATE/emit 间新 run、旧事件与 child hook、启动/成功及最后 runId 回写仍开放。5 份冻结 inventory 共 1,219 项仍全部 pending；GC-03/P3 未完成，P4 未开始。[批次记录](preservation/20261114-p3-g03-storyboard-failure-guard/README.md)、[实现记录](preservation/20261114-p3-g03-storyboard-failure-guard/implementation.json)和[验证记录](preservation/20261114-p3-g03-storyboard-failure-guard/verification-results.json)记录具体证据。

2026-11-14 继续执行 `G03-launcher-ownership`：源码提交为 `452a13031`。将启动器 raw claim、processing 和清空旧 error 放入同一次 CAS UPDATE，与既有启动 activity 一同提交/回滚；activity 另补组织范围。最终发布 instanceId 仅在本次 raw claim 仍持有 slot 时更新，CAS 未命中仍返回已创建 ID，真实 SQL 异常继续传播，不重触发或伪造创建失败。新增 21 项真实 DB/launcher/Continue 包装回归；修复前 13 项中的 8 项行为失败留档。最终 29 个文件、446 项通过，类型、定向 lint、格式、diff、client/SSR 构建及正常 hooks 通过。未发布 raw claim 的在途接管仍存在，本批不证明严格互斥或停止旧任务；runImpl 启动/成功、子失败、Continue 设置回滚、独立 Update all 预检、通知/旧事件及创建后 publication SQL 错误的恢复仍开放。冻结 inventory 未批准，GC-03/P3 未完成，P4 未开始。[批次记录](preservation/20261114-p3-g03-launcher-ownership/README.md)、[实现记录](preservation/20261114-p3-g03-launcher-ownership/implementation.json)和[验证记录](preservation/20261114-p3-g03-launcher-ownership/verification-results.json)记录边界。

2026-11-14 完成选定的 `G03-lifecycle-branches` 本地实施批次：before 为 `095d49548ff3e1d56b1b327a8549fd632970eea6`，源码提交为 `9d73a09f94e971426bf523d1fcf08607632067f1`。父任务启动、stopAt/原设置活动与 fresh shots 清理进入同一归属守卫 batch；余额不足改用既有失败 guard；完成/活动与稳定 event ID 回执在同一 batch，支持数据库提交后重跑而不重复活动。AnalyzeScript 从父实例/可信 raw claim 取得根身份，父派发失败不再以子实例或无条件写覆盖 sequence；独立 CLI 旧失败语义保留并单列边界。独立审查发现的 stopAt 活动遗漏已有 3 红/2 绿补证及修复。最终 36 文件、566 项通过，新增 54 项；最后补齐完成活动原文案/target 断言后 30 项复跑通过。类型、11 文件定向 lint/格式、diff、client/SSR 构建及正常 hooks 通过。严格启动互斥、其它内容写入/后代通知、failure/short 发送重试、旧成功 checkpoint/guard 后接管的外部发送、旧事件/reducer、Continue/Update all 设置并发及 publication SQL 异常恢复仍开放。冻结 inventory 仍未批准，GC-03/P3 未完成，P4 未开始。[批次记录](preservation/20261114-p3-g03-lifecycle-branches/README.md)、[实现记录](preservation/20261114-p3-g03-lifecycle-branches/implementation.json)与[验证记录](preservation/20261114-p3-g03-lifecycle-branches/verification-results.json)保留选定范围和真实替身边界。

2026-11-14，GC-03 的 G03-failure-notification-ownership 已完成选定的本地实现与验证：六类 sequence 生命周期信号显式传递根实例/可信 raw claim，保留直接父级协议；前端以当前已查询槽核对归属，跨订阅共享 Continue pending token，并在取消旧读取的屏障后以真实详情读取确认，不将 invalidate resolve 或 create 返回实例当作凭证。历史/实时顺序合并及会话终态回执覆盖换主、迟到历史、冲突终态和 raw→instance 发布；独立 MotionBatch 保留原缓存刷新。独立审查发现的遗漏有 6 项失败补证，retryer/cache 微任务窗口另有单项失败补证，均已修正。最终 38 文件、681 项通过，新增 109 项；32 文件定向 lint/格式、类型、diff、client/SSR 构建和正常 hooks 通过。代码提交 ba86136d8a041e2e01494184f857798788405032。服务端启动互斥、完整内容/素材事件归属、发送重试/邮件一致性、Continue 服务端设置与 publication 异常恢复仍开放；5 份冻结 inventory 的 1,219 项全部保持 pending，GC-03/P3 仍 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-notification-ownership/README.md)、[实现记录](preservation/20261114-p3-g03-notification-ownership/implementation.json)和[验证记录](preservation/20261114-p3-g03-notification-ownership/verification-results.json)保存实际契约及替身边界。

2026-11-14，GC-03 的 G03-startup-exclusion 完成本批本地实施与验证，源码提交 dbfa4a0e49af50bbe4ce8836271130e3fc2dabfc。启动前预分配最终实例 ID，CAS、processing/清错、prepared 原快照和开始活动同一 D1 batch 持久化；原投递和请求/cron 恢复只使用该 ID，不自动生成失败实例的下一代。占槽提交、create 或确认回执未知时保留原 cause 和本次 reservation，避免已接收任务的预占被提前清空；Continue 的本次 pending 分支保留设置。独立投递日志不新增组织/序列 FK，以精确 owner 联表和删除后 orphan 清理保留原组织删除能力；lastAttemptAt 只用于公平轮转，不是超时抢锁。独立审查发现的占槽已提交但回执丢失问题有单项失败补证后修正。最终 57 个文件、1,014 项测试通过，类型、29 文件定向 lint/格式、client/SSR 构建、D1 迁移安全及正常 hooks 通过；只生成迁移，未应用到现有数据库。旧 raw claim 无原请求、根后代取消/内容事件、完整 Continue 设置并发和外部发送一致性仍开放；五份冻结 inventory 的 1,219 项仍全部 pending，GC-03/P3 为 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-startup-exclusion/README.md)、[实现记录](preservation/20261114-p3-g03-startup-exclusion/implementation.json)和[验证记录](preservation/20261114-p3-g03-startup-exclusion/verification-results.json)保留精确范围与替身边界。

2026-11-14，GC-03 的 G03-continue-settings-ownership 完成本批本地实施与验证，源码提交 f72ad944b2e61a80591c2b10019aea3312d391c0。网页和 MCP 将四个 Continue 设置显式传入启动器，先构造本次 payload，再在 expected-slot CAS 的同一 D1 batch 保存设置、最终实例槽、prepared request 和活动；删除占槽前保存及拒绝回滚，修复同值 ABA 和异值快照污染。停止阶段历史保留原文案与 JSON，按同一组织/旧槽条件读取提交时真实旧值，settings event ID 先于 started；三个布尔开关与同值停止阶段不新增设置历史。原版同值 ABA 有单项真实数据库失败补证，新增 15 项回归覆盖双向竞争、三类插入失败、NULL/live from-to、create/ack 与占槽提交回执丢失；最终 58 文件、1,028 项全部通过。源码 11 文件格式、client/SSR 构建及正常 hooks 中边界 17 项、knip、lint、typecheck 通过；没有新增 schema/迁移或通用设置版本协议。后代取消、完整内容/事件归属、外部发送/邮件一致性、独立 Update all 预检、旧 raw claim 和真实环境验收仍开放；另发现 create 接收但未保存 draftMotion，另批核实处理。五份冻结 inventory 的 1,219 项保持 pending，GC-03/P3 仍 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-continue-settings-ownership/README.md)、[实现记录](preservation/20261114-p3-g03-continue-settings-ownership/implementation.json)和[验证记录](preservation/20261114-p3-g03-continue-settings-ownership/verification-results.json)保存精确范围和替身边界。

2026-11-14，GC-03 的 G03-create-draft-motion 修复了共享创建方法接受却未保存 draftMotion 的遗漏，源码提交 6db5aeec698df7982895551fb8942dc6b93cad62。仅补一行既有字段映射，显式 true/false 原样保存，省略仍为 false；没有 schema、迁移或提供方规则变更。修改前数据库与网页创建各有一项失败补证；新增 8 项覆盖保存三态和启动快照真假值，最终 9 文件、151 项通过，正常 hooks 的类型、lint、格式、knip 与边界 17 项通过，独立审查无阻断。网页证据是服务端组合测试，launcher 的数据库及引擎为替身，实际浏览器/Cloudflare/提供方仍待验收。后代取消、完整内容/事件归属、外部通知/邮件一致性、独立 Update all 预检、Standalone AnalyzeScript CLI、旧 raw claim 与实际环境验收继续开放；五份冻结 inventory 的 1,219 项全部保持 pending，GC-03/P3 为 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-create-draft-motion/README.md)、[实现记录](preservation/20261114-p3-g03-create-draft-motion/implementation.json)和[验证记录](preservation/20261114-p3-g03-create-draft-motion/verification-results.json)保存精确范围与证据边界。

2026-11-14，GC-03 的 G03-notification-delivery-contract 完成本批本地实施与验证，源码提交 3a57ea23b0b2187bc9f1b213e9255cb7d769ca68。失败、余额不足和完成的原始 envelope 与状态/完成活动同一 D1 batch 提交，重复 guard 后独立按 receipt 投递，显式传播 realtime HTTP/fetch 失败，并由现有 cron 有界轮转恢复。投递前核对组织、owner/raw claim 与终态，回执仅确认原记录；普通进度仍 best effort，余额不足主错误和 engine abort 保留。原版终态后重试有 1 红/16 绿补证，新增 46 项回归；集成首轮两项分类/夹具问题修正后，最终 29 文件、474 项全部通过，夹具拆分后通知 23 项复跑通过。类型、全仓 lint、28 路径格式、client/SSR 生产构建、迁移安全与正常 hooks 通过；147 条 lint 警告均在本轮范围外。迁移由 Drizzle 生成，仅新增表和索引，未应用到现有数据库。独立只读审查无阻断。投递为至少一次，外部已接受后的回执丢失及并行发送可能重复，发送后换主仍需客户端 guard；旧缓存 checkpoint 不回填，邮件、Standalone CLI、后代取消/完整事件、独立 Update all 与真实 Cloudflare/浏览器/供应商/钱包验收继续开放。五份冻结 inventory 的 1,219 项保持 pending，GC-03/P3 为 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-notification-delivery-contract/README.md)、[实现记录](preservation/20261114-p3-g03-notification-delivery-contract/implementation.json)和[验证记录](preservation/20261114-p3-g03-notification-delivery-contract/verification-results.json)保存首次失败、复跑和精确指纹。

2026-11-14，GC-03 的 G03-artifact-cancellation 完成本批现有素材取消协议修复，源码提交 4c6623759ff57b11cb1d0d4de1427fd256aab990。视觉提示词状态、live 依赖图片取消及 exact frame/version promote 清理同一组织内 D1 batch 提交，单独图片状态与指针清理同批；重复请求可在源返回 false 时修复旧半取消。共同 frame setter/handover 在指针 UPDATE 中排除已取消或缺失目标，防止准备/fallback 迟到回调重新挂回死 claim。迟到依赖图片的 INSERT 按源/目标真实 frame→sequence 同组织关系判断取消，创建 cancelled/non-primary 行并跳过 started 活动，不遮盖新运行。原三类入口、NotFound、motion 单写、返回结构及提交后 best-effort 终止保留。原多写 3 项、迟到创建 1 项和旧指针写入 3 项有真实数据库红测；首版 non-primary 投影及独立审查发现的跨组织 CASE 各有单项失败补证并修正。最终 22 文件、450 项通过，新增 41 项，原有 20 个回归测试文件未改；类型、全仓 lint、10 路径格式、生产 client/SSR 构建和正常 hooks 通过，147 条 lint 警告均在范围外。独立源码复查确认 P2 已解决，无剩余阻断；无新 schema/迁移/绑定/cron。数据提交不保证实际工作流/供应商终止，回执丢失可留未尝试 RPC；整个旧根子树的内容/完整事件归属、邮件、独立 Update all、旧任务与真实环境验收仍开放。五份冻结 inventory 的 1,219 项保持 pending，GC-03/P3 为 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-artifact-cancellation/README.md)、[实现记录](preservation/20261114-p3-g03-artifact-cancellation/implementation.json)和[验证记录](preservation/20261114-p3-g03-artifact-cancellation/verification-results.json)保存精确证据与边界。

2026-11-14，GC-03 的 G03-scene-split-content 完成本批 SceneSplit 后代内容写入归属，源码提交 dfcb4cbb5d84fef104ba4b4331b2b88a95dd1d56。新增窄 storyboardContent 面，标题、场景、镜头/锚帧、split/fallback 脚本及选择、对白 claim/版本、素材首次出现及完成活动的 SQL 同时检查组织、序列、显式根/可信 claim 和 processing；脚本 seed/初始选择同一 D1 batch。方法前后/空输入检查保留，确认换主在步骤内转为不可重试；未知归属具名重试并保留 cause，引擎 abort 原样传播，完成日志不吞归属错误。四个原 DB factory 在保留新预检条件下的写入竞争全部红测；独立审查发现的日志/重试问题均修正复查。新增 214 项，最终 25 文件、602 项通过，原有 20 个入选回归文件未改；类型、格式、全仓 lint、生产 client/SSR 构建及正常 hooks 通过，保留 147 条既有警告。无 schema/迁移/绑定/cron/依赖变更，独立入口原行为保留。AnalyzeScript 后续及其它后代写入、完整事件/preview、尾部跨语句原子性、旧大 ID 读取、邮件/独立入口和真实环境验收仍开放；1,219 项冻结 inventory 保持 pending，GC-03/P3 仍 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-scene-split-content/README.md)、[实现记录](preservation/20261114-p3-g03-scene-split-content/implementation.json)和[验证记录](preservation/20261114-p3-g03-scene-split-content/verification-results.json)保留精确指纹、首次失败和证据边界。

2026-11-14，GC-03 的 G03-analysis-output 完成本批 AnalyzeScript 分析结果发布归属，源码提交 19da5acde10f82e478c8e2cf83a14f00c61b078c。新增窄 storyboardAnalysisOutput 面，场景服装连续性、初始镜头规格、派生图像/运动提示词、完成活动和耗时的实际 SQL 均检查同组织、序列、当前根/可信 claim 与 processing；真实 frame→shot→spec 关系同时约束内部选择指针、claim 撤销和旧对白 SELECT/INSERT。绑定派生提示词去重额外要求同 source/specVersionId，独立 writer 原规则保留。共享检查/步骤错误适配提取不变，确认换主在步骤内不可重试，未知校验保留可重试及原因，失败清理仍使用原 DB。保留新预检恢复四个原 DB factory 后，四项写入竞争及四项错误来源去重均红测；精确恢复修复文件后，最终 32 文件、939 项全通过，新增 259 项，其中三项组合调用真实 createScopedDb、workflow binder 和 persistShotSpec。28 个原入选测试文件未改，child-context 仅补具名 factory 替身。类型、全仓 lint、20 路径格式、生产 client/SSR 构建及正常 hooks 通过，保留 147 条既有警告；knip 早期发现的两个多余 fixture 导出已移除，独立审查无阻断。无 schema/迁移/绑定/cron/依赖变更，既有逐方法 batch 保留，整段规格/提示词循环不保证原子。共享角色/look/voice、地点/元素、自动风格/快照、其它后代及完整事件、根取消、邮件/独立入口和真实环境验收仍开放；1,219 项冻结 inventory 保持 pending，GC-03/P3 仍 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-analysis-output/README.md)、[实现记录](preservation/20261114-p3-g03-analysis-output/implementation.json)和[验证记录](preservation/20261114-p3-g03-analysis-output/verification-results.json)保留精确指纹、原码失败与证据边界。

2026-11-14，GC-03 的 G03-auto-style 完成本批自动风格写入归属，源码提交 355dee0cd0de8d67a5a588f044b110d1ec616fe1。新增窄 storyboardAutoStyle 面，风格 UPDATE、历史 INSERT 和选择指针 UPDATE 的实际 SQL 同时检查组织、序列、当前根/显式可信 claim 与 processing。原 writer 提取复用，AnalyzeScript 传递既有可信根；确认换主在保存步骤内不可重试，未知校验/引擎 abort 保留原有协议。风格库提升、用户中途改选、独立入口、JSON/default 编码、历史/指针 batch、较早授权风格写入及 LLM/model/reservation 行为保留。新增 122 项，最终 39 文件、1,132 项全部通过；36 个原有入选测试文件未改，既有分析输出测试只加强 mock 签名并追加两项根传递用例。恢复两个起点原 DB factory、保留新窄面前后检查后，18 项 SQL 竞争用例全失败；初次空过滤不计红测，精确恢复三个文件工作字节后 120 项相关用例复跑通过。新夹具 title/类型、JSON 可选字段断言及临时审计脚本 lint 问题均修正并保留首次记录。类型、15 路径格式、全仓 lint、生产 client/SSR 构建和正常 hooks 通过，保留 147 条既有警告；独立只读审查无可操作问题。无 schema/迁移/依赖/绑定/cron/hash/read hatch 变更。保护范围是持久化，已启动 LLM 成本及最终检查后的 style-ready 事件竞态仍开放。共享角色/服装/声音、地点/元素及内部清理已完成后续写入链梳理，尚未改造；完整后代/事件归属、根取消、缓存/独立入口、邮件和真实环境验收仍待完成。1,219 项冻结 inventory 保持 pending，GC-03/P3 仍 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-auto-style/README.md)、[实现记录](preservation/20261114-p3-g03-auto-style/implementation.json)和[验证记录](preservation/20261114-p3-g03-auto-style/verification-results.json)保留指纹、首次失败与验收边界。

2026-11-14，GC-03 的 G03-analysis-cast 完成本批 AnalyzeScript 角色/服装、地点和元素写入归属，源码提交 f9a2ab5921abb7f92d4b02d7f7999c323bd2a560。新增窄 storyboardCast 面，五个原写入入口及内部身份/历史/link、指针/claim/状态、默认服装回填、legacy features、独立声音描述 batch、退休/活动、地点重指向/冲突删除/孤立清理和元素 INSERT 均在 SQL 执行时检查根、组织及真实父关系。服务前后检查覆盖空输入和复用路径，不能替代 SQL；根丢失在步骤内不可重试。组织共享/attached/removed/archived、历史去重、claim、上传优先、元素上限及既有 batch 边界保留；多服装条件 INSERT 保持同批原子并满足 D1 参数限制。新增 212 项，最终 57 文件、1,610 项通过；50 个原测试文件未改，既有两项根传播用例只追加 cast 断言。恢复四个起点原 DB factory、保留新入口前后检查后，32 项竞争/父关系用例全部失败；精确恢复工作字节后 212 项复跑通过。类型、26 路径格式、全仓 lint、生产 client/SSR 构建及正常 hooks 通过，保留 147 条既有警告；首次夹具断言、目录边界和多余导出问题均修正并记录。独立审查无可操作问题，17 个受审文件字节核对一致。无 schema/迁移/依赖/绑定/cron/hash/read hatch 变化。其它后代/独立入口、完整事件、根取消、缓存和邮件、共享资格并发窗口及真实环境验收仍开放；1,219 项冻结 inventory 保持 pending，GC-03/P3 仍 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-analysis-cast/README.md)、[实现记录](preservation/20261114-p3-g03-analysis-cast/implementation.json)和[验证记录](preservation/20261114-p3-g03-analysis-cast/verification-results.json)保存源码指纹、首次失败与证据边界。

2026-11-14，GC-03 的 G03-storyboard-poster 完成本批海报发布与刷新归属，源码提交 c433acc8bbbbe017f514e540ea977bb265a4f17c。海报 UPDATE 在实际 SQL 检查组织、序列、当前根/可信 claim 与 processing；已发生用量和扣费保持原 step 名及身份并先结算，拒绝发布不发事件、在子任务前退出且仅释放自己的剩余预留。客户端不采用事件 URL，改为取消旧读后获取当前详情，覆盖冷缓存/零观察者、连续通知补读和 pending launch；非手工查询成功 receipt 排除取消后返回旧缓存，同步查询生命周期防止冷 clear 后复活。独立审查发现的两项时序问题先红测再修复，最终 28 文件、535 项全过，新增 124 项，18 个原测试文件未改；恢复原 writer 四项竞争全红、恢复原客户端边界五项全红，finally 精确恢复后复跑通过。类型、23 路径格式、全仓 lint、生产 client/SSR 构建与正常 hooks 通过，保留 147 条既有警告。11 个新增 TS 文件质量检查通过；既有大模块只改接缝。无 schema/迁移/依赖/绑定/cron/read hatch 变化；其它后代、完整事件、整根取消、共享资格、旧缓存、邮件及真实环境验收仍开放。1,219 项冻结 inventory 仍 pending，GC-03/P3 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-storyboard-poster/README.md)、[实现记录](preservation/20261114-p3-g03-storyboard-poster/implementation.json)及[验证记录](preservation/20261114-p3-g03-storyboard-poster/verification-results.json)保留指纹、首次失败和验收边界。

2026-11-14，GC-03 的 G03-element-sheet-publication 完成本批元素参考图发布归属，源码提交 ae478f5b288fa973fe02161ead9ab69ff8381175。UpdateStale 覆盖子 payload 的旧身份并传递显式根/可信 claim，仅真实 Storyboard 父提示允许实例 ID 回退；独立入口保留。窄 publishGenerated 以条件 UPDATE、身份缺失 INSERT 和最终可用性 SELECT 的同一 D1 batch 检查组织、真实序列、当前根/显式 claim 与 processing；ID 优先兼容改名，上传优先，墓碑身份不复活，占位元数据和初始默认值保留。前置读取经现有 hatch 校验序列访问与实际行关系；已发生 usage/扣费/溯源先记录，原步骤名与记账身份不变，归属错误和引擎中断保留协议。精确恢复起点原工作流后 8 项竞争/范围用例全红，finally 恢复修复字节；新增 137 项（135 项行为与 2 项动态读取门禁），最终 31 文件、624 项全部通过，24 个原测试文件 Git blob 未改。首次最终回归仅全仓 SQL 扫描 5 秒超时，构建结束后以 2 workers 复跑全组通过，未改断言/阈值；其余夹具、目录和多余导出失败均保留记录。类型、全仓 lint、20 路径格式、client/SSR 构建和正常 hooks 通过，保留 147 条既有警告，均不在本批改动行；10 个新 TS 文件质量检查通过，独立源码审查无阻断。无 schema/迁移/依赖/绑定/cron/hash/read hatch 变更；持久缓存检查不重新执行、全缓存旧任务和无可信根旧后代不修复，已发生费用/存储和已授权 batch 不回滚。其它后代/事件/整根取消、共享资格、邮件及真实环境验收继续开放。1,219 项冻结 inventory 保持 pending，GC-03/P3 仍 in-progress，P4 未开始。[批次记录](preservation/20261114-p3-g03-element-sheet-publication/README.md)、[实现记录](preservation/20261114-p3-g03-element-sheet-publication/implementation.json)和[验证记录](preservation/20261114-p3-g03-element-sheet-publication/verification-results.json)保留指纹、首次失败和验收边界。
