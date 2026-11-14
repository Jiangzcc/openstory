# G03 Sequence/Audio 失败通知隔离（2026-11-14）

> 复核更正（2026-11-14）：本批历史测试只证明特定异常下仍调用了 channel emit 替身，不能证明通知送达。内部 catch 返回成功还可能使 emit-failure 提前 checkpoint，跳过清理重试；这些测试未覆盖该契约和 engine abort。后续在[失败重试契约批次](../20261114-p3-g03-failure-retry-contract/README.md)中修正传播与中断处理，原测试成绩保留其历史含义。

本批继续执行 P3 的 G03，处理 AnalyzeScriptWorkflow、StoryboardWorkflow 和 MusicWorkflow 的失败钩子。原实现中，LLM auth 分类、sequence 状态写入、当前状态读取或 music claim 清理位于用户可见失败通知之前；这些操作失败时，`generation.failed` 或 `generation.audio:progress` 可能不会发送。

## 改动

- AnalyzeScriptWorkflow 对 auth failure 分类、sequence failed 状态写入和 `generation.failed` 发送分别隔离；分类失败使用原始 sanitized 错误的 fallback 文案，状态写入失败仍继续通知；
- StoryboardWorkflow 对当前 sequence 状态读取、failed 状态写入和 `generation.failed` 发送分别隔离；该批在读取失败后仍尝试写 failed，未证明此路径的 completed 终态保护；读取成功时的已有保护仍在；
- MusicWorkflow 对 music claim/husk 清理和 `generation.audio:progress` failed 发送隔离；claim 写入失败不阻断用户可见 failed 事件；
- 保留原有 LLM auth message、child 已失败时的 sequence 保护、music primary/secondary 语义和事件 payload。

## 动态证据

本批测试直接执行真实 failure hook，使用 host-side ScopedDb 和 realtime channel 替身：

- AnalyzeScriptWorkflow sequence failed 状态写入拒绝时仍发送 `generation.failed`；
- StoryboardWorkflow sequence failed 状态写入拒绝时仍发送 `generation.failed`；
- MusicWorkflow claim 清理拒绝时仍发送 `generation.audio:progress` failed；
- 既有 auth failure 分类、child 已写入终态、completed sequence 不回退和 storyboard 正常流程断言继续通过。

这些测试证明 sequence/audio failure hook 的状态维护与用户可见通知隔离，不等同于真实 Cloudflare durable replay、远程 D1/R2、Workerd authenticated HTTP 或真实 provider 验收。

## 回归与验证

定向命令：

    bun run test src/sequences/server/workflows/analyze-script-workflow-auth-failure.test.ts src/sequences/server/workflows/storyboard-workflow.test.ts src/audio/server/workflows/music-workflow-failure.test.ts

结果为 3 个测试文件、24 项通过。相关回归命令覆盖 18 个测试文件、145 项通过，包含 G03 已完成的 cast、stills 和 await-child 失败生命周期回归。另通过：

- `bun typecheck`；
- `bun lint`，仅有仓库既有 warning；
- `bunx oxfmt --check` 覆盖本批 6 个源文件；
- `git diff --check`；
- `bun run build`；
- 正常 pre-commit hooks，未绕过。

真实 Cloudflare durable replay、Workerd authenticated HTTP、真实 fal/native provider、远程 D1/R2、浏览器 UI 和钱包结算仍未验证。

## 状态和边界

本批关闭三个 sequence/audio failure hook 的通知隔离有限生产缺口，不关闭 GC-03。其它父工作流生命周期、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending，P3 仍在进行中，P4 未开始。
