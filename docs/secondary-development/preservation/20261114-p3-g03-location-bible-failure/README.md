# G03 LocationBibleWorkflow 父级失败事件归属修复（2026-11-14）

本批继续执行 P3 的 G03，复核 `LocationBibleWorkflow` 在 location sheet 子工作流失败时的父子失败归属。原实现会在父级 catch 中条件清理 claim，但 `runImpl` 随后用 `Promise.allSettled` 收敛结果并成功返回，因此父级 `onFailure` 不会补发失败事件。子工作流未启动或等待超时仍未进入终态时，Locations 页面可能只看到数据库失败状态而收不到 `generation.location-sheet:progress` 的 failed 通知。

## 改动

- 父级在 claim 属于本次运行，或历史无 claim 任务需要兼容时，继续按原版本条件调用 `failReferenceClaim`；`held: false` 仍不触碰其他运行持有的 claim，也不由父级发事件；
- `spawnAndAwaitChild` 返回带有 `Child workflow … failed: …` 归属信息时，视为子级已经负责失败生命周期，父级不重复广播；创建失败、绑定缺失或等待超时仍未进入子级终态时，由父级补发 `generation.location-sheet:progress` failed 事件；
- 父级补发事件采用 best effort，realtime 发送异常只记录日志，不覆盖原始 child/spawn 错误；
- 没有改变 LocationSheetWorkflow 自身 `onFailure`、claim 条件更新或工作流 payload 契约。

## 动态证据

`location-bible-workflow.test.ts` 直接执行真实父级 `runImpl`，仅替换 child helper、ScopedDb、step 和 realtime channel：

- 子级未启动时，claim 使用 `guarded` 版本清理，并在 `sequence-1` channel 发送 failed 事件；
- 子级自身失败时，父级识别 `isChildFailureError`，不重复发送事件；
- failed 事件发送失败时，原始 `spawn refused` 仍用于 claim 清理，父级结果仍收敛为 failed；
- claim 未持有时保持原有并发语义：不清理其他运行的 claim，也不补发父级失败事件；
- claim 步骤自身异常的历史兼容路径仍保留。

本批是一个生产代码修复批次；测试中的 Cloudflare workflow、D1 和 realtime 均为 host-side 替身，不等同于真实 durable engine 或远程环境验收。

## 回归与验证

定向命令：

    bun run test src/cast/server/workflows/location-bible-workflow.test.ts
    bun run test src/cast/server/workflows/location-bible-workflow.test.ts src/cast/server/workflows/location-sheet-workflow.test.ts src/platform/server/workflow/await-child.test.ts

结果分别为 1 个测试文件、14 项通过，以及 3 个测试文件、49 项通过。另通过：

- `bun typecheck`；
- `bun lint`，仅有仓库既有 warning；
- `bunx oxfmt --check src/cast/server/workflows/location-bible-workflow.ts src/cast/server/workflows/location-bible-workflow.test.ts`；
- `git diff --check`；
- `bun run build`；
- 正常 pre-commit hooks，未绕过。

真实 Cloudflare durable replay、Workerd authenticated HTTP、真实 fal/native provider、远程 D1/R2、浏览器 UI 和钱包结算仍未验证。

## 状态和边界

本批关闭 LocationBibleWorkflow 子级未启动/子级自失败的有限 host-side 失败事件归属缺口，不关闭 GC-03。其它父工作流生命周期、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending，P3 仍在进行中，P4 未开始。
