# G03 父工作流主体动态证据（2026-11-14）

本批继续执行 P3 的 G03，为两个原先只有 helper 或子路径证据的父工作流补充真实 `runImpl` 组合测试：`MotionBatchWorkflow` 和 `RecastLocationWorkflow`。测试在 host mock 下执行完整父主体，保留实际 child dispatch、快照校验和结果收敛逻辑；不启动 Cloudflare durable engine。

## 覆盖内容

- `MotionBatchWorkflow`：执行 motion 与 music 两类子任务派发，验证父 `ModelRuntimeConfiguration` 传入两个 child、稳定 child id、prompt locale、reservation id、主音频标记及父 reservation 归零；保留 `Promise.allSettled` 后的正常收尾。
- `RecastLocationWorkflow`：执行 snapshot hash 校验和 regenerate-shots child 派发，验证地点 trigger 语义、稳定 child id、原始 shot snapshots、模型快照和成功/失败数量映射。

本批没有修改生产代码，也没有改变 child payload、claim、reservation ownership 或失败处理行为。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/motion-batch-workflow.test.ts src/cast/server/workflows/recast-location-workflow.test.ts

结果为 2 个测试文件、2 项通过。另通过：

- `bun typecheck`；
- `bun lint`（仓库既有 warning）；
- `bunx oxfmt --check`（本批两个测试文件）；
- `git diff --check`；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭两个父主体的有限动态组合证据，不关闭 GC-03。`ReplaceElementWorkflow`、`ShotSpecRewriteWorkflow`、MotionWorkflow lip-sync child dispatch、其余父主体分支/生命周期、真实 durable replay 和其他运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
