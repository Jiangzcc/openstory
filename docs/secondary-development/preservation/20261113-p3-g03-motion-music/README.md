# G03 MotionMusicPromptsWorkflow 父子生命周期证据（2026-11-13）

本批继续执行 P3 的 G03，只补一个此前没有执行父工作流主体的有限生命周期场景：`MotionMusicPromptsWorkflow` 将父 workflow 的 `scopedDb.models`、认证上下文、reservation、analysis model 和 prompt source 交给唯一的 music-prompt child，并在 child 返回后完成结果合并。生产代码没有修改。

本批起点为 `e329c86df`，测试提交为 `03b6f1ad5ebf0e59b50b03645036a8b56db8e93f`。上游基线 B、冻结设计 S 和原 G03 记录均保持不变。

## 覆盖内容

新增 `src/motion/server/workflows/motion-music-prompts-workflow.test.ts`，通过真实 `MotionMusicPromptsWorkflow.runImpl` 和 `WorkflowScopedDb`/`WorkflowStep` 最小替身验证：

- child 使用父侧 `scopedDb.models` 的同一份 `modelConfiguration`；
- `promptLocale`、`userId`、`organizationId`、`sequenceId` 和 `reservationId` 沿 child payload 传播；
- `analysisModelId`、`promptSource`、稳定的 `music-prompt:<sequenceId>` child id 和默认 music model 保持；
- child 返回的 music prompt/tags 经过原有 instrumental 规则，并与父侧场景按 index 合并；
- motion prompt 相关返回 map 仍为空，符合该 drain workflow 的现有结果契约。

本测试针对一个真实父主体分支，mock 只替代 child spawn、场景摘要转换和 music tags helper，不把 child 的供应商调用或 Cloudflare durable engine 当成本批证据。

## 验证

```text
bun run test src/motion/server/workflows/motion-music-prompts-workflow.test.ts
```

结果为 1 个测试文件、1 项通过。随后通过：

- `bun typecheck`
- 针对新增文件的 `bunx oxlint --type-aware`
- `bunx oxfmt --check src/motion/server/workflows/motion-music-prompts-workflow.test.ts`
- `git diff --check`
- 正常 pre-commit hooks：client-server-boundary、knip、format、lint、typecheck

本批没有修改生产源码，因此没有重复执行生产 build；没有执行真实 Cloudflare Workflows durable replay、真实 child/provider、远程 D1/R2 或浏览器 HTTP。

## 状态和边界

本批只增加 `MotionMusicPromptsWorkflow` 一个父主体的有限证据，不关闭 G03。以下开放项仍保留：

- 16 个父 workflow 的所有 body/branch/lifecycle 仍未全部动态执行；当前仍有 `MotionBatchWorkflow`、`ReplaceElementWorkflow`、`RecastLocationWorkflow`、`ShotSpecRewriteWorkflow` 等主体缺完整证据。
- MotionWorkflow 的 lip-sync child dispatch 分支仍未覆盖。
- `claim-discipline.test.ts` 的原有 20 秒 cold ScopedDb import timeout 仍未修改、未放宽、未转为通过。
- 真实 Workerd durable replay、供应商执行、远程写入和钱包结算仍未验收。
