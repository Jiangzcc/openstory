# P3 G07-callers：入口矩阵复核

日期：2026-11-10。状态：已完成入口源码复核和本轮补测，仍有开放风险与覆盖边界；G07-callers、GC-07 及 P3 不标全面验收完成，P4 未开始。

## 固定范围与实际变更

- before：`02b57a441646d2c165251c1d602fd129967aa2f6`。
- 测试及功能文档提交：`f23d1b320c7d32def4d0fb21bcfb4278dd9e08e6`。
- 纯上游基线 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。
- 前置 G07-partition：`ecd0a77f787f4d0b38ab3d25da85a7ea86173882`。
- 机器记录：[implementation.json](implementation.json)。
- 18 项入口及证据边界：[caller-matrix.json](caller-matrix.json)。
- 原上游对照和开放风险：[inherited-risks.json](inherited-risks.json)。

本批沿现有 MODEL-SNAPSHOT-CONTRACT 核对 Update all preview/run、MCP plan/execute/status、smart retry 的 full/image/motion/music/music-prompt 分支，以及追加和切换 image/video/audio。19 个相关生产源码文件在 before/after 完全一致，逐文件指纹写入机器记录。没有改工作流 payload、codec、claim、预留、扣费、释放或派发控制流，也没有引入 G06 的请求级统一捕获。

实际改动只有一项测试增强和两处旧文档校正：

1. 原 Continue plan/execute/mutex 用例增加 3 处断言：priced=false 时展示 null，但 plan 和 execute 都以 synthetic 的 200000 微美元检查平台余额，providers=[]；原启动与 mutex 拒绝断言保留。
2. 功能文档将 Update all 的门槛写回真实实现：max(原 sequence 模型单图 floor, configured 请求单图最大值)，与展示估算分开。
3. 功能文档澄清稳定图片 replay 保留已有 hold；仅清理本次多余或失败触发的新 hold，保留等待首次 trigger acknowledgement 时的原 hold。

## 不同费用职责的复用边界

| 调用族                      | 原有费用职责                                 | 本轮判定                                            |
| --------------------------- | -------------------------------------------- | --------------------------------------------------- |
| Continue / fresh            | 整个计划图片小计，再扣除四类图片 counts      | 已由前一批统一到 partitionPlanImageEstimate         |
| Update all preview          | 按层展示，未知组件可使展示值为 null          | 保留 preview；底层报价和 sheet 投影继续复用 billing |
| Update all launch           | 启动 floor，不是整个计划总价                 | 保留原 prepareUpdateStale                           |
| smart retry image           | 逐图实际输入报价，每图独立预留及 replay 归属 | 保留已有 configured 报价原语和原资金边界            |
| full retry / motion / music | storyboard 或 batch 或单曲的费用与预留       | 分别保留原估算和预留职责                            |
| add image / video / audio   | 每图、整批视频、单曲的 alternate 生成        | 分别保留原组织、claim、partial 和失败清理边界       |
| set image / video           | 选择已完成存储版本                           | 没有生成费用或新的 workflow                         |

本批没有再删除一份生产重复实现。核对结果是其他入口的 nullable display、floor、per-item hold 和 batch envelope 并不同义，继续消费既有报价原语；完整计划 count 分区只适用于前一批的两处调用。没有通过改造这些控制流增加表面上的共用调用数量。

## 现有配置快照契约

图片和 full 准备阶段已捕获的配置继续用于报价与对应 dispatch；其他直接操作按现有 workflow client 在各自触发边界捕获。client 将服务端快照打包到任务，base 解码已排队的配置，不重新读取 live catalog；父 workflow 通过 scopedDb.models 传递给孩子。codec 的嵌套参数、USD 价格以及 v1/legacy 读取行为保留。

这没有证明整个请求的所有 native 分支都在最早入口共用同一份配置；G06-capture 仍是独立计划。没有把本轮现有契约复核改成 G06 的新实现，也没有修改用户暂缓的 CONTINUE-LLM-SOURCE。

## 验证及明确边界

- 核心入口：4 文件、36 项通过。
- 跨入口集成：18 文件、249 项通过，含真实内存 D1 的 retry hold、模型选择、MCP digest/partial/status、图片分辨率、codec、client/base 和父子 workflow 单元测试。供应商和 Workflows 引擎仍是 mock。
- 原 generation-operations 测试的 66 处 matcher-call AST 全部保留，增加为 69 处。文件 781 行，修改的用例函数 36 行。
- bun typecheck 和正常提交钩子的 typecheck/lint/format/knip/client-server-boundary 均通过；本批格式检查通过。
- 生产构建复用前一批的成功记录：本批仅改测试与文档，19 个相关运行时源码指纹及两项既有工作区改动的字节指纹保持。没有为未改变的生产源码再跑一次构建，也没有声称本轮重新检查全仓格式。
- 追加 video 的费用/reserve/dispatch 编排没有独立集成测试，现有测试只覆盖 duplicate/eligibility helper；两个 set 入口是源码证据。追加图片的部分启动与额度不足分支本轮也主要是源码复核。矩阵逐行标明，未写成全部编排动态通过。

## 三类原上游继承风险仍开放

以下风险的关键 claim/estimate 调用 AST 在 B 与当前版本完全一致，本批没有修复或改变这些行为。

1. **音乐 claim 异常后的新 hold 清理。** 追加 audio 和 smart music 都先 reserve，claimMusic 位于后续 trigger 清理保护之外；claim 抛错时缺少该路径的显式释放。结论来自源码及 AST，对真实 D1 claim-rejection 没有故障注入；未断言预留会永久保留。
2. **Motion 估价时长与发送时长。** smart 使用模型默认/最小时长，add video 使用固定 5 秒，再与 edit 下限取大；发送 payload 使用 shot 的实际时长。Seedance 2.5 的 smart 默认是 4 秒，并非 5 秒。
3. **Motion 估价引用路由与发送引用。** smart 未传 hasReferenceImages，add video 的判定不含 location；真实引用可能让发送使用更贵的 reference route。

后两类另有 4 个隔离纯估算探针通过，使用明确标注的 synthetic 费率，未调用供应商。首次探针误认为 smart 默认 5 秒，按真实 duration grid 修正为 4 秒后复跑通过；探针源文及命令保存在风险记录，属于已知状态诊断，不把有问题的行为固化为常规回归目标。

这些是独立的行为修正事项。当前结构治理受“重构禁止改变外部行为”的任务约束；原上游风险单列，不当作 G07-partition 引入的问题，也不记为已经修好。是否及如何修复，应由单独的 bug 变更明确其预估和额度归属契约，并先补相应失败/长片/引用编排回归。

## 全量状态

G07-partition 已完成；本轮 G07-callers 的状态为 reviewed-with-open-risks。冻结全量设计 S、1,219 项 pending inventory 均不改，也不按整文件或 GC-07 批量语义批准。当前实施状态追加到 [台账](../p3-implementation-log.jsonl)。独立后续候选为 MC-B01；G09-ownership-verify 仍按其 G03 前置处理。P3 整体进行中，P4 未开始。

没有推送、真实供应商调用、远程写入或部署。源码、单元和构建证据不代替浏览器端到端、真实引擎重放及真实供应商验收。
