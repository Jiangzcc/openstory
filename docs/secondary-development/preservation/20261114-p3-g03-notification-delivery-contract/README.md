# P3 / GC-03：Storyboard 终态通知持久化与恢复

本批承接 [创建设置修复](../20261114-p3-g03-create-draft-motion/README.md) 之后的通知投递缺口。仅完成下面列明的本地实现与验证；GC-03/P3 仍为 in-progress，P4 未开始。

## 原行为、动机与根因

上游已有 Realtime Durable Object、工作流持久步骤、组织隔离和定时协调器；先前二开已补充根运行归属与客户端生命周期判断。本批在此基础上修复终态落库与通知发送之间的丢失窗口。

原流程先将 sequence 标为 failed，再发送通知。发送失败导致步骤重试时，状态 guard 已因 failed 返回 false，通知被跳过；真实 realtime 适配器还会吞掉普通 HTTP/fetch 错误，使调用方无法决定是否确认投递。新增的原版复现为 17 项中 1 项失败，证明终态已提交后第二次失败处理没有重新发送。

## 本批实现

- 新增序列领域的终态通知日志，唯一键为 organization / sequence / root run。失败、余额不足与完成的首个 envelope 与对应状态变更在同一 D1 batch 提交；完成活动继续沿用稳定 event ID 和原文案。
- 重试独立检查持久 receipt，不依赖重复状态写入的布尔返回。数据库写失败且未生成 receipt 时，不发送假称已落库的终态；已有的 standalone AnalyzeScript CLI 旧行为及原测试保留。
- 投递前检查组织存在、序列归属、实际实例或原 raw claim，以及匹配的终态。发送成功后只确认原记录；旧发送者不能消费新运行的 receipt。
- realtime 提供显式 `requireAcknowledgement`，终态投递传播非 2xx 与传输错误。普通进度通知仍为 best effort。
- 将领域恢复函数注入现有 cron。待投递条目按 lastAttemptAt / createdAt / id 有界轮转，单条失败不阻断其他条目，过期 owner、状态错配及 orphan 会清理。确认后的当前记录保留用于重放去重，直到失效；scoped sequence delete 同时删除其日志。
- 余额不足先执行 `mark-reservation-short` 提交，再执行 `emit-reservation-short` 投递。普通投递错误重试耗尽后保留待恢复记录，继续抛原余额不足 `WorkflowLoggedError`；engine abort 原样传播。完成通知发送失败也不会把已完成状态改回失败。

迁移由 `bun db:generate --name=storyboard_terminal_notifications --output=json` 生成，只有新增表和两个索引。生成的 snapshot 只经过仓库格式化器，前后 JSON 值相同；迁移安全检查通过，并在全新进程内测试数据库应用。没有向现有本地或远程数据库应用迁移。

claim-discipline 的原扫描会把含 workflowRunId 的新表归入生成结果候选，本批为投递 receipt 添加明确的例外理由，不扩大生成结果的选取权限；没有新增 WorkflowScopedDb 读取口或 platform/domain 例外。

## 验证证据与适用边界

最终选择 29 个文件、474 项全部通过。数据库事务、SQL 故障、提交结果丢失、回执丢失、旧 owner/异组织、raw claim 发布、并行发送、公平轮转、scoped 删除和 orphan 清理使用 `createTestDb()` 的迁移后 SQLite/D1 适配；网络、引擎步骤与子任务使用明确替身。新增 46 项测试，无删除；SQL 写失败时的通知断言随持久化约束调整，原 owner、状态及失败断言保留。

集成首轮 472/474 通过，两项失败分别是新表缺少 receipt 分类说明，以及组织删除夹具受既有 style history RESTRICT 限制；后者改用明确的 parent-only 合成数据图验证 outbox orphan 清理，没有改外键或宣称完整组织删除业务已验收。修正后两文件 28 项通过，最终整组 474 项通过；进一步将新测试的夹具构造拆成独立函数后，其 23 项再次通过。

类型检查、全仓 lint、源文件格式、生产 client/SSR 构建及迁移安全检查已通过。全仓 lint 有 147 条范围外既有警告；本轮修改路径没有这些警告。构建的依赖指令/分块警告不作为通过的功能验收。正常源码提交 hooks 的类型、lint、格式、knip、边界 17 项与迁移安全均通过，结果与源码 SHA 在实施记录中保存。独立只读审查未发现阻断问题，但审查者没有另跑测试或外部验证。

## 投递语义与后续工作

本批为 **至少一次投递**。外部已接收而回复丢失、确认写失败或并行发送者重叠时，可以重复接受相同 envelope；没有实现接收端幂等键或恰好一次送达。发出前的 guard 不能撤回发送之后发生接管的旧事件，现有客户端 owner 检查仍必需。DO 返回成功也不证明浏览器已接收。

只对新执行的终态写入创建 receipt。旧成功 checkpoint 和无 receipt 的已有终态不回填；Standalone AnalyzeScript CLI、独立 Update all 预检、后代取消及完整内容/素材事件归属仍开放。新投递表不替代原启动请求日志，旧 raw claim 无原请求的问题仍在。

邮件是独立待修复协议：`smart-retry.ts` 在子运行启动确认后可能过早发 ready 邮件；现有 helper 先写 readyEmailSentAt 再发送，崩溃或确认未知可能遗留占位，发送已接受后回执丢失也无法证明不重复；未来释放/恢复必须区分尝试 owner。本批没有修改邮件调用或发送真实邮件。

真实 Cloudflare Workerd/D1/Realtime DO 的重启、持久重放、多实例 cron、真实浏览器、供应商与钱包结算仍待验收。五份冻结 inventory 共 1,219 项均保持 pending，零项批准，内容与本批 sourceBefore 一致。

源码提交：3a57ea23b0b2187bc9f1b213e9255cb7d769ca68。具体命令、首次失败、复跑和指纹见 [implementation.json](implementation.json) 与 [verification-results.json](verification-results.json)。
