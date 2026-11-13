# G03 ShotImagesWorkflow primary 失败收敛证据（2026-11-14）

本批继续执行 P3 的 G03，为 ShotImagesWorkflow 的 primary image child 失败路径补充动态父主体证据。测试走真实 runImpl 的 scene/model fan-out 和 lone-primary retry，令 child 连续失败后核对 primary 结果收敛；variant root、供应商和 durable engine 仍使用替身。

## 覆盖内容

- primary image child 失败后执行一次 lone-primary retry；
- retry 仍失败时，scene 结果为 imageUrls=[null]、frameVersionIds=[null]，而不是把局部失败伪装成成功；
- 原有 zh-CN/en 的直接 variant root、模型配置快照和成功路径断言继续保留。

本批没有修改生产代码；只拆出测试输入构造，新增一条失败路径断言，并在测试 setup 中显式恢复 child mock 的成功默认值。

## 回归与验证

定向命令：

    bun run test src/shots/server/workflows/variant-child-context.test.ts

结果为 1 个测试文件、7 项通过，其中新增 1 项 ShotImagesWorkflow primary 失败断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/shots/server/workflows/variant-child-context.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 ShotImagesWorkflow primary child 失败后的有限动态收敛证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
