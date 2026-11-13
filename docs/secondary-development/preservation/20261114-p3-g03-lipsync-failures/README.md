# G03 MotionWorkflow lip-sync 失败生命周期证据（2026-11-14）

本批继续执行 P3 的 G03，为 MotionWorkflow 成片后的 lip-sync 子工作流失败归属补充两个动态对照。测试在 host-side workflow stub 下执行实际 runImpl，分别模拟子任务已记录自身失败，以及子任务因 binding/spawn 问题根本没有启动；不启动 Cloudflare durable engine。

## 覆盖内容

- 子任务返回带有 Child workflow ... failed 前缀的失败时，父任务不重复追加 source=lipsync、status=failed 的版本；
- 子任务未启动时，父任务追加失败 lip-sync 版本，并向 generation.video:progress 广播失败消息；
- 两条分支都保留已经完成的原 motion 结果和父任务正常返回语义。

本批没有修改生产代码，也没有改变 child failure message 判定、失败版本字段或广播行为。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/motion-workflow.test.ts

结果为 1 个测试文件、44 项通过，其中本批新增 2 项失败生命周期断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/motion/server/workflows/motion-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 LipsyncWorkflow durable replay、真实 fal 供应商、远程 D1/R2、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 MotionWorkflow lip-sync child failure ownership 的有限动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
