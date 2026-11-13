# G03 MotionBatchWorkflow 部分失败收敛证据（2026-11-14）

本批继续执行 P3 的 G03，为 MotionBatchWorkflow 的 child 部分失败分支补充有限动态证据。测试执行真实 `runImpl`，令 motion child 拒绝而 music child 仍完成，核对 `Promise.allSettled` 继续收敛、reservation 清零和 sequence 结果返回；child 的持久执行和真实供应商使用替身。

## 覆盖内容

- motion child 失败后不会让整个 batch 直接失败；
- 父流程仍等待并收敛 sibling child；
- reservation 在部分失败结果后仍执行 `zeroReservation`；
- batch 返回原有 `{ sequenceId }` 结果；
- 前面已记录的对话阻断、父级 onFailure、失败清理和成功模型传播断言继续保留。

本批没有修改生产代码，也没有改变 MotionBatchWorkflow 的 allSettled、reservation 或结果合并行为。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/motion-batch-workflow.test.ts

结果为 1 个测试文件、5 项通过，其中新增 1 项部分失败收敛断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/motion/server/workflows/motion-batch-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 MotionBatchWorkflow 部分 child 失败仍完成 batch 的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
