# G03 MotionBatchWorkflow 对话音频阻断证据（2026-11-14）

本批继续执行 P3 的 G03，为 MotionBatchWorkflow 的对话音频缺失分支补充有限动态证据。测试执行真实 `runImpl`，模拟一个 voiced shot 没有匹配 take，核对父级确保 render segment、写入 terminal motion failure、抛出阻断错误，并且不派发 motion/music child；ScopedDb、child binding 和持久工作流引擎使用替身。

## 覆盖内容

- 对话音频缺失时为尚未有 render segment 的 shot 调用 `ensureForShot`；
- 以父 workflow run id 和实际 motion model 写入 `persistMotionFailure`；
- 父流程抛出明确的 dialogue blocking 校验错误；
- motion/music child fan-out 在阻断前不会发生；
- 前一批 reservation 失败清理和 failed event 断言继续保留。

本批没有修改生产代码，也没有改变对话音频缺失时的阻断、失败记录或派发顺序。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/motion-batch-workflow.test.ts

结果为 1 个测试文件、4 项通过，其中新增 1 项对话阻断分支断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/motion/server/workflows/motion-batch-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 MotionBatchWorkflow 对话音频缺失阻断的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
