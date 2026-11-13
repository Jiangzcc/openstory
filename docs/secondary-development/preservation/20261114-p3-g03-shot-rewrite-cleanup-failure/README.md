# G03 ShotSpecRewriteWorkflow 清理异常隔离证据（2026-11-14）

本批继续执行 P3 的 G03，为 ShotSpecRewriteWorkflow 失败 hook 的恢复隔离补充有限动态证据。测试让 spec claim 清理抛出数据库异常，核对失败 hook 仍继续向 streaming 客户端发送 visual 和 motion 两条 failed 事件；ScopedDb 和 realtime channel 使用替身。

## 覆盖内容

- claim 清理失败不会让 `onFailure` 在用户可见失败通知前提前结束；
- visual/motion 两类 `shotPrompt.failed` 仍按既有事件文本发送；
- 前一批 claim、variant、streaming 正常失败清理和成功 runImpl 断言继续保留。

本批没有修改生产代码，也没有改变数据库异常的记录策略或失败事件行为。

## 回归与验证

定向命令：

    bun run test src/shots/server/workflows/shot-spec-rewrite-workflow-run.test.ts

结果为 1 个测试文件、3 项通过，其中新增 1 项清理异常隔离断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/shots/server/workflows/shot-spec-rewrite-workflow-run.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 ShotSpecRewriteWorkflow claim 清理异常不阻断 failed streaming 通知的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
