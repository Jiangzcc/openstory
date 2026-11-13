# G03 Cast 子工作流失败清理隔离（2026-11-14）

本批继续执行 P3 的 G03，处理 LocationSheetWorkflow、CharacterSheetWorkflow 和 CharacterVoiceWorkflow 的失败钩子隔离问题。原实现先写失败 claim 或 voice husk，再发送 realtime failed 事件；如果清理写入本身失败，异常会提前结束 `onFailure`，用户可见的 failed 事件就不会发送。realtime 发送异常也可能反过来让失败钩子继续抛出。

## 改动

- LocationSheetWorkflow 清理 location reference claim 采用独立 best-effort 保护；清理失败只记录日志，仍继续发送 `generation.location-sheet:progress` failed；
- CharacterSheetWorkflow 对当前 look claim 和历史无 look 的 version claim 分别隔离清理异常；清理失败不阻断 `generation.character-sheet:progress` failed；
- CharacterVoiceWorkflow 隔离 `markVoiceClaimTerminal` 的失败；husk 清理失败仍继续发送 `generation.character-voice:progress` failed；
- 三个工作流的 realtime failed 发送也独立捕获，发送失败只记录日志，不替换原始 provider/workflow 错误；
- 没有改变 claim/husk 的条件更新语义、失败事件 payload、工作流 payload 契约或父子失败归属。

## 动态证据

本批新增的三个测试分别直接执行对应工作流的 `onFailure`，仅替换 ScopedDb 和 realtime channel：

- location reference claim 清理抛出数据库错误后，location failed 事件仍发送；
- character sheet claim 清理抛出数据库错误后，character sheet failed 事件仍发送；
- character voice husk 清理抛出数据库错误后，character voice failed 事件仍发送；
- 既有成功清理、失败广播和 payload 断言继续通过。

这些测试证明失败钩子在 cleanup error 与 notification error 之间保持故障隔离，不等同于真实 Cloudflare durable replay、远程 D1/R2、Workerd authenticated HTTP 或真实 provider 验收。

## 回归与验证

定向命令：

    bun run test src/cast/server/workflows/location-sheet-workflow.test.ts src/cast/server/workflows/character-sheet-workflow.test.ts src/cast/server/workflows/character-voice-workflow.test.ts

结果为 3 个测试文件、27 项通过。相关回归命令：

    bun run test src/cast/server/workflows/location-sheet-workflow.test.ts src/cast/server/workflows/character-sheet-workflow.test.ts src/cast/server/workflows/character-voice-workflow.test.ts src/cast/server/workflows/location-bible-workflow.test.ts src/cast/server/workflows/character-bible-workflow.test.ts src/platform/server/workflow/await-child.test.ts

结果为 6 个测试文件、86 项通过。另通过：

- `bun typecheck`；
- `bun lint`，仅有仓库既有 warning；
- `bunx oxfmt --check` 覆盖本批 6 个源文件；
- `git diff --check`；
- `bun run build`；
- 正常 pre-commit hooks，未绕过。

真实 Cloudflare durable replay、Workerd authenticated HTTP、真实 fal/native provider、远程 D1/R2、浏览器 UI 和钱包结算仍未验证。

## 状态和边界

本批关闭三个 cast 子工作流 failure hook 在清理失败时丢失 failed 通知的有限生产缺口，不关闭 GC-03。其它父工作流生命周期、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending，P3 仍在进行中，P4 未开始。
