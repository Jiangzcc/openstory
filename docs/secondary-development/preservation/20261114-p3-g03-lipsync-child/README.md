# G03 MotionWorkflow lip-sync 子工作流派发证据（2026-11-14）

本批继续执行 P3 的 G03，为 MotionWorkflow 成片后的 lip-sync 子工作流派发补充动态主体证据。测试在 host-side workflow stub 下执行实际 runImpl，让 Grok 成片带一条已匹配的对话音频，走到 planMotionLipsync、primary finalize 和 LipsyncWorkflow child dispatch；不启动 Cloudflare durable engine。

## 覆盖内容

- 核对成片完成后仅对不自带对话音频的模型规划 lip-sync；
- 核对父 ModelRuntimeConfiguration、稳定 child id lipsync:seq-1:shot-1、MOTION_WORKFLOW parent binding、spawn/await step 名称和 30 分钟等待预算；
- 核对 child payload 携带 live scene id、已存视频 URL、对话音频 URL、时长、分辨率、原视频模型、序列/场景标题、reservation id，以及 manifest 中的 audio clip/source key；
- 核对父 workflow 仍返回已完成的原始成片结果。

本批没有修改生产代码，也没有改变 lip-sync 计划、manifest、claim 或 reservation 行为。

## 回归与验证

定向命令：

    bun run test src/motion/server/workflows/motion-workflow.test.ts

结果为 1 个测试文件、42 项通过。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/motion/server/workflows/motion-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 LipsyncWorkflow durable replay、真实 fal 供应商、远程 D1/R2、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 MotionWorkflow lip-sync child dispatch 的有限动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
