# P3 G06-auxiliary：元素辅助根任务复用创建快照（2026-11-13）

本批起点为 `6ab8599f9`，代码提交为 `eab55944f`。上游基线 B 为 `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`，冻结设计来源 S 为 `db3ea57b5f419f69c51369c28819de17515b21f5`。本批承接 G06-capture，继续保持 P3 `in-progress`，没有合入新上游、推送或部署。

## 原行为和问题

G06-capture 已经让 `createSequences` 在可信准备阶段取得一份完整的 `ModelRuntimeConfiguration`，并让 storyboard 预占、能力、报价、来源和根工作流使用这份配置。元素草稿挂载和复制发生在同一个创建生命周期内，但它们触发 `/element-vision` 时没有把这份配置交给 `triggerWorkflow`；workflow client 因而会在触发点重新读取当前配置。管理员若在创建准备和元素视觉派发之间修改配置，同一次创建的 storyboard 与 element vision 可能使用不同的模型、渠道、凭证引用或报价快照。

这里处理的是同次创建操作的可信配置传递，不改变元素上传的权利检查、创建顺序、失败清理或付款所有权。独立 finalize/replace 上传没有前置模型决策，仍由 workflow client 在独立根触发时做一次捕获。

## 实施范围

- `createSequences` 将已经捕获的配置传给 `attachDraftElementUploads` 和 `copySequenceElements`。
- 两个元素辅助服务新增可选的内部 `modelConfiguration`，只有收到可信快照时才在 `/element-vision` 触发选项中传递它；没有快照时继续使用原来的两参数调用，让 workflow client 自己捕获一次。
- 元素视觉 workflow 的公开 payload 没有增加配置字段；客户端不能注入 trusted snapshot。
- `upload-check` 的两个存储入口仍在对象成功落盘后启动独立根 workflow，依靠现有 `triggerWorkflow` 无选项回退一次捕获配置；本批只做了调用和边界核对，没有重复造 loader。
- `element-sheet` 只有 `UpdateStaleShotsWorkflow` 的 awaited child 派发，现有 `modelConfiguration: scopedDb.models` 已满足父快照传递；本批没有改它，也没有机械传递 `ownsReservation`。

元素上传仍先通过组织路径、R2 存在性和权利检查；创建成功后的元素行写入、vision 派发、storyboard 触发以及 `releaseReservationOnThrow` 的失败清理顺序保持。`promptLocale` 仍由可信调用方显式传入。

## 证据

[调用矩阵](caller-matrix.json) 区分同次创建、独立上传、upload-check 和 element-sheet child。新增回归覆盖配置从创建核心到两个辅助根的传递，并覆盖元素视觉触发的原有调用形状。固定定向集合为 12 个测试文件、98 项，98 通过、0 失败、0 跳过；其中本批修改的 3 个测试文件为 28 项，全部通过。

类型检查、全仓 lint、生产构建、6 个修改文件的格式检查和正常提交 hooks 通过。lint 输出的既有全仓警告没有作为本批失败；没有重复运行 10,192 项全仓 Vitest，因此不把 G06-capture 之前记录的 3 个范围外失败改写成当前批次证据。未调用真实供应商、远程 D1/R2、真实 Workflows 持久重放或付费结算。

源码保留证明见 [source-preservation.json](source-preservation.json)，固定测试清单见 [test-files.txt](test-files.txt)，验证细节见 [verification-results.json](verification-results.json)。1,219 条冻结 inventory disposition 仍为 `pending`；GC-06、G03、G07、GC-09、GC-14 及其它 P3 职责仍未整体关闭，P4 未开始。
