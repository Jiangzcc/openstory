# G03 ShotSpecRewriteWorkflow 失败清理证据（2026-11-14）

本批继续执行 P3 的 G03，为 ShotSpecRewriteWorkflow 的失败生命周期补充有限动态证据。测试直接调用真实 `onFailure`，核对 spec claim、visual/motion prompt claim、依赖 variant 的清理，以及开启 streaming 时 visual/motion 两类失败事件；ScopedDb 和 realtime channel 使用替身。

## 覆盖内容

- 失败时按 shot id 和 claim id 清理重写 spec claim；
- visual claim 标记为 failed，并取消依赖它的 frame variant；
- motion claim 标记为 failed；
- `emitStreaming` 开启时，向 shot prompt channel 发送 visual 和 motion 两条 `shotPrompt.failed`；
- 原有成功 runImpl 的 LLM 快照、spec promote 和 derived prompt 重建断言继续保留。

本批没有修改生产代码，也没有改变 claim 清理、variant 取消或失败事件行为。

## 回归与验证

定向命令：

    bun run test src/shots/server/workflows/shot-spec-rewrite-workflow-run.test.ts

结果为 1 个测试文件、2 项通过，其中新增 1 项失败清理断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/shots/server/workflows/shot-spec-rewrite-workflow-run.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 ShotSpecRewriteWorkflow 失败 claim/事件收敛的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
