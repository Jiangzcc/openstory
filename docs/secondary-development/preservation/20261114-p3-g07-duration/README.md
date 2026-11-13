# G07 motion hold 时长估价修复（2026-11-14）

本批继续执行 P3 的 G07，修复两个入口按模型默认时长或固定 5 秒估价、而 motion workflow 按 shot 的实际时长执行的问题。该差异会让长 shot 的余额预占低于执行成本。引用路由估价风险仍单独开放，本批没有把两个问题混成一次重构。

## 根因和改动

原有入口：

- smart retry 使用模型默认时长，再叠加 Seedance edit 时长；payload 仍携带 shot 的时长；
- add-video-model 固定按 5 秒估价，payload 仍携带每个 shot 的时长；
- MotionWorkflow 后续会按模型 duration grid snap 输入，并用该时长进行 preflight/提交。

本批在 src/motion/resolve-shot-duration.ts 增加纯函数 resolveMotionHoldDuration，统一执行：

1. 从 shot.durationMs 得到时长；
2. 按目标 motion model 的有效 duration grid snap；
3. 对 Seedance edit 取 shot 时长与 edit hold 的较大值。

smart retry 和 add-video-model 的预估入口都改用这条规则。payload 仍保留原有 editorial duration 表达，避免把估价修复扩大成 batch packing 行为变化。没有改 reservation ownership、claim、workflow dispatch 或最终供应商扣费路径。

## 回归与验证

新增/补强：

- src/motion/resolve-shot-duration.test.ts：覆盖存储时长、edit hold 和缺失时长的统一规则；
- src/sequences/smart-retry.test.ts：10 秒长 shot 的 smart retry 预占金额必须按同一 snapped duration，且 payload 保留该 shot duration；
- src/sequences/server/add-video-model.test.ts：10 秒长 shot 的 add-video 预占金额与 /motion-batch payload 同时回归。

定向命令：

    bun run test src/motion/resolve-shot-duration.test.ts src/sequences/smart-retry.test.ts src/sequences/server/add-video-model.test.ts

结果为 3 个测试文件、38 项通过。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bun run build；
- bunx oxfmt --check（本批修改文件）；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有执行真实供应商、Cloudflare durable replay、远程 D1/R2、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 INHERITED-MOTION-DURATION-ESTIMATE 的当前代码缺口，但不关闭 GC-07。INHERITED-MOTION-REFERENCE-ROUTE 仍开放：smart retry 和 add-video 的预估引用路由与实际 per-shot bindable references 仍需单独修复和回归。历史 2026-11-10 characterization 记录保留原始源码风险结论，当前修复证据以本批记录为准。
