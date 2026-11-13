# G03 RecastLocationWorkflow 父级失败生命周期证据（2026-11-14）

本批继续执行 P3 的 G03，为 RecastLocationWorkflow 的父级 child 失败归属补充有限动态证据。测试先执行真实 `runImpl`，让 regenerate-shots child 拒绝，再直接执行父级 `onFailure`，核对失败向上抛出并广播 `generation.recast-location:failed`；child 的持久执行和真实 RegenerateShotsWorkflow 仍使用替身。

## 覆盖内容

- regenerate-shots child 失败不会被 RecastLocationWorkflow 收敛成成功结果，而是向父级调用者抛出原始错误；
- 父级失败 hook 使用 payload 中的 sequence channel 和 location id 广播 `generation.recast-location:failed`；
- 原有成功派发路径继续核对 snapshot hash、父模型配置、稳定 child id、父绑定名和结果汇总；
- 前一批 RegenerateShotsWorkflow 内部的图片 child `allSettled` 和 variant 派发失败证据继续保留，本批覆盖的是父子边界外层。

本批没有修改生产代码，也没有改变 RecastLocationWorkflow 的错误传播或失败事件行为。

## 回归与验证

定向命令：

    bun run test src/cast/server/workflows/recast-location-workflow.test.ts

结果为 1 个测试文件、2 项通过，其中新增 1 项父级失败生命周期断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/cast/server/workflows/recast-location-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 RecastLocationWorkflow 父级 child 失败通知的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
