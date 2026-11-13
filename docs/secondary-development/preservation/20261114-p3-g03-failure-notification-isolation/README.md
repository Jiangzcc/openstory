# G03 生成失败通知隔离（2026-11-14）

本批继续执行 P3 的 G03，沿同一根因复核 recast、image、variant-image 和 upscale failure hook。原实现中，失败状态写入、claim/自动 promote 清理或失败前的缩略图读取发生在用户可见 failed 事件之前；这些 best-effort 操作一旦抛错，failure hook 就会提前结束，页面可能收不到失败或 upscaleError 通知。

## 改动

- RecastLocationWorkflow 将 `generation.recast-location:failed` 发送单独隔离，channel 失败不会再次抛出 failure hook；
- ImageWorkflow 将 frame 失败行、pending promote 清理和 rowless failed 记录收敛为 best-effort，持久化异常仍继续发送 `generation.image:progress` failed；
- ShotVariantWorkflow 将 variant 失败行清理与 `generation.variant-image:progress` failed 分离；
- UpscaleShotVariantWorkflow 将版本失败、legacy run 失败、pending promote 清理、旧缩略图读取和 `generation.image:progress` 的 `upscaleError` 逐段隔离；
- 保留原有 claim ownership、primary/variant 语义、upscale 失败时展示旧图的 completed 状态和事件 payload。

## 动态证据

本批测试直接执行真实 failure hook，使用 host-side ScopedDb 和 realtime channel 替身：

- recast failed channel 拒绝时，failure hook 仍正常收敛；
- image 的 failed row 写入拒绝时，仍发送 image failed 事件；
- shot variant 的失败行写入拒绝时，仍发送 variant failed 事件；
- upscale 的版本失败写入拒绝时，仍发送带 `upscaleError` 的 image progress 事件；
- 既有 recast 子级失败、image rowless/claim、upscale 版本与 legacy run、旧图保留等断言继续通过。

这些测试证明失败状态维护与用户可见通知的错误隔离，不等同于真实 Cloudflare durable replay、远程 D1/R2、Workerd authenticated HTTP 或真实 provider 验收。

## 回归与验证

定向命令：

    bun run test src/cast/server/workflows/recast-location-workflow.test.ts src/stills/server/workflows/shot-variant-workflow-failure.test.ts src/stills/server/workflows/image-workflow-failure.test.ts src/stills/server/workflows/upscale-shot-variant-workflow-failure.test.ts

结果为 4 个测试文件、13 项通过。相关回归命令覆盖 15 个测试文件、121 项通过，包含 cast 前置失败生命周期、image preview/snapshot、shot variant generation、upscale generation 和 await-child 回归。另通过：

- `bun typecheck`；
- `bun lint`，仅有仓库既有 warning；
- `bunx oxfmt --check` 覆盖本批 8 个源文件；
- `git diff --check`；
- `bun run build`；
- 正常 pre-commit hooks，未绕过。

真实 Cloudflare durable replay、Workerd authenticated HTTP、真实 fal/native provider、远程 D1/R2、浏览器 UI 和钱包结算仍未验证。

## 状态和边界

本批关闭四个生成失败 hook 的通知隔离有限生产缺口，不关闭 GC-03。其它父工作流生命周期、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending，P3 仍在进行中，P4 未开始。
