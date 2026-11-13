# G03 Lip-sync 失败通知隔离（2026-11-14）

本批继续执行 P3 的 G03，处理 LipsyncWorkflow 的 failure hook。原实现先读取 shot/render segment、清理 pending promote、写失败 video variant，再发送 `generation.video:progress`；任一清理或持久化操作失败都会阻断失败通知，而且通知所需的 sequence id 没有直接使用任务 payload 中已冻结的值。

## 改动

- `persistLipsyncFailure` 接收并使用 payload 的 `sequenceId`，失败通知不再依赖 shot lookup 成功；
- shot、render segment、pending promote、失败 video variant 和 rowless failed version 的维护统一作为 best-effort 失败状态处理；
- 失败状态维护异常只记录日志，仍继续发送 `generation.video:progress` failed；realtime 发送异常继续单独隔离；
- 保留 lip-sync 失败版本的 `source: 'lipsync'`、模型字段、claim ownership 和原有父级 child failure 归属。

## 动态证据

新增 LipsyncWorkflow failure hook 测试：

- video failure row 写入拒绝时，仍发送带 shot/error 的 video progress failed；
- shot lookup 拒绝时，仍使用 payload sequence id 发送 video progress failed；
- 既有 MotionWorkflow lip-sync child failure ownership 和 `persistMotionFailure` 相关断言继续通过。

这些测试证明 lip-sync failure hook 的状态维护与用户可见通知隔离，不等同于真实 Cloudflare durable replay、远程 D1/R2、Workerd authenticated HTTP 或真实 fal provider 验收。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/lipsync-workflow-failure.test.ts

结果为 1 个测试文件、2 项通过。相关回归命令：

    bun run test src/motion/server/workflows/lipsync-workflow-failure.test.ts src/motion/server/workflows/motion-workflow.test.ts src/motion/server/workflows/motion-workflow-persist.test.ts

结果为 3 个测试文件、60 项通过。另通过：

- `bun typecheck`；
- `bun lint`，仅有仓库既有 warning；
- `bunx oxfmt --check` 覆盖本批 2 个源文件；
- `git diff --check`；
- `bun run build`；
- 正常 pre-commit hooks，未绕过。

真实 Cloudflare durable replay、Workerd authenticated HTTP、真实 fal provider、远程 D1/R2、浏览器 UI 和钱包结算仍未验证。

## 状态和边界

本批关闭 LipsyncWorkflow failure hook 清理异常导致 failed 通知丢失的有限生产缺口，不关闭 GC-03。其它父工作流生命周期、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending，P3 仍在进行中，P4 未开始。
