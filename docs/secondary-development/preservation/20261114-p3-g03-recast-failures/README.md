# G03 RegenerateShotsWorkflow 失败生命周期证据（2026-11-14）

本批继续执行 P3 的 G03，为 RegenerateShotsWorkflow 的图片子任务失败和派生 variant 派发失败补充动态父主体证据。测试执行实际 runImpl，并将 snapshot、图片 child、recast 生命周期事件和 variant trigger 的替身边界分开验证；不启动 Cloudflare durable engine。

## 覆盖内容

- 图片 child await 失败时，父任务按 allSettled 收敛为 failedShots，仍发送 complete recast 事件，不让单个镜头失败抛出整批；
- variant-image 派发未启动时，runImpl 保留异常向上抛出，父级 onFailure 发送 failed recast 事件；
- 原有成功路径的 resolution 转发断言继续保留。

本批没有修改生产代码，也没有改变图片 child payload、allSettled 结果映射或父级失败通知行为。

## 回归与验证

定向命令：

    bun run test src/shots/server/workflows/regenerate-shots-workflow.test.ts

结果为 1 个测试文件、3 项通过。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/shots/server/workflows/regenerate-shots-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 RegenerateShotsWorkflow 两条失败生命周期的有限动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
