# P3 / GC-03 voice claim 失败恢复

本批处理上一批确认的 voice version 与 pending pointer 两次写入窗口。生产提交为 `c0675044683df059ce597f5b3ceb654f98c8ebf5`，正常 hooks 全部通过。GC-03/P3 仍在进行中，P4 未开始；本批不批准冻结 inventory，也不宣称消除未来上游合并冲突。

## 原有行为与根因

上游既有的 voice claim 生命周期以 version 状态和角色的 pending pointer 共同表示在途任务。原 markVoiceClaimTerminal 先把 pending/generating version 改为 failed，再单独清理角色指针。若第二次写入失败，第一次已经提交；重试又因 version 已 failed 返回 null，跳过指针清理，留下无法由该重试恢复的残留。本次真实数据库回归还复现了该方法只按 version id 更新、缺少组织范围校验的问题。

此前的 [failure retry contract 批次](../20261114-p3-g03-failure-retry-contract/README.md)恢复了必要清理的错误传播，但没有关闭此 DB 窗口。这里保留原上游生命周期和二开的 durable retry 契约，只修复这一失败操作。

## 实现与外部契约

生产改动仅在 src/cast/server/db/characters.ts 的组织范围 SQL 与 markVoiceClaimTerminal。失败状态写入及指针清理使用既有 D1 batch：任一语句失败，两者都回滚，异常继续向调用方传播。

- 首次只有 pending/generating version 可以转成 failed，并返回本次更新后的 version row。
- 已 failed 的 version 可以补清历史残留的自身指针；返回仍为 null，不覆盖原 error。重复调用不会把一次恢复计为新的取消。
- 清理必须同时满足本组织、角色确实拥有该 version、pending pointer 仍等于该 id，以及 version 已 failed。旧失败重试不会清理新 claim，也不会恢复用户已清空的 pointer。
- completed version 及其尚待 promote 的 pointer 保持原样；当前选中的 voice 和用户选择不变。
- 组织范围查询延迟到调用方法时构造，保持 ScopedDb 工厂的既有构造契约。

只读调用审查核对了取消入口、enqueue/zombie 回收、voice/bible 子任务及 Continue voice 分支的全部 8 处生产调用。唯一消费 row/null 的取消入口仍只在本次 live → failed 成功时报告 cancelled:true。其余调用只等待写入成功；没有调用依赖跨组织清理。

该修复属于必要的上游 DB 接入点改动。独立重试器或 workflow 外层 catch 不能使两次 SQL 原子化；复制另一套 voice 生命周期会增加维护面。未新增 schema、migration、任务 payload、provider 调用或公开接口。

## 验证证据

新增 voice-claim-terminal.test.ts 使用真实 createCharactersMethods、createTestDb 与实际 migrations；SQL trigger 仅在测试内注入明确的 synthetic 写入错误。不是 DB 方法 mock，也不调用真实供应商。修复前，在校正测试夹具后复现 5 个行为失败；首次测试准备阶段的错误及修正也保留在 verification-results.json。

最终集成回归 21 个测试文件、426 项全部通过；类型检查、定向 lint、两份源码/测试格式检查、diff 检查及 client/SSR 生产构建通过。定向 lint 仅有 characters.ts:1271 的一条既有 warning，位于本次生产 diff 之外。

新增 12 项覆盖两种 live 状态的回滚及重试、首条写入失败、历史 failed 残留恢复、重复调用、旧失败与新 claim、用户选择、completed 待 promote、跨组织状态和缺失 claim。正常 pre-commit hooks 的 17 项客户端/服务端边界测试、knip、格式、lint 和类型检查通过。6 份 Markdown/JSON 格式、2 份 JSON、44 条实施日志、153 处本地链接与源码提交路径核对通过；5 份冻结 inventory 的 1,219 项仍全部 pending。

完整集成命令、检查结果及首次失败/复跑关系见 [验证记录](verification-results.json)，实际改动和调用契约见 [实现记录](implementation.json)。

## 上游升级关注点与未关闭边界

上游若调整 voice 状态枚举、claim/promotion、组织 ScopedDb、D1 batch 或取消入口的 row/null 语义，需要复核这两个写入的原子性和恢复条件。保留现有领域模块与公开方法，不把单批修复算作全量职责收敛。

测试证明 host-side SQLite/D1 模拟器中的原子回滚及列出的顺序交错；不是实际 Cloudflare 多实例并发或 durable replay/restart 验收。真实 Workerd HTTP、远程 D1/R2、供应商、浏览器通知送达和钱包结算未执行。Storyboard 原有读写竞态、其它 failure hook 和剩余生命周期分支仍开放；voice 取消调用链的完整事件送达也未在本批做端到端验收。没有 push、部署、远程写入或真实模型调用。

## 后续批次

2026-11-14 的 [Storyboard failure guard 批次](../20261114-p3-g03-storyboard-failure-guard/README.md)补上父任务失败状态的组织、任务归属和终态原子守卫，并覆盖启动器 claim 尚未回写实例 ID 的窗口。本记录保留当时测试成绩与开放项；后续批次没有关闭终态后的通知重试、事件归属或全部生命周期，GC-03/P3 仍未验收。
