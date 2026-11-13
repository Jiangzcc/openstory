# G03 ReplaceElementWorkflow 失败报告证据（2026-11-14）

本批继续执行 P3 的 G03，为 ReplaceElementWorkflow 的失败生命周期补充有限动态证据。测试直接执行真实 `onFailure`，核对视觉分析仍在进行时的状态降级、未被子任务接手的 image claim 清理，以及两种失败状态都向 sequence 广播 `generation.replace-element:failed`；ScopedDb 和 realtime channel 使用替身。

## 覆盖内容

- vision status 为 `analyzing` 时，失败 hook 将 element 更新为 `failed` 并保存错误；
- 通过 workflow run id 标记仍等待子任务接手的 image claim 为失败；
- vision 已完成时不重复降级视觉状态，仍继续清理未接手的 image claim；
- 两类失败都广播 element id 和错误文本；
- 原有父级成功传播、批量结果和 `shouldDowngradeVisionOnFailure` 纯策略断言继续保留。

本批没有修改生产代码，也没有改变 ReplaceElementWorkflow 的失败状态或通知行为。

## 回归与验证

定向命令：

    bun run test src/cast/server/workflows/replace-element-workflow.test.ts

结果为 1 个测试文件、25 项通过，其中新增 2 项失败状态/事件断言。另通过：

- bun typecheck；
- bun lint（仓库既有 warning）；
- bunx oxfmt --check src/cast/server/workflows/replace-element-workflow.test.ts；
- git diff --check；
- 正常 pre-commit hooks，未绕过。

本批没有重复生产 build，也没有执行真实 Cloudflare durable replay、远程 D1/R2、真实供应商、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 ReplaceElementWorkflow vision/image claim 失败收敛和 failed-event 的有限 host-side 动态证据，不关闭 GC-03。其它父工作流生命周期/失败分支、真实 durable replay 和其它运行环境证据仍开放；原始 G03 inventory 继续保持 pending。
