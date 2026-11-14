# G03：失败动作传播与 durable 重试契约

本批继续 GC-03，纠正近期 failure hook 隔离改动削弱 durable 重试的问题，并完成接手时未提交的 Motion failure 修改。基线为 `06c0203994168c71e19939a2796ad5ec2f409fcf`；代码提交为 `408a8fe85c4c63924490e30b29366207e9ffca3d`，正常 pre-commit hooks 全部通过。

## 根因与范围

上游 workflow base 把 `onFailure` 放在 `step.do('emit-failure')` 中，并在 step 外捕获清理最终失败，保留原始生成错误。近期四批在 hook 内增加 catch 后直接返回，虽然可以继续尝试通知，却把未完成清理记录成成功；同时这些 catch 可能吞掉本应恢复执行的 engine abort。Storyboard 还在当前状态读取失败后继续写 failed，已有 completed 断言只覆盖读取成功路径。

本批以独立的 `runFailureActions` 统一必要失败动作的错误传播。普通错误后继续尝试独立动作，最后重新抛出首个错误，让现有 step 负责重试；引擎中断立即原样抛出。相互依赖的读取和写入保持在同一动作中，领域仍拥有 claim、终态、child ownership 和 primary/variant 决策。没有建立平行工作流或新的重试调度器。

## before / after 与上游接入

- 删除近期分散的“捕获并成功返回”处理，改由共用函数保留错误；未修改 base 的 step 名称、重试配置或原始错误处理。
- Motion 的 pending promote 清理和失败行持久化仍走既有 ScopedDb，失败后尝试原 payload 的通知并继续向调用者抛出；MotionBatch 的 `record-dialogue-blocked` 调用链补充传播回归。
- Storyboard 的状态读取失败时跳过依赖该结果的状态写入，仍尝试通知并拒绝本次清理，等待 durable 重试。读取成功时沿用原有 failed/completed 判断。
- 近期四批的测试成绩保留为历史证据，修正“保证送达”和“所有 completed 路径已保护”等超出断言的文字。

LocationSheet、Image、ShotVariant、Music 和 Lipsync 原有的普通通知失败只记录日志；AnalyzeScript/Storyboard 原有的普通 reservation 释放、Image preview 原有的失败行补记也为 best-effort。本批保留这些边界，另加 engine abort 向外传播。Recast 的单一必要通知直接 await，避免为单一动作增加包装。Bible 父级的失败回收不在 base 的 onFailure 中，因此新增具名 failure step，让必要清理在 step 内重试、耗尽后仍按原部分失败路径处理；原 spawn/await step 名称保持。

领域文件仍是必要接入点。上游若调整 failure hook、claim/终态守卫、channel payload 或 base 的清理重试语义，需要按实际变更复核这些调用；本批不宣称消除所有未来文本冲突。

## 验证

最终集成回归为 29 个测试文件、477 项全部通过；typecheck、全仓 lint、33 个源码/测试文件格式、diff 检查以及 client/SSR 生产构建通过。定向 lint 只有 `image-workflow.ts:462` 一条位于本次 diff 之外的既有 warning。正常 hooks 的 client/server 边界测试、knip、格式、lint 和 typecheck 全部通过。首轮 typecheck 的三处 TS2322 在 guard 后以局部 const 捕获字段修正，最终复跑通过，未加类型断言或非空断言。

本批文档的 17 个 Markdown/JSON 文件格式检查通过；10 份 JSON、一份 43 条记录的 JSONL 及 160 处本地链接校验通过，源码提交路径与记录一致。

完整命令、结果及首次失败/修正关系见 `verification-results.json`；代码文件与替身边界见 `implementation.json`。共用函数测试覆盖顺序、首个错误、通知失败及 engine abort；组合测试执行真实 workflow base，使用明确的 host-side cleanup、channel 和 step retry 替身。

## 未关闭边界

本批不是全仓 failure hook 验收。其它历史 best-effort 与必要清理需分别核对，不能机械改变其外部行为。已确认 `src/cast/server/db/characters.ts` 的 `markVoiceClaimTerminal` 分两次更新 version 和 pending voice pointer；若第二次写入失败，重试可能因 version 已终态而跳过清指针。本批未修改该 DB helper，恢复 hook 错误传播不能证明这个部分写入窗口已关闭。真实 Cloudflare durable replay/restart、Workerd authenticated HTTP、真实供应商、远程 D1/R2、浏览器通知送达和钱包结算未验证。GC-03/P3 仍在进行中，1,219 项冻结 inventory 不因此获得批量批准，P4 未开始。没有 push、部署、远程写入或真实模型调用。

## 后续跟进：voice claim

上述两次写入窗口随后由 [G03-voice-claim-recovery](../20261114-p3-g03-voice-claim-recovery/README.md) 修复并补充真实 SQLite/D1 模拟器故障注入回归。本批原测试成绩和未修改 DB helper 的历史边界保持；后续结果不扩展为真实 Cloudflare replay、其它失败分支或 GC-03 整体完成。
