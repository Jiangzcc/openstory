# P3 / GC-03 Storyboard 启动所有权

本批承接 [Storyboard failure guard](../20261114-p3-g03-storyboard-failure-guard/README.md)，处理启动器取得 claim 后的 processing 写入与最后实例 ID 回写。源码提交为 `452a13031cacff939fb24f968bde5faf5d37d0fa`；GC-03/P3 仍在进行中，P4 未开始，冻结 inventory 未批准。

## 原有行为与根因

上游既有启动器先 CAS 写入 raw claim 和启动 activity，再单独调用 updateStatus(processing)。processing 写入失败时，claim/activity 已提交；若其他任务在两步之间接管，旧请求又会重置其状态和错误。create 返回后，启动器还会无条件回写 workflowRunId，可能把较新任务标识换回旧任务。上一批父失败 guard 不保护这些启动器操作。

现有调用方使用“本次实际创建的实例 ID”追踪任务，而不是要求它永远等于 sequence 当前 slot。若 create 已成功，只因发布 CAS 未命中就抛启动失败，会让 Continue 回滚设置，并让调用方漏收一个已创建任务。普通 CAS 未命中与真实 SQL 异常必须区分。

## 实现与保留契约

[序列 DB 方法](../../../../src/sequences/server/db/sequences.ts)保持 claimWorkflowSlot 签名，把 raw claim、processing 与清空 statusError 放进同一次条件 UPDATE。有启动 activity 时，沿用既有 D1 batch 一同提交/回滚；activity:null 只做该 UPDATE。activity 条件也补足组织范围，避免异组织请求恰好提供现 owner 时留下日志。

新增 publishWorkflowInstance 仅在 sequence、本组织及当前 raw claim 仍匹配时发布实际实例 ID。命中只修改 workflowRunId 与 updatedAt，保留早于 create 响应写下的 failed/completed 结果；未命中不改行。[启动器](../../../../src/sequences/server/launchers.ts)移除单独 processing 写入，使用此方法代替无条件 update；CAS 未命中仍返回已创建 ID。真实 SQL 异常继续传播，不重触发、不伪造创建失败事件，也不吞成成功。

只读审查核对 create、retry、generateShots、smart-retry、网页和 agent Continue 的调用及 getOperationStatus 的按传入 ID 查询方式，未发现依赖无条件覆盖 slot 的生产调用。Continue 的“写设置—启动—拒绝时回滚”与已创建实例 ID 的返回契约保留。

这是二开对既有启动职责的两处必要接入。另加外层读取不能使原操作原子化；本批复用 scoped-db、现有 CAS 和 D1 batch，仅增加一个窄发布方法，不复制生命周期、不新增时序阈值、lease、schema、migration、payload、provider 或公开 API/MCP。

## 验证证据

新增 [launchers-workflow-ownership.test.ts](../../../../src/sequences/server/launchers-workflow-ownership.test.ts)共 21 项。真实 createTestDb、实际 migrations、序列 DB/activity 方法、启动器和 Continue 包装执行；请求侧空领域、country、run-state 查询和工作流 engine 是明确的 host-side 替身。计划只传递，不在假 engine 中执行。SQL trigger 只在测试内注入 synthetic processing、activity、publication 错误。

修复前 13 项中复现 8 项行为失败，无测试准备错误。修复后首轮三个直接文件共 77 项通过；随后加入真实 withContinueSwitches → triggerContinue → triggerStoryboard 的发布未命中用例，证明该路径返回已创建 ID，且不因这个未命中回滚设置。最终 29 个文件、446 项全部通过。原 snapshot、active/unknown、CAS 失败不派发及 trigger 原错误/活动记录保护保留；旧独立写方法断言迁移为新的原子操作与发布契约，未放宽内容相等断言。

类型、4 份源码/测试定向 lint 与格式、diff、client/SSR 生产构建及正常提交 hooks 通过。7 份 Markdown/JSON 格式、2 份 JSON、46 条非空实施日志、186 处本地链接及源码提交的 4 个路径核对通过；原 exact content snapshot 与 custom-model 测试区块逐字保留，5 份冻结 inventory 的 1,219 项仍全部 pending。命令、红绿关系和验证边界见 [验证记录](verification-results.json)，调用契约见 [实现记录](implementation.json)。

## 仍开放的生命周期边界

- 未发布 raw claim 不匹配 CF binding 时仍被 resolveRunState 视为 failed，后来请求可在第一次 create 尚在途时接管。本批只保护这些条件写入，不证明严格互斥，也不阻止旧任务及子任务继续运行。
- Storyboard runImpl 自身启动/成功、analyze-script 子失败仍有独立状态写入；父失败 guard 与本次 launcher 发布不能代替它们的归属检查。
- Continue 设置保存/拒绝回滚与独立 Update all 的预检竞争仍需验证；本批单路径包装回归不证明并发设置安全。
- create 已成功但 publication SQL 出错的既有恢复缺口仍在；外围设置、预占和任务 ID 收集后果尚未收敛。通知重试、旧事件及历史回放不在本次 DB 发布操作内。
- 真实 Workerd HTTP、Cloudflare replay/restart、多实例并发、浏览器送达、供应商及钱包结算未验收；没有 push、部署、远程 D1/R2 写入或真实模型调用。

下一步按上述根任务、子失败和设置写入契约继续核对，GC-03/P3 保持 in-progress，不能用本批回归替代冻结清单的全量处置。
