# G03 claim discipline 冷导入 harness 修复（2026-11-14）

本批继续执行 P3 的 G03，只修复测试 harness 的冷导入位置。原测试把 **#db-client mock** 和 **src/platform/server/db/scoped** 的首次导入放在 20 秒测试体内；在 Windows 本地回归中，导入成本会占满显式超时，导致 5 个 claim-domain 断言实际只完成 4 个。生产代码、业务断言和 20 秒超时均未改变。

## 改动

修改 **src/platform/server/workflow/claim-discipline.test.ts**：

- 将 #db-client mock 移到模块顶层；
- 将 createScopedDb 的动态导入移到测试体外；
- 测试体继续创建真实 ScopedDb，遍历原有 claim/clear/promote/userSelect 方法并执行原断言；
- 没有放大 timeout，也没有吞掉或减少断言。

这修复的是测试执行顺序，不改变 G03 业务覆盖范围。G03 其余父 workflow 的完整 body/branch/lifecycle 证据仍开放。

## 验证

命令：

    bun run test src/platform/server/workflow/claim-discipline.test.ts

结果为 1 个测试文件、5 项通过。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/platform/server/workflow/claim-discipline.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

没有执行真实 Cloudflare durable replay、供应商调用、远程 D1/R2、浏览器 HTTP 或钱包结算。

## 状态

本批关闭 G03-TEST-TIMEOUT 这一测试 harness 缺口，不关闭 GC-03。动态覆盖仍缺 MotionBatchWorkflow、ReplaceElementWorkflow、RecastLocationWorkflow、ShotSpecRewriteWorkflow 和 Motion lip-sync child dispatch 等分支；冻结 inventory 继续保持 pending。
