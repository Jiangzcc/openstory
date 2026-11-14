# P3 收口盘点与范围纠偏（2026-11-14）

本报告以已提交 `0ae0e3d09aea17575d047bc1d69ef90c51861d23`（H）为审计点，沿用原设计 S `db3ea57b5f419f69c51369c28819de17515b21f5` 和上游 B `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。这是收口盘点和剩余安排，不是 P3 完成报告，也不批准正在暂停的共享素材代码。

## 1. 纠偏决定

此前执行把连续发现的失败恢复、根归属、通知投递、取消和素材竞争问题不断接成 GC-03 下一批，使原来的字段传播核对扩展为工作流可靠性整改。缺陷有实际价值，已提交修复保留；它们不自动成为原 P3 的完成前置，也不能全部记作结构收敛收益。

P3 回到原目标：解释全部长期差异，集中二开决策，恢复可撤回的上游偏离，为必要的最小接入保留证据。原全量范围继续有效，不能退回当天的18个冲突点。原 [GC-03 条款](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl)要求核对父子身份/语言/配置与资金 owner，停止条件为“只剩字段传播即停止”。

进入 P3 阻断清单必须满足其一：二开/P3 改动引入的可定位回归；结构调整直接改变的已承诺契约；原验收条款明确要求的必要性裁决、差异处置或验证缺口。仅仅发现上游/既有系统还有缺陷、真实环境尚未实测，不能无限增加整改任务。安全、数据损坏、可证实错误收费另立紧急项；若确实影响本期接缝，再注明因果和最小处理。

## 2. 已停止的工作与保留方式

- 最后一个完成有限验证并提交的代码批次为 `ae478f5b288fa973fe02161ead9ab69ff8381175`，其记录提交为 H；没有回退这些修复。
- 共享角色/look、地点的 claim、发布及失败清理扩展已停写；11个已跟踪文件修改、4个新源码/夹具文件保持未提交，尚未完成验证，不能算作交付。
- 三个实现子任务已停止。收口盘点只读取 H，不把上述 WIP 当成已实现或可运行证据。
- 本地保留 `.codex/p3-paused-shared-sheets-20261114/` 中的 `tracked.patch`、`working-files.zip` 和 `manifest.json`。快照包含15个源码/测试/夹具和5个本轮产物；原文件未删除、未恢复、未暂存。归档 SHA-256 为 `1d1f2fd5977e82a05ec1c02c32158ddf505f5af03676df016389375d9f4a655b`。
- 该 WIP 转为独立可靠性候选，不再默认续做或合并。工作区有意保留为 dirty；本报告不把中途局部测试当成整份 WIP 验收。

## 3. 累计进度与维护负担

| 口径                       | 已核对事实                                                | 含义                                                                                       |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 原职责                     | AB 22、GC 14、MC 13、PL 10，共59项；另 GOV-01，共60项     | 本报告逐项盘点，不能只跟踪 GC-03                                                           |
| 实施台账                   | 59条，其中40条 GC-03；覆盖11个产品/工程职责编号           | 是交付记录，不等于11项职责已完整关闭                                                       |
| 正式关闭                   | 现有台账中 `responsibilityClosed:true` 为0                | 不能说没有实现；说明缺少累计签收机制                                                       |
| 原冻结清单                 | 1,219项仍 pending，五个文件不变                           | 原清单是来源快照，不是当前全部差异，也不自动批准                                           |
| B→S 差异                   | 1,219路径：653修改、566新增；既有 src 修改606、新 src 411 | 原设计分母                                                                                 |
| B→H 差异                   | 1,695路径：701修改、994新增；既有 src 修改653、新 src 571 | 所有原1,219路径仍在，另增476，退出0                                                        |
| S→H 工作树之外的已提交增量 | 578路径：150修改、428新增                                 | 整个版本区间的变化，不能全归因某一职责                                                     |
| S→H 生产 src               | 137路径，+7,324/-2,383行                                  | 净增4,941行，不是整体侵入减少的证据                                                        |
| S→H 测试/夹具 src          | 155路径，+45,387/-514行                                   | 按 `.test.`、`/test/`、`/__tests__/`、`/fixtures/`、`.fixture.` 归类；测试数量不算结构收益 |
| S→H 其余支持文件           | 286路径，+85,018/-32行                                    | 含归档、文档和工程文件，不等同应用运行代码                                                 |

路径和行数不能单独证明语义维护成本变差或变好，但足以否定“因为新增 helper/测试很多，整体升级成本已下降”的推断。本轮没有重跑上游合并冲突样本，不承诺零冲突。

### 已有可核对的局部结构收益

| 交付                              | 实际前后变化                                         | 剩余必要接入与限制                                             |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| G09-reference-projection          | billing model fallback来源3→1；角色/地点参考数各2→1  | direct/plan仍负责真实输入、claim/预占/调度；不冒认执行骨架退出 |
| G07-partition                     | 两处计划图片分区决策各2→1                            | Continue/fresh保留不同的准备与旧估价参数                       |
| MC-B01 / MC-09                    | 完整操作能力谓词2→1                                  | 两个调用包装保留；上游修改路径减少0                            |
| MC-B02 / MC-06                    | 成本算式1→1，归属移到 billing；协议模块107→92行      | 是职责归属调整，不是算式去重                                   |
| MC-B03 / MC-10                    | 钱包精度谓词1→1，pricing模块132→122行                | 复用 money、移除无引用常量；不改变币种或账本                   |
| G01/G02/G03 有限传播              | 入口、可信快照及两条 portrait 配置断链有对应版本证据 | 保留必要字段桥接；不是新增上下文框架，也不等于上游文件减少     |
| 后续生命周期/根归属/通知/取消修复 | 按各自缺陷与验证记录保留                             | 计入可靠性修复及维护负担；未经独立对照，不登记为升级冲突收益   |

上述量化来源为各批 `implementation.json` 的 `removedDuplication` / `structuralResult`，不是本轮重新运行的业务结果。现有 `loadModelRuntimeConfiguration` 与 `assistantRequestModel` 已被原设计裁决为必要组合根，继续保留。

## 4. 全部职责盘点

下表的“已有有限实施”不等于全职责验收；“保留待签收”表示没有证据要求继续重构。实际源码、Git blob、历史交付、原验收/停止条款及剩余事项逐项保存在 [60项机器台账](preservation/20261114-p3-closeout-review/responsibilities.jsonl)。本轮没有把历史测试结果写成本轮通过，也没有自动更改冻结 inventory 的 pending。

保留待签收36项；已有有限实施10项；原结构缺口2项；必要性待裁决5项；验收证据待归并7项。这是盘点分类，60项均未在本次认定为正式验收完成；同一项可已有修复而仍需签收。

机器台账逐项保留原职责文件及行号、原批次种类/范围/验收、必要桥接和停止条款，并列出 H 的源码/测试 Git 对象及实施提交。MC 的10项原保留职责没有独立 acceptance 数组，沿用原需求和保留边界，不补造验收条款。原 evidence 字符串保留其历史含义；当前已核实的对象另列，不能用旧行号冒充 H 的定位。

| 职责与原条款                                                                                                                                 | 分类           | 已有事实/必要性                                      | 有限剩余事项                                                | 工作包  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------- | ----------------------------------------------------------- | ------- |
| [AB-01 认证、组织与角色是上游权威](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L1)                  | 保留待签收     | 保留认证、组织、角色及共享钱包原 owner。             | 签收原权限矩阵及 locale 薄接入。                            | K4      |
| [AB-02 身份世代与迟到回调隔离](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L2)                      | 保留待签收     | 已有身份世代隔离，源码与 S 相同。                    | 关联切换、重登、401/403 与迟到回调断言。                    | K4      |
| [AB-03 公开页面的 session SSR 快照](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L3)                 | 保留待签收     | Docs 仅一次 session 预取，与 S 相同。                | 核对匿名/登录/延迟 session，保留必要 SSR 桥接。             | K4      |
| [AB-04 语言只在入口解析，逐层显式传递](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L4)              | 原结构缺口     | 两次请求语言解析尚未统一到入口捕获值。               | AB04-a 限3源码 owner；AB04-b 核对外部固定 en。              | K2      |
| [AB-05 MCP/API principal 与管理员能力](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L5)              | 保留待签收     | principal 仍区分 session、API Key、OAuth。           | 签收授权组织/管理员支持访问，不裁剪 API/MCP。               | K4      |
| [AB-06 助手入口消费模型策略并校验完整历史](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L6)          | 保留待签收     | 原设计已裁决保留助手专属模型组合。                   | 关联默认/显式模型、历史图片能力及 usage/错误断言。          | K4      |
| [AB-07 公共创建/增强的输入与配置契约](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L7)               | 必要性待裁决   | API 默认已共享，网页默认语义不等同。                 | 先证明同义再提取；签收 custom storyboard 入口契约。         | K4      |
| [AB-08 上传、导出与发布沿用业务服务](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L8)                | 保留待签收     | 上传、导出、发布仍复用原域服务。                     | 关联权限、权利及失败断言；标明生产 Container 边界。         | K4      |
| [AB-09 共享工具目录与助手 schema 适配](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L9)              | 保留待签收     | 助手只做 SDK schema 薄适配。                         | 签收 object、nested defs、default/refinement 请求断言。     | K4      |
| [AB-10 审批绑定与恢复按 SDK 身份执行](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L10)              | 保留待签收     | 两种 SDK binding 及对象内重复回答保护保留。          | 签收 hydrate/run/generation/deny；校正文档审批描述。        | K4      |
| [AB-11 助手 HTTP 错误、日志恢复与收费生命周期](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L11)     | 保留待签收     | HTTP 错误桥接保留，Run ID/收费仍归原 owner。         | 签收四类请求及网络错误；不增加重连运行器。                  | K4      |
| [AB-12 页面上下文、附件与 MCP Apps 主机契约](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L12)       | 保留待签收     | 页面名读现有缓存，主机适配与 MCP 工具分离。          | 与 PL-09 共用13文件证据；保留附件/草稿和通信限制。          | K4      |
| [AB-13 ScopedDb 聚合、primary 读取与工作流窄面](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L13)    | 保留待签收     | ScopedDb 模型 loader 保留为必要组合根。              | 核对6个 owner 的公开字段、primary 读取和工作流窄面。        | K4      |
| [AB-14 客户端、SQL、domain-blind 和请求上下文守卫](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L14) | 保留待签收     | Windows 路径归一化维持原边界守卫。                   | 关联4个测试文件及 lint 配置的正反与并发断言。               | K6      |
| [AB-15 Windows 路径、CLI 与失败退出兼容](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L15)           | 保留待签收     | 启动顺序、argv、路径及失败退出补丁保留。             | 核对3对6文件；实际双平台运行证据缺口单列。                  | K6      |
| [AB-16 Windows Worker inspector 临时绕过](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L16)          | 必要性待裁决   | 单文件 inspector 临时绕过尚无当前重现。              | 记录锁定版本、暂留依据及相关升级后的删除条件。              | K6      |
| [AB-17 测试环境隔离与供应商防误调用](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L17)               | 保留待签收     | 本地主机/E2E 双守卫与 mock 路由保留。                | 签收6个 owner；不把测试限流窗口解释为生产验收。             | K6      |
| [AB-18 E2E 准备通知、请求完成与原断言](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L18)             | 必要性待裁决   | 准备循环与真实提交分开，不证明 SSE 已修。            | 签收原版本/提交次数断言及有限 timeout 暂留依据。            | K6      |
| [AB-19 预览 D1 晋升、删除和 fork 仓库身份](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L19)         | 保留待签收     | 预览晋升/删除预约及显式仓库身份仍在脚本。            | 签收2文件竞态/重试；scratch remote 仍未验。                 | K6      |
| [AB-20 项目本地工具与 Hooks 执行边界](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L20)              | 保留待签收     | Hook 适配只在项目工具层，宿主加载未证明。            | 记录当前宿主边界和未来等效触发，不扩命令解析。              | K6      |
| [AB-21 依赖与本地化开发支持的运行预算](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L21)             | 验收证据待归并 | 报告试点10文件指纹一致；Storybook 共享 QueryClient。 | 核对10文件 CLI/隔离；先证实干扰再决定是否改，CI 属 P4。     | K6      |
| [AB-22 生成产物、机器噪声与忽略范围](preservation/20261109-p3-global-design/application-boundaries-responsibilities.jsonl#L22)               | 原结构缺口     | Worker 类型主体一致，仅第2行机器路径不同。           | 处置1行噪声；另裁决 .idea/testing/ 两项 ignore 必要性。     | K6      |
| [GC-01 可信请求身份与任务语言入口](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L1)                      | 保留待签收     | 可信身份和语言的有限组合证据已有，未新增生产结构。   | 关联 G01 两份记录和原权限断言，不重建 context。             | K2      |
| [GC-02 模型配置快照捕获、封装与消费](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L2)                    | 已有有限实施   | 已有快照封装/消费，两个确定断链已修。                | 关联 codec/可信覆盖/空路由原条款，不新增配置 epoch。        | K2      |
| [GC-03 父子任务、重试与恢复调度](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L3)                        | 已有有限实施   | 35边静态贯通，portrait两处已修；后续加固另计。       | 固定35边/29路径/16父任务证据级别；只剩传播即停止。          | K2      |
| [GC-04 系统指令和领域自然语言资源](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L4)                      | 必要性待裁决   | 资源及维护报告已有；内联文字不自动构成缺陷。         | 有限 builder 抽取必要性裁决；补最终消息与中文全文证据。     | K3      |
| [GC-05 风格配方和保存内容所有权](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L5)                        | 保留待签收     | 保存配方和一次语言解析已有 D1 证据。                 | 关联 G05 原条款及中文语义边界，不追加自动风格 fencing。     | K3      |
| [GC-06 新建与完整重试的请求准备快照](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L6)                    | 已有有限实施   | capture、auxiliary、request-edges 三批已有实现。     | 关联准备快照/权限/资金顺序原条款，不再新建准备框架。        | K2      |
| [GC-07 计划报价与执行衔接](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L7)                              | 已有有限实施   | 图片计划分区已统一，三个后续计费修复已记录。         | 归并最终 caller/修复证据；Continue 来源继续暂缓。           | K7      |
| [GC-08 单镜头、变体、放大与预览准备](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L8)                    | 已有有限实施   | 单镜头 quote 2→1，原 claim/reserve 顺序保留。        | 关联原 single/variants/upscale/batch/preview 有限入口。     | K7      |
| [GC-09 cast/location/looks输入投影与组织所有权](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L9)         | 已有有限实施   | 参考投影已统一，六项 ownership 修复另有授权。        | 关联 projection/review/repair；暂停共享素材 WIP 不作证据。  | K7      |
| [GC-10 兼容图片attempt、防重复付费与同step存储](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L10)        | 保留待签收     | attempt、防重复付费及同 step 存储有有限组合证据。    | 关联原4项验收；未知付费响应不自动重发。                     | K7      |
| [GC-11 组织钱包预占、扣费与失败释放](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L11)                   | 验收证据待归并 | 资金 owner 保留，尚缺全入口原条款整合签收。          | 归并 reserve/capture/cleanup 原断言，暂缓及实账单分列。     | K7      |
| [GC-12 选择claim、staleness与不可变版本](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L12)               | 保留待签收     | claim、不可变版本、选择指针/hash 分工保留。          | 关联具体 ID/hash/选择权断言，不强加新 root cleanup 策略。   | K7      |
| [GC-13 动态、对白、声音、音乐与导出](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L13)                   | 验收证据待归并 | 音视频/对白/音乐/导出有分散证据，非全链路验收。      | 归并原有限入口的协议/存储/语言断言；不统一音频执行器。      | K7      |
| [GC-14 Studio及生成素材的准备、排队和终态](preservation/20261109-p3-global-design/generation-context-responsibilities.jsonl#L14)             | 已有有限实施   | Studio 一次准备及 asset-verify 有界修复已实施。      | 关联入口/生命周期/真实 provider facts，分批结果不合称全绿。 | K7      |
| [MC-01 默认推荐、显式选择与内部模型槽位](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L1)                    | 保留待签收     | 22个默认/模式/内部槽位已有明确 owner。               | 最终差异/桥接/原断言处置，无已证新增代码任务。              | K5      |
| [MC-02 管理员配置持久化、凭证轮换与发布投影](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L2)                | 保留待签收     | 配置/凭证边界已有；并非全局原子发布。                | 签收持久化/权限/轮换，不追加全局 epoch。                    | K5      |
| [MC-03 管理页面、只读发现、公开目录与缓存会话](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L3)              | 保留待签收     | 管理草稿、只读发现、目录和身份隔离已有。             | 签收现有边界；浏览器保存与供应商认证分列。                  | K5      |
| [MC-04 文本模型身份、凭证选择与付款来源](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L4)                    | 保留待签收     | 文本凭证策略已有唯一入口，选定失败不换渠道。         | 签收 source/via/付款覆盖；Continue 来源仍暂缓。             | K5      |
| [MC-05 文本协议、能力、token预算与已有API分类](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L5)              | 保留待签收     | API 分类和协议能力已有集中决策。                     | 签收参数/token/薄调用桥接，不合并四执行器。                 | K5      |
| [MC-06 配置文本的供应商USD成本归属](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L6)                         | 已有有限实施   | MC-B02 完成：成本归 billing，算式1→1。               | 签收已实施差异；币种/汇率/利润不进入本项。                  | K5      |
| [MC-07 原生能力、区域恢复与实际失败归属](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L7)                    | 保留待签收     | 原生 via、地区恢复和实际失败来源分工保留。           | 签收 Files/恢复桥接；native spend/真实网络另验。            | K5      |
| [MC-08 图片身份、目录、操作绑定与停用语义](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L8)                  | 保留待签收     | 内置增量绑定与 custom 停用语义已有区分。             | 签收目录/身份/能力桥接，不统一所有 enabled 判断。           | K5      |
| [MC-09 完整图片请求的操作能力与中性规格](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L9)                    | 已有有限实施   | MC-B01 完成：完整请求接纳谓词2→1。                   | 签收批次和真实 ref/mask/规格的 quote 交接。                 | K5      |
| [MC-10 图片USD价卡与钱包精度策略](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L10)                          | 已有有限实施   | MC-B03 完成：精度归 billing，谓词1→1。               | 签收单张精度/数量/零价/历史修正边界。                       | K5      |
| [MC-11 多入口报价消费、平台计费来源与执行结果契约](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L11)         | 保留待签收     | quote 与领域准备/结果计量桥接有保留依据。            | 一份实际输入→quote→执行→实际结果的有限接口确认。            | K5      |
| [MC-12 兼容Images传输、返回验证与资源预算](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L12)                 | 保留待签收     | Images adapter 已独立，执行和通用网络仍分层。        | 签收 transport/解码/错误边界；生产峰值内存未验。            | K5      |
| [MC-13 模型发布快照与生成组共享接口](preservation/20261109-p3-global-design/model-channels-responsibilities.jsonl#L13)                       | 保留待签收     | 配置 codec、credentialId 及必要组合根已存在。        | 一份快照/子任务继承/恢复不重选路线的有限接口确认。          | K5      |
| [PL-01 全局 locale、SSR 与页面 head 的单一显示来源](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L1)  | 必要性待裁决   | 每 Router 隔离保留；登录标题统一为条件候选。         | 先证中英文 SSR/水合/返回导航等效，否则依停止条款保留。      | K3      |
| [PL-02 双语资源、英文原文键与全量消费台账](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L2)           | 验收证据待归并 | 应用/平台资源 owner 分离，无需因重复键自动合并。     | 57文件含26命名空间/52 JSON 的原句/上下文/断言签收。         | K3      |
| [PL-03 外壳、账号、设置、管理及公开页面的展示接入](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L3)   | 保留待签收     | 原位展示翻译保留，不抽整个页面。                     | 110文件的 handler/权限/query/form/公开内容处置。            | K3      |
| [PL-04 创作界面、模板展示与规范输入值](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L4)               | 保留待签收     | 显示文案与提交规范值、模板身份分离。                 | 368文件的草稿/选择/FormData/模板身份证据归并。              | K3      |
| [PL-05 格式化、动态错误标签与异步通知](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L5)               | 验收证据待归并 | 完成时翻译及窄适配器已有，不统一错误协议。           | 372文件重叠集合的未知值/异步通知/金额证据；时区另列。       | K3      |
| [PL-06 帮助 Markdown、FAQ 与交互依赖图](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L6)              | 保留待签收     | Markdown AST、英文锚点及共享图实现保留。             | 85文件的全文/代码块/链接/锚点处置，未验浏览器状态明列。     | K3      |
| [PL-07 账号邮件主题、正文、预览与发送语言快照](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L7)       | 保留待签收     | 账号邮件主题/正文使用同一捕获语言。                  | 13文件的文字/渠道/请求隔离签收；真实投递另列。              | K3      |
| [PL-08 模型管理与 Studio 的展示接入和异步 UI 边界](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L8)   | 验收证据待归并 | 管理和 Studio 仅消费已有 issue/实际输出契约。        | 17文件显示状态/原断言归并，不引入 UI 状态机。               | K3      |
| [PL-09 站内助手与外部 MCP 卡片的隔离展示](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L9)            | 保留待签收     | iframe hostContext 和小资源独立于应用 React。        | 与 AB-12 共用13文件证据；不扩主机协议/轮询。                | K3      |
| [PL-10 stitch、单片预览与剧场的播放控件展示](preservation/20261109-p3-global-design/presentation-language-responsibilities.jsonl#L10)        | 保留待签收     | stitch 可选 labels/英文 fallback 保留包边界。        | 8文件的标签/语言/播放状态证据；实际播放边界明列。           | K3      |
| [GOV-01 范围、原断言、历史来源与治理文档](preservation/20261109-p3-global-design/roadmap.json)                                               | 验收证据待归并 | 已固定审计 H 并停写，WIP 有校验归档。                | K1逐块处置与K8正式验收；本台账不代替语义批准。              | K1 / K8 |

## 5. 真正阻断与独立后续

### 当前必须完成的 P3 收口

1. **差异处置与正式签收缺失**：1,695个固定当前路径及本报告新增的2个治理文件需要明确差异块/新模块处置；可以复用相同 blob 和有效历史证据，不能按目录批量批准，也不要求重新测试每个文件。
2. **已确认的原结构项**：AB04-a 的助手语言入口统一传值尚未落地；AB22-a 的 Worker 类型头机器路径噪声已有无语义差异证据。只做原条款范围，不顺手改执行器或 bindings。
3. **有停止条件的候选**：PL-B02 登录标题双桥接，能证明 SSR/水合/导航等效才统一；否则按原停止条件保留。G04 仅对仍混在上游 builder 中且能证明同义的二开固定文字评估归属，整段搬 builder 不算收益。
4. **原验收证据空格**：本地化消费者/全文语义、原公开入口与原断言、既有快照/quote接口、工程兼容补丁的必要性和当前核对结果。先复用现有证据；只有明确的空格才补验证。

两个确定结构项的源码依据：H 的 [AssistantCaller](../../src/assistant/server/assistant-chat.ts#L118)仍只持有 Request，两个消费点分别在第161、180行解析；[HTTP caller](../../src/routes/api/assistant/chat.ts#L22)和[server fn caller](../../src/assistant/assistant.fn.ts#L96)是有限构造入口。Worker 类型文件排除第2行后的主体 SHA-256 在 B/S/H 均为 `b65506f2b9ef27a493f68a8c0a49786fd5f77a337be99b4f0be05c25ea44d7ee`。这些是尚待处理的原条款，不是本次代码修复。

### GC-03 的固定结案范围

- 以原 [caller matrix](preservation/20261112-p3-g03/caller-matrix.json)的 `domain-01..35` 为边界，覆盖16个父任务；源码限定为 `sourceAfterRechecks` 的26个路径，加 `await-child.ts`、`client.ts`、`base-workflow.ts`，共29个路径，不按后来发现的新业务自动扩图。
- 原 sourceAfter 静态记录为35/35继承模型快照、0个配置传播缺口；实际修复为 portrait 两条边。AnalyzeScript 保持2→2调用、8→8显式字段，移除核心接入0，不能登记为8→0的结构收益。独立 enrichment 仍持有独立资金预占。
- 动态证据有深浅之分：原9个父 runImpl，后续 motion-music/parent-bodies 1、2增加5个，ShotImages primary-child 探针增加1个。15个有界探针不能写成16/16完整生命周期，也不证明35条边都动态执行过。LocationSheet 的 onFailure 不是完整 runImpl；其传播有源码与真实 helper→binding 组合证明，可明确接受该级别，或只为具体空格补一个有界传播探针。
- 复用既有身份/locale/配置、并发上下文隔离、可信 options 覆盖、step/child ID、timeout/AlreadyExists、dedup 不改旧 payload、受控 abort 和 reservation 归属证据。原 cold-import 超时与 claim-harness 后的5项通过保持分开，不能拼成一次全绿执行。
- 40条 GC-03 实施记录中，6条直接服务原传播或测试准备契约；2条独立失败修复可贡献有限传播证据；其余32条按可靠性加固保留。逐条分类及原提交见机器台账，既不回退，也不让全部后续生命周期范围反向阻断原传播职责。未经 B 对照的问题不统一称为“上游遗留”。

### 不再自动阻断 P3 的事项

| 独立登记                                                | 保留的风险与后续边界                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 共享角色/服装/地点、portrait全链路 root fencing         | 本轮 WIP 已冻结；异步 portrait 是版本 enrichment，正常父完成后的生命周期策略需独立设计，不能机械复制 processing 条件 |
| 全根子树取消、完整事件/preview/通知所有权               | 已提交修复保留；其余作为可靠性工作，不以“所有后代零竞态”定义 GC-03 结束                                              |
| 邮件/外部投递恰好一次                                   | 与 PL-07 账号邮件主题/正文同语言分开；真实投递和通知一致性单列                                                       |
| 旧 checkpoint/raw claim/全部恢复分支                    | 保留已知边界，不为 P3 自动承诺历史任务全面迁移或所有引擎重放状态                                                     |
| native spend、供应商账单、真实 Workerd/D1/R2/浏览器环境 | 不把真实调用/部署当成本次新增结构授权；与本期实际改动直接关联的局部验收仍按原条款核对                                |
| BYOK禁令、人民币售价/汇率、默认私有等商业规划           | 各自独立需求和授权；已取消的个人钱包/卡密改造不复活                                                                  |
| P4 CI与未来依赖/上游升级                                | 当前报告/Storybook核对留在原AB21-b；CI接入属于P4，未来版本触发复核不能无限阻止当前必要性处置                         |

本次只读盘点没有认定需要立即操作的新安全/数据损坏/错误收费紧急项；这不构成无缺陷证明。出现可复现紧急证据时单独分级、列因果和最小修复，不借其恢复无限整改。

## 6. 下一阶段固定为八个工作包

K0（停写、固定H、保护WIP）已在本次完成。下表是剩余包和退出条件，**不是八次必然编码，也不是新增66次整改授权**。

| 包                        | 固定范围与可评估工作量                                                                                     | 退出条件                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| K1 职责/差异对账          | 60条职责、1,695个H路径＋2个报告新增文件；保留1,219历史快照并补476增量处置                                  | 每个当前差异块/新模块有需求/原条款、必要桥接、原断言、验证和明确 disposition；不以扫描覆盖代替语义批准                  |
| K2 入口与任务快照         | AB04、GC01/02/03/06；助手3个源码owner；复用原35条调度边/16个父任务矩阵，仅补身份/语言/配置/资金owner的空格 | 捕获值到实际 binding.create 一致，原dedup/step/恢复契约有追溯；只剩字段传播即签收，不再逐个开展业务失败/取消/根写入加固 |
| K3 展示/指令/保存内容     | PL01～10、GC04/05；26命名空间/52份JSON；原PL批次文件集合有重叠，不当作待修改文件数                         | 英文消息/协议/用户内容、中文全文与变量、输入规范值/原动作逐项处置；标题候选按证据统一或明确保留                         |
| K4 公共入口与必要适配     | AB01～13中除K2项；身份、session、API/MCP/助手、schema/审批、ScopedDb原组合根                               | 原权限/工具/错误/输入契约与对应断言签收；AB07先证明同义再决定抽取，不能强行统一不同默认语义                             |
| K5 模型规则               | 13条MC裁决＋MC11/MC13两份接口确认；3个结构批次已实施，10项保留有据                                         | 15条收口记录完成；没有已证明的新结构代码任务，不等待供应商认证或全局epoch                                               |
| K6 工程暂留与开发支持     | AB14～22；AB15三对6文件；AB21-b报告/Storybook 10文件；类型头/ignore 2文件；7项未来触发动作只做当前退出登记 | 必要性、原断言、宿主边界和退出触发明确；收敛已证机器噪声；不换runner、不扩命令解析器、不等待P4                          |
| K7 生成输入/费用/素材接口 | GC07～14已声明的direct/plan/Studio/asset/shot及原claim/attempt/存储接缝；复用G09/G07/G10/G14交付           | 准备、quote、执行和结果对照中的既有二开契约闭合；有据保留原生命周期，未知继承加固进入独立风险单                         |
| K8 最终验收与收益说明     | 前7包产物与实际受影响入口，一次整合签收                                                                    | 原五条P3完成判据满足；结构收益、修复收益、维护新增、未验环境分开；无未解释pending，P4状态独立                           |

优先顺序：先K1对账与K2明确小范围；K3～K7可按互不重叠职责并行；K8最后。原66动作中包含当前验证、条件候选与未来触发，不能全部转成编码任务。原计划也明确普通上游同步不强制等待P3；P5仍按P1及相关P2证据准入。

工期以差异块、原契约空格和已证明重复决策数估算，不以历史测试数量、helper数或“还有风险”估算。本报告不伪造人日；K1先给出这些有限单元的工作量，再固定后续预算。发现与本期接缝无关的问题只进风险单，不自动增加第九包或移动退出条件。

## 7. 固定退出条件和本次验证边界

原全局设计§6的五条完成判据保持：全部当前差异可追溯处置；可撤回偏离已处理且剩余桥接有最小性依据；上游骨架/外部行为/原断言保留；维护负担变化有实证；暂缓与未验边界分开。对本期必要改动追加精确增量，不把未知未来上游或新商业需求滚入分母。

本次交付只更新当前计划状态、新增本报告及60条盘点台账；历史59条实施日志、五份冻结inventory和已提交业务修复保持不变。只做源码/记录/指纹/链接与范围一致性核对，不运行生成、付费模型、真实邮件、远程DB或部署，也不宣称暂停WIP通过类型/构建验收。

本轮机械核对包括：60个唯一职责与原目录完全对应；66个原动作和验收原样关联；引用的当前源码、测试和交付文档存在于 H；所有引用实施源码提交解析为完整 SHA 且为 H 的祖先；B→S、B→H、S→H 数量重算；暂停的20个文件原始字节指纹、补丁/归档指纹和6份历史清单/日志保持。只对本次文档进行格式和 Git 差异检查，并使用正常提交 hooks；没有运行应用测试。
