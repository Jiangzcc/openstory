# P3 首批准备：任务上下文继承

日期：2026-11-09。状态：首批范围与进入条件已整理。用户随后授权首批执行，实际验证和保留现状的决定见[首批结果](upstream-preservation-p3-context-20261109.md)；本文件保留准备时的范围，不将其算作 P3 结构收敛验收。

核对起点：develop 的 d9f7547eb1bc30f178cf8cc420b4a65c070ea8aa；沿用 P2 固定上游 B：2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0。此次未刷新上游。工作区已有 src/routeTree.gen.ts 改动保留，不属于首批范围。

## 进入判断

可以开始准备。主计划要求 P1 已关闭、拟整理领域具备对应 P2 审查与验证依据，允许按领域逐步进入 P3；不要求先完成 P4、P5 或全部商业规划。见[阶段依赖及顺序](upstream-preservation-plan.md#3-分阶段交付与依赖)。

P2 的[补充记录](preservation/20261108-p2/followup-20261109/README.md)修正了已发现的台账和证据缺口，但没有重新证明所有候选路径的全部业务状态。首批仍须在当前源码上建立改前基线，不能只凭阶段标签或测试总数进入批量重构。

CONTINUE-LLM-SOURCE 按[用户暂缓决定](preservation/20261108-p2/followup-20261109/deferred-decisions.json)保持未修复。它不阻断这次准备；首批范围不涉及 Continue 的余额豁免判断、凭证优先级或全面禁止 BYOK。后续若整理实际触及该调用链，重新列明受影响契约和暂缓边界，不借纯重构改变收费行为。

## 当前实现与收敛价值

上游已有工作流触发、子任务等待、claim、预占和失败处理。二开已实现必填 promptLocale 与模型运行配置快照。本次的目标是减少二开上下文传播带来的维护成本，保持这些行为不变。

| 当前接入点                                                                               | 已核对的实际职责                                                                                                         | 对首批的约束                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [triggerWorkflowRun](../../src/platform/server/workflow/client.ts)                       | 请求或直接触发入口要求用户、组织及语言；服务端 option 中的模型快照优先，否则装载当前配置；覆盖 body 自带的模型快照       | 可信来源与装载时点已集中，不重复实现；工作流内的直接触发必须继续显式继承父快照和适用的 enforcement |
| [spawnAndAwaitChild](../../src/platform/server/workflow/await-child.ts)                  | 调用者显式提供模型配置；统一打包后覆盖子 payload 的同名字段；负责实例标识、等待、通知及恢复                              | 保留原执行骨架，语言继续取父任务；不向统一上下文混入子任务生命周期字段                             |
| [model-runtime-configuration](../../src/models/model-runtime-configuration.ts)           | 文本和图片路由沿用既有 pack/unpack；模型配置与 workflow wire format 已有区分                                             | 不新增另一种运行配置或序列化格式，不新增明文密钥                                                   |
| [AnalyzeScriptWorkflow](../../src/sequences/server/workflows/analyze-script-workflow.ts) | 已核对两个子任务：scene-split、location-matching；两处都传 scopedDb.models 和 input.promptLocale，并分别声明各自业务字段 | 用这两个调用点做候选试点，不推广到整条创作流水线                                                   |
| [RegenerateShotsWorkflow](../../src/shots/server/workflows/regenerate-shots-workflow.ts) | 图片子任务走 spawnAndAwaitChild，派生 variant-image 走 triggerWorkflow 并传父模型快照、enforcement 和去重键              | 作为另一种调用形状的对照，首批不把两种生命周期强行合并                                             |

这里只统计已逐处核对的两个 AnalyzeScript 子任务调用点，不用文本搜索命中量当作全部工作流的语义审查结果。它们的重复主要是显式字段传播；尚未证明引入新包装能减少维护成本。

原有触发和快照封装已经共享，不能再把新增同类封装算作 P3 的收益。若拟议修改只是将几行显式传参搬入新函数，或让读者必须跳转才能判断预占和 claim 的归属，保留当前薄调用，并记录该候选无需整理。

## 首个代码批次的候选范围

只处理 AnalyzeScript 两个子任务的语言与模型快照继承。业务 payload、父子通知、stopAt、并发顺序、step 名称、超时、reservationId、claim、deduplicationId、用户和组织权限含义均保持原契约。其它语言调用点和其它工作流不因同处一个文件而顺带改写。

候选写入范围是 AnalyzeScriptWorkflow 及其对应测试；只有在改前对照证明现有共享入口需要最小类型约束或接入调整时，才将该入口及对应测试加入同一批，并说明必要性。实现前不预设不存在的方法签名、通用 context 对象或新的插件框架。

模型值依赖仍归模型域，平台模块的模型类型导入与允许的组合根遵守既有边界。上下文只承载稳定、需要继承的信息；业务生命周期字段保留在可见的业务调用点。不得通过展开整个 input 或 ScopedDb 来替代明确字段选择。

## 改前与改后对照

| 契约             | 可复用的现有验证入口                                                                                                                                                                                                                                                | 首批仍需确认的内容                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 原分析流程       | [analyze-script-workflow.test.ts](../../src/sequences/server/workflows/analyze-script-workflow.test.ts)、[鉴权失败测试](../../src/sequences/server/workflows/analyze-script-workflow-auth-failure.test.ts)                                                          | 保留 P1 恢复的原执行保障：style 失败前拆分已落地、stopAt、cast 写入、衍生提示词与失败路径；不以新上下文断言替换原断言  |
| 请求可信配置     | [client.test.ts](../../src/platform/server/workflow/client.test.ts)、[client.compliance.test.ts](../../src/platform/server/workflow/client.compliance.test.ts)                                                                                                      | body 无法覆盖可信快照；父快照不被管理员后续修改替换；不同语言并发不串用；enforcement 仍在原路径执行                    |
| 子任务继承与恢复 | [await-child.test.ts](../../src/platform/server/workflow/await-child.test.ts)                                                                                                                                                                                       | 中英文分别继承；子 body 自带配置被父配置覆盖；重放、已存在实例、丢通知与失败语义保持；两个试点真实调用点都接受契约对照 |
| 快照编解码与凭证 | [文本路由测试](../../src/models/workflow-text-model-routing.test.ts)、[图片路由测试](../../src/models/workflow-image-model-routing.test.ts)、[scoped-workflow-models.test.ts](../../src/platform/server/db/scoped-workflow-models.test.ts)                          | 文本/图片路由、能力和参数、credentialId 及供应商 USD 价格的语义不变；无扩展与空路由分支保持；执行期间不读可变渠道配置  |
| 消费与失败边界   | [base-workflow.test.ts](../../src/platform/server/workflow/base-workflow.test.ts)、[no-mid-run-reads.test.ts](../../src/platform/server/workflow/no-mid-run-reads.test.ts)、[claim-discipline.test.ts](../../src/platform/server/workflow/claim-discipline.test.ts) | 无效语言在执行前拒绝；执行及失败处理使用同一模型快照；不新增未分类读取或选择指针写入                                   |

上述是已存在的源码与测试入口，不能仅由测试名称认定全部场景已覆盖。实施前检查具体断言；存在缺口时先补能约束当前行为的对照，再整理结构。仅新增新代码自身的镜像测试不满足验收。

进入代码批次时先运行本表对应的 bun run test 定向验证并冻结实际结果、源 SHA 和必要的输入/输出。改后运行同一对照；涉及的类型、lint、边界及正常提交 hooks 按实际 diff 执行。只有代码或故障影响到页面/真实工作流引擎行为时，扩大到对应本地回放；本地 Mock 不证明真实供应商、远程 D1 或生产恢复。

## 验收与停止条件

每一批单独说明原行为、动机、最小 diff、前后对照和升级冲突点，并单独提交。测量实际减少的传播重复、核心接入点或未来新增入口必需手改的地方；新增 helper 数和移动文件数不作为收益。

只有行为对照通过、没有扩大凭证/语言语义、并且实际维护负担下降时，才算完成这一小步。收益不足、接口更难看懂或必须重写上游执行骨架时，保留原实现，改选下一项候选；这不阻断正常上游同步。

后续顺序仍按主计划：模型域渠道执行决策、单镜头生成准备、翻译维护。每项进入前重新固定受影响范围和证据，不把首批准备扩展为这些工作的代码实施授权。人民币销售计价、禁止 BYOK、默认私有、持续 CI 和新上游合入仍按各自阶段推进。

## 本次准备证据

本轮核对了 Git 起点、现有工作区、主计划和扩展约束、上述接入实现与测试断言位置，并执行仓库要求的 intent 本地技能清单检查。当前是文档准备，没有生产代码修改，也没有把 P2 的 19 文件/388 项历史结果写成 P3 已执行结果。

准备完成时，P3 改前基线、行为对照及单测尚未执行，文档仅检查格式、本地链接和修改范围。后续首批实际执行情况、未执行的浏览器/引擎场景及最终有效结果见[首批结果](upstream-preservation-p3-context-20261109.md)，不以本准备文件代替代码验收。
