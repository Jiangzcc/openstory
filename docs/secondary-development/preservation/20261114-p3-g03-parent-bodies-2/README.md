# G03 剩余父工作流主体动态证据（2026-11-14）

本批继续执行 P3 的 G03，为两个仍缺少父主体 `runImpl` 组合证据的工作流补充动态探针：`ReplaceElementWorkflow` 和 `ShotSpecRewriteWorkflow`。测试在 host-side workflow stub 下执行父主体的实际编排顺序，保留模型配置快照、claim、子工作流派发、派生提示词重建和结果收敛；不启动 Cloudflare durable engine。

## 覆盖内容

- `ReplaceElementWorkflow`：验证父 `ModelRuntimeConfiguration` 进入 vision 后的图片子工作流，核对 `promptLocale`、vision 模型、信用扣除、稳定 child id、图片 claim、原图与新元素引用以及成功计数。
- `ShotSpecRewriteWorkflow`：验证父模型配置进入 durable LLM 调用，核对任务语言与 workflow run id、spec claim promote 的 `inputHash`、来源标记、视觉/动作 claim，以及从同一快照重建派生 prompts 的参数和最终结果。

本批没有修改生产代码，也没有改变 child payload、claim ownership、prompt snapshot 或失败处理行为。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/motion-batch-workflow.test.ts src/cast/server/workflows/recast-location-workflow.test.ts src/cast/server/workflows/replace-element-workflow-run.test.ts src/shots/server/workflows/shot-spec-rewrite-workflow-run.test.ts

结果为 4 个测试文件、4 项通过。另通过：

- `bun typecheck`；
- `bun lint`（仓库既有 warning）；
- `bunx oxfmt --check`（本批两个新增测试文件）；
- `git diff --check`；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 `ReplaceElementWorkflow` 与 `ShotSpecRewriteWorkflow` 两个父主体的有限动态组合证据，不关闭 GC-03。`MotionWorkflow` lip-sync child dispatch、其余父主体分支/生命周期、真实 durable replay 和其他运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
