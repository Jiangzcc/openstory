# G03 MotionBatchWorkflow 失败清理证据（2026-11-14）

本批继续执行 P3 的 G03，为 MotionBatchWorkflow 的父级失败收敛补充有限动态证据。测试直接执行真实 `onFailure`，核对有 reservation 时释放预占并向 sequence 广播 `generation.failed`，以及 reservation 清理本身失败时仍继续通知用户；持久工作流引擎、钱包 D1 和 realtime channel 使用替身。

## 覆盖内容

- 失败 hook 在 `reservationId` 存在时调用 `zeroReservation`；
- 同一失败路径向 `sequenceId` 对应频道发送 `generation.failed` 和原始错误消息；
- reservation 清理抛错时，失败通知仍然发送，避免余额清理异常吞掉用户可见的失败状态；
- 原有成功的 motion/music child 派发、父模型配置传播和 reservation 正常收尾断言继续保留。

本批没有修改生产代码，也没有改变 MotionBatchWorkflow 的 reservation 或失败事件行为。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/motion-batch-workflow.test.ts

结果为 1 个测试文件、3 项通过，其中新增 2 项失败清理断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/motion/server/workflows/motion-batch-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 MotionBatchWorkflow 父级 reservation/failed-event 收敛的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
