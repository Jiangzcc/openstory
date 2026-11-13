# G03 LocationSheetWorkflow 失败归属证据（2026-11-14）

本批继续执行 P3 的 G03，为 LocationSheetWorkflow 的失败生命周期补充有限动态证据。测试直接调用真实 `onFailure`，核对当前 claim、缺少 claim 的历史任务、Location 页面无 sequence 时的独立频道，以及 realtime 广播失败时的清理顺序；ScopedDb、realtime channel 和持久工作流引擎使用替身。

## 覆盖内容

- 当前 claim 失败时，按 location id 和本次 `referenceVersionId` 清理 claim，并在 sequence channel 广播 `generation.location-sheet:progress` 的 failed 事件；
- 兼容没有 `referenceVersionId` 的历史任务，按 `null` 清理并使用 `location:<id>` 自有频道；
- failed 事件发送异常时，`onFailure` 仍然完成 claim 清理并正常返回；
- 已有 `sheet-provenance-contract.test.ts` 对 LocationSheetWorkflow 的成功 runImpl、真实 provenance D1 和模型/渠道边界继续保留，本批只补失败归属。

本批没有修改生产代码，也没有改变 locations scoped-db 的 claim 条件更新行为。

## 回归与验证

定向命令：

    bun run test src/cast/server/workflows/location-sheet-workflow.test.ts

结果为 1 个测试文件、3 项通过。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/cast/server/workflows/location-sheet-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 LocationSheetWorkflow 失败归属的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
