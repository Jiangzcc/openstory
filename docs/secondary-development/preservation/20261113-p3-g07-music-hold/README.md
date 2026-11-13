# G07 音乐预占在 claim 失败窗口的清理修复（2026-11-13）

本批继续执行 P3 的 G07，修复一项已经由源码和定向回归确认的上游继承风险：音乐生成在创建余额预占后调用 `claimMusic`，如果 claim 在真正启动 workflow 前抛错，原有 `releaseReservationOnThrow` 只包住后续 trigger，新的 hold 没有进入清理路径。添加音频模型的空 claim 结果还会直接抛出 `NotFoundError`，同样位于原清理保护之外。

本批起点为 `0c02be5153ed9e75afc72540b7759e31f35dfffa`，代码提交为 `ab6d584f413a552c754234b56a18982c31f90ca0`。固定上游基线 B 和 P3 冻结设计 S 未移动；没有推送、部署、远程 D1/R2 写入或真实供应商调用。

## 根因和改动

两个生产入口都按“先预占、再 claim、再触发”的顺序工作：

- `src/sequences/server/smart-retry.ts` 的失败音乐重试先调用 `reserveRunCredits`，随后 `sequenceVariants.claimMusic`，最后才使用 `releaseReservationOnThrow` 包裹 `/music` workflow trigger。
- `src/sequences/server/sequence-models.ts` 的添加音频模型入口也先创建预占，claim 返回空值时抛出 `NotFoundError`，原来的清理包装只覆盖 trigger。

本批让两个入口都把“预占创建完成到 claim 成功”纳入同一个 `releaseReservationOnThrow` 区间：

- claim 抛错时，只将本次入口创建的 reservation 归零并保留原错误。
- add-audio claim 返回空值时，在同一保护区间内抛出原有 `NotFoundError`，归零本次 reservation。
- claim 成功后仍按原流程构造 payload、传递 `reservationId`/`ownsReservation`、触发 workflow，并由原有 trigger 保护处理启动失败。
- smart retry claim 返回 `null` 的并发未获 claim 分支仍使用原有显式 `zeroReservation`；没有改变 claim、workflow、失败事件或成功运行的 ownership 语义。

没有新增通用 resolver，也没有移动音乐 claim、workflow、账务或失败状态的职责。

## 验证

定向执行：

```text
bun run test src/sequences/add-audio-model.test.ts src/sequences/server/smart-retry-billing.test.ts
```

结果为 2 个测试文件、16 项测试全部通过。新增回归覆盖：

- add-audio claim 抛错：reservation 被归零，workflow 不启动，未写入失败 claim。
- add-audio claim 返回空值：reservation 被归零，workflow 不启动，原有 `Sequence not found` 保留。
- smart retry claim 在图片任务已成功启动后抛错：音乐 workflow 不启动，音乐 hold 被清理，已启动图片任务的 hold 仍保留。

另外通过：

- `bun typecheck`
- `bun lint`（只有仓库已有 lint warning）
- `bun run build`
- `bunx oxfmt --check`（本批 4 个修改文件）
- `git diff --check`
- 正常 pre-commit hooks：client-server-boundary、knip、format、lint、typecheck

定向 smart retry 使用真实本地内存 D1 billing 方法；add-audio 的入口测试使用认证上下文和 billing/workflow 替身。没有把这些证据扩展为真实 Cloudflare Workflows durable replay、真实供应商账单、远程存储或钱包结算验收。

## 状态和后续

本批状态为 `repaired-with-bounded-evidence`。它只关闭 G07 的音乐 claim 新 hold 清理缺口，不关闭 GC-07 整体。以下 G07 风险仍开放并需独立行为修复与编排回归：

- motion 估价时长与实际发送时长可能不一致。
- motion 估价使用的引用路由信息可能少于实际发送引用，导致预估价与执行路由不一致。

这两项会改变计费预估契约，后续应分别先补失败/长片/引用场景回归，再修改对应估价和入口投影；本批不把已有 synthetic 估算探针当作修复证据。
