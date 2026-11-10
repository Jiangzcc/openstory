# P3 MC-B01：完整图片请求能力接纳收敛

日期：2026-11-10。状态：MC-B01 结构批次已完成；MC-09 全职责及 P3 仍进行中，P4 未开始。

## 固定范围与原有职责

- before：`9ee843cbb5128704c577c3e4690640aeb3ca3f31`。
- 代码及功能文档提交：`d5dfe869d15942567495253348ea0aa61e480d13`。
- 纯上游基线 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。
- [机器记录](implementation.json)；[下游契约与源码指纹](consumer-contracts.json)。

本批落实全量设计 MC-09 的 MC-B01，只处理完整图片请求的 operation verified、safe integer 参考数、上下界及 mask 条件。两份原判断分别在配置图片报价和公开费用提示中；目录探测、Studio 缺参考引导、参数解析、价卡与资金控制流有不同职责，按现有边界保留。相关 billing 模块是二开扩展，不将它们记录为上游新增能力。

## 实际变更与收益

新增 models 纯函数 imageOperationIssue，仅接 binding 的能力字段、显式 operation、实际 referenceImageCount 和 hasMask，返回中性失败原因或 null。报价包装保留原三条 ValidationError 及 operation → references → mask 优先级；费用提示保留原 issue 和模型可用性优先于 undefined 参考数待加载的顺序。

两份完整谓词收敛为一个来源，两个包装保留。这是职责所有权收益；本批没有减少既有上游核心修改路径，也没有运行新上游合并或证明未来冲突数量下降。三个生产路径和一个测试路径之外，仅更新功能文档。新增两条 src 路径归入 MC-09 的实施增量，不改冻结 inventory。

原两个测试文件完全未改，65 处 matcher-call AST 全部保留。两个包装之外的 8 个函数 AST 与 before 完全相同，包含报价、价格精度、总数估算、配置来源、UI 参数报价及三态包装。22 个相关下游文件的 before/after 归一化源码指纹一致。独立只读审查核对三个 UI 待加载来源、目录探测、Studio 引导以及实际参考数传递，未发现阻断项；静态审查不计作页面动态验收。

## 验证

- 改前：3 文件、51 项通过，其中新增 26 项跨层 characterization 在提取前通过。
- 改后：核心与目录/Studio server 等 10 文件、144 项通过；补充费用规格、分辨率、角色/镜头参考数及 Studio settings 5 文件、56 项通过，合计 15 个不同文件、200 项。
- 新增测试覆盖真实公开目录投影、验证状态、最小/最大参考数、负数/小数/NaN/无穷数/unsafe integer、mask 条件、错误优先级、edit-only 零参考和 undefined 待加载。使用明确标注的 synthetic 能力与 USD 价格，没有网络或凭证调用。
- 新测试按函数 50 行约束调整分组后，其 matcher AST 不变，26 项复跑通过；没有重复计入 200 项。
- bun typecheck、bun lint、bun run build 通过；lint 146 条警告均不在本批路径。只跑本批 5 文件格式检查，未重跑全仓格式。
- 正常提交钩子通过 typecheck、lint、format、knip、client-server-boundary（17 项），无 bypass。
- 新模块 40 行、纯函数 27 行、圈复杂度 9、控制嵌套 1；新测试 218 行，各函数均不超过 50 行。本批所有 TS 文件与函数满足既定规模上限。

## 剩余事项

MC-09 不按此批做整职责或整文件语义批准。冻结设计 S 的 1,219 条 inventory 仍全部 pending，实施增量写入 [追加台账](../p3-implementation-log.jsonl)。G07-callers 的继承风险及编排测试边界保持开放，G09-ownership-verify 仍等待 G03-verify，用户暂缓的 CONTINUE-LLM-SOURCE 不变。下一独立候选为 MC-B02。

未推送、部署、远程写入或调用真实供应商；本地测试与构建不代替浏览器、真实引擎重放及供应商验收。两项原有工作区修改的字节指纹保持。
