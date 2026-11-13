# G03 CharacterBibleWorkflow 失败归属修复（2026-11-14）

本批继续执行 P3 的 G03，复核 `CharacterBibleWorkflow` 的 sheet/voice child 失败生命周期。原实现对 sheet claim 只保留 `versionId`，丢弃 `claimSheet` 返回的 `held`；child 未启动时，父级通过 `Promise.allSettled` 收敛结果但没有清理本次 claim，也没有发送失败事件。voice child 的 catch 还会把已经由 child `onFailure` 处理的错误再次写入 husk。

## 改动

- 保留 sheet claim 的 `{ versionId, held }` 结果；父级只在本次运行持有 claim，或旧任务没有 claim 时调用 `failSheetClaim`；`held: false` 不触碰新运行的 claim；
- sheet child 创建失败、绑定缺失或等待超时仍未进入子级终态时，由父级补发 `generation.character-sheet:progress` failed 事件；
- `spawnAndAwaitChild` 返回 `Child workflow … failed: …` 时沿用 child failure 归属，避免父级重复广播；realtime 发送异常只记录日志，不覆盖原始失败；
- voice child 已经由自身 `onFailure` 终结 husk 时，父级不再用包装后的 child 错误覆盖原始失败；voice child 未启动的原有 husk 清理仍保留。

本批没有改变 `claimSheet`、`failSheetClaim` 或 `markVoiceClaimTerminal` 的 D1 条件更新实现，也没有改变 CharacterSheetWorkflow / CharacterVoiceWorkflow 的 payload 契约。

## 动态证据

`character-bible-workflow.test.ts` 执行真实父级 `runImpl`，用 host-side child helper、ScopedDb、step 和 realtime channel 替身覆盖：

- held sheet child 未启动时，按 character/look claim 清理并在 sequence channel 发送 failed 事件；
- child-owned sheet failure 不重复广播；
- sheet failed 事件发送异常不影响 failed 结果和 claim 清理；
- `held: false` 的并发 claim 不被父级清理或广播；
- child-owned voice failure 不重复写入 voice husk，未启动 voice child 的原有清理断言仍通过。

这些测试证明父级组合逻辑和错误归属，不等同于真实 Cloudflare durable replay、远程 D1/R2 或真实 provider 验收。

## 回归与验证

定向命令：

    bun run test src/cast/server/workflows/character-bible-workflow.test.ts
    bun run test src/cast/server/workflows/character-bible-workflow.test.ts src/cast/server/workflows/character-sheet-workflow.test.ts src/platform/server/workflow/await-child.test.ts

结果分别为 1 个测试文件、13 项通过，以及 3 个测试文件、55 项通过。另通过：

- `bun typecheck`；
- `bun lint`，仅有仓库既有 warning；
- `bunx oxfmt --check src/cast/server/workflows/character-bible-workflow.ts src/cast/server/workflows/character-bible-workflow.test.ts`；
- `git diff --check`；
- `bun run build`；
- 正常 pre-commit hooks，未绕过。

真实 Cloudflare durable replay、Workerd authenticated HTTP、真实 fal/native provider、远程 D1/R2、浏览器 UI 和钱包结算仍未验证。

## 状态和边界

本批关闭 CharacterBibleWorkflow sheet/voice child 失败归属的有限生产缺口，不关闭 GC-03。其它父工作流生命周期、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending，P3 仍在进行中，P4 未开始。
