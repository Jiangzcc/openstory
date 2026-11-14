# P3 / GC-03 Storyboard 生命周期分支归属

本批承接 [launcher ownership](../20261114-p3-g03-launcher-ownership/README.md)，处理父任务启动、余额不足、完成及分析子任务失败的 sequence 写入。源码提交为 `9d73a09f94e971426bf523d1fcf08607632067f1`；GC-03/P3 保持 in-progress，P4 未开始，冻结 inventory 未批准。

## 原有行为与本批范围

上游既有 Storyboard runImpl 在读取 sequence 存在后，分别删除 shots、写 processing 和 generationStopAt；完成时无条件写 completed 与活动记录。之前的父失败及 launcher guard 并不保护这些分支。旧任务可以在新 owner 已取得 slot 或子任务已写 failed 后继续覆盖它们，且完成日志、complete 事件和 ready email 会跟着误执行。余额不足分支也会无条件改 failed。AnalyzeScript 自己的实例 ID 属于子流程，不能当成 sequence 根 owner；其旧失败处理会先于父失败 hook 无条件写 sequence。

这是既有流程缺口的二开修正，目标是保留原任务业务语义并让选定的 lifecycle 写入具有明确归属，不计为新增创作能力。本批不合入新上游、不改变 provider、计价、schema、公开 API/MCP 或父子通知协议。

## 实现与原有语义

[独立生命周期 DB 模块](../../../../src/sequences/server/db/storyboard-lifecycle.ts)通过原 sequences factory 暴露三个窄方法，共用组织、sequence、实际 instance ID / 可信 raw claim 的条件。既有 failWorkflowIfCurrent 迁入此模块，签名及 failed/completed 保护保持；没有添加另一套生命周期引擎。

- startWorkflowIfCurrent 只接受当前 processing owner。fresh 的 status/error/stopAt、原设置变更活动与受相同条件限制的 shots 删除在同一 D1 batch 提交或回滚；resume 保留 shots。只有实际改变 stopAt 才记活动，from 值由事务内 insert-select 直接读取当前行，保留 null；相同输入重放及 guard miss 不记活动。未命中时父流程释放本 payload 的 reservation，然后在 poster/child 之前返回。原存在性读取继续负责 deleted / organization access 语义，不充当 ownership guard。
- completeWorkflowIfCurrent 将受条件限制的 storyboard.completed 活动、processing → completed 和本次完成凭证查询放在同一 batch。event ID 沿用原 durable step 产生的稳定 ID。同 owner、completed 及同 event ID 可认出 DB 已提交但 checkpoint 未完成的重放：返回 true，不重复活动或状态写入。其他 owner、failed 或没有本次 event 的 completed 返回 false；父流程据此跳过 complete 和 ready email。
- 余额不足改用既有 failure guard，命中才发送原 reservation:short；原 top-up 句子、WorkflowLoggedError 以及不把它变成 generic failure toast 的约定保留。
- 父流程从自身 event.instanceId 和 input.workflowClaimId 构造 storyboardOwner，显式传给 AnalyzeScript。子失败按根身份调用 guard，保留供应商鉴权文案及凭证/预占清理；未命中不发送 sequence 的 generation.failed。缺 owner 但有真实 Storyboard _parent 的旧 child 仅可匹配其 parentInstanceId，不能猜 raw claim。未知 parent 且不能证明 owner 时跳过该 sequence 写入；无 owner 且无 parent 的独立 CLI 入口保留旧失败路径。_parent 仍只指直接父级，后代通知不会改指 Storyboard。

设置活动继续使用原 SETTINGS_CHANGED_EVENT、actor、fields/changes 和同一文案函数；现有条件 event builder 只增加可选 SQL data，用于在事务中生成真实 from/to，旧调用保持原常量 data 语义。

不采用“读 owner 后再无条件写”的外层检查，因为它仍有竞态。DB 事务只包围原有写入及其必要日志，不把网络、模型、realtime 或邮件塞进数据库操作。完成操作的重放凭证用于已提交事务的判定，不新增租约、阈值或时序等待。

## 验证证据

新增 [父生命周期并发回归](../../../../src/sequences/server/workflows/storyboard-lifecycle-ownership.test.ts)及[分析失败归属回归](../../../../src/sequences/server/workflows/analyze-script-failure-ownership.test.ts)，使用真实 createTestDb、既有 migrations 和实际 sequences DB 方法。工作流 step/checkpoint、AI、child 派发、凭证、reservation、realtime 和 email 均按测试实际范围标明 host-side 替身，不产生真实消费或发送。测试内 synthetic SQLite trigger 用于证明失败传播与 batch 回滚，确定性 step 边界切换 owner，不依赖等待或调整 timeout。

父运行时仍使用旧调用时，真实 DB 的 12 项用例有 8 项行为失败、4 项通过；另有迁移后的编排接口断言 29 项中 7 项失败。该阶段已增加尚未接入的 DB 模块，未把“方法尚不存在”算成并发失败。父接入后的 3 个既有文件共 66 项通过；新增 25 项与旧父/failure 合计 70 项通过。第一轮综合 36 文件、561 项通过后，独立审查发现新启动路径遗漏原 stopAt 设置活动，补充的 5 项中有 3 项复现遗漏、2 项通过，随后恢复该语义并补入事务。初次类型检查发现的测试夹具必填字段/字面量推断及未使用变量也已按真实源类型修正，未放宽生产类型。最终结果见 [验证记录](verification-results.json)，详细路径、断言迁移、身份及开放范围见 [实现记录](implementation.json)。

最终 36 个文件、566 项全部通过；补齐原完成活动文案/target 的真实 DB 断言后，父生命周期文件 30 项再次通过。新增用例共 54 项（父生命周期 30、分析归属 18、parented auth 6）；原 auth 12 项与父 failure 区块保留。类型、11 份源码/测试定向 lint 与格式、diff、client/SSR 构建及正常提交 hooks 全通过，hooks 另跑 17 项边界测试。冻结的 5 份 inventory、1,219 项仍全部 pending，不因本批回归自动批准。

## 仍开放的边界

- 未发布 raw claim 仍可被后续请求按 no_binding/failed 接管；本批只保护已列出的写入，不构成严格启动互斥或对在途任务的取消。poster、analysis 内容写入及后代通知也没有被本批全部守卫。
- complete 的 DB 凭证解决数据库提交后重跑该 DB 操作的幂等判定；workflow 已缓存成功后重放、或新任务在 guard 成功之后接管，仍可能先于外部事件/邮件。failure/short guard 首次落终态后遇到发送失败，再次执行可能因 terminal 状态跳过通知；realtime adapter 吞普通错误、事件缺少 run identity、reducer/历史旧事件问题仍在。
- 无父独立 AnalyzeScript CLI 没有 sequence slot 协议，其旧失败写入不具备本批根任务并发保护。脚本本来还缺 cast、stopAt 等必填 payload，本批未把该入口说成已验证可用，也未擅自删除或扩展它。
- Continue 设置保存/拒绝回滚、独立 Update all 预检及“create 已成功、publication SQL 失败”的外围恢复仍开放；已有单路径包装测试不能证明它们并发安全。
- 未运行真实 Cloudflare durable replay/restart、Workerd HTTP、多实例 D1 竞争、浏览器送达、provider 或钱包最终结算。没有 push、部署、远程 D1/R2 写入或真实模型调用。

本批闭合的是以上选定写入的有限本地证据；P3 仍须按全量差异与职责判据继续，不能以此批准冻结清单或开始 P4。
