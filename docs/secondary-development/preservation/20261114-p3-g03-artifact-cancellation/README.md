# P3 / GC-03：素材取消的事务与迟到写入约束

本批承接 [终态通知投递](../20261114-p3-g03-notification-delivery-contract/README.md) 后的取消风险，完成现有 pending artifact 取消协议的选定修复。GC-03/P3 仍为 in-progress，P4 未开始；不是整个 Storyboard 子树取消已完成。

## 原行为与根因

上游已有 visual-prompt / motion-prompt / image 取消、依赖图片取消、claim 状态检查和 best-effort 工作流终止。本批复用这些能力，不新增取消类型或界面。

原入口逐步执行：先 markTerminal，再取消依赖图片、清理 promote 指针。后续 SQL 失败时，前面的 cancelled 已提交；重试又因源已终态直接返回 false，留下活依赖或旧指针。3 项真实 D1 SQL 故障注入在原实现均失败，实际观察到应回滚的源仍是 cancelled。

另有两类迟到写：已取消的视觉提示词仍可创建 pending 图片 claim；图片准备/fallback 的旧回调也能在取消后重新设置或移交 promote 指针。前者有单项原版失败，后者有 3 项原共享指针方法失败。首版取消门禁还被新增单项回归证明：迟到的已取消 claim 若仍为 primary，其新 ULID 会遮住较新运行的活动状态；已同步修正。

## 本批实现

- 新建独立 DB 聚合 `artifactCancellations`，由原 ScopedDb composition 绑定 organization。视觉提示词的状态、live 依赖图片取消及 exact frame/version 的 promote 清理同一 D1 batch 提交；单独图片取消的状态与指针清理同一 batch 提交。数据库失败整批回滚，没有先读后写冒充原子性。
- 每条 SQL 自身验证目标、组织及状态。源完成先赢时，不取消依赖；较新 kickoff 的指针保留，跨组织依赖不被触碰。清理候选仅取该依赖的帧，并重新匹配版本所属 frame。
- `cancelled` 仍表示请求源是否发生本次转换。对历史半取消，重复请求可在返回 false 时修复依赖/指针。服务在提交返回后才尝试终止返回的运行，包括 false 携带的修复运行；原读取、NotFound 消息、motion-prompt 单写分支和返回结构保留。
- 图片 claim INSERT 自身检查视觉依赖是否 cancelled。取消先赢时插入 cancelled、非 primary 的历史行，不写 image.started，不可 claimForGeneration，也不遮住当前 active 图片；图片先插入时，由取消 batch 一起收敛。保留原返回行接口，不靠延时或前置读取判断。
- 共享 `frames.setPendingPromoteVersionId` 与 `movePendingPromoteVersionIdIf` 在指针 UPDATE 中检查目标仍存在且未取消，防止旧准备和 fallback 回调复活死 claim。保持 void / boolean 接口、null 清理、原 kind 校验和其他原允许状态。

独立审查发现迟到 dependency CASE 曾漏掉组织边界；新增单项真实数据库红测后，已从源、目标真实 frame→sequence 关系限定同组织，并完成源码复查。

生产改动集中于 6 个文件，新增两个 DB 模块；未变更 schema、迁移、工作流绑定、cron、模型或计费策略。既有编辑/恢复功能没有顺手调整。

## 验证与边界

最终 22 个文件、450 项测试全部通过，新增 41 项：24 项迁移后真实 ScopedDb/SQLite-D1 组合测试、17 项服务编排替身测试。原有 20 个回归测试文件源码保持；没有删测试或放宽超时。

真实数据库验证包括：三处写入故障和重试、完成先赢、较新 claim、跨帧依赖、异组织/错误 frame、批次已提交但回执丢失、历史半取消修复、迟到创建、primary 投影与迟到 setter/handover。工作流终止为明确替身；没有真实供应商、邮件、R2 或远程数据库调用。单条 Drizzle UPDATE 和 db.batch 的错误包装不同，故障断言核对同一个根 SQL 错误消息，并继续检查真实数据回滚，没有为了错误包装去修改生产异常。

最终类型、lint、10 个源路径格式、生产 client/SSR 构建，以及正常提交 hooks 的类型、lint、格式、knip 和边界 17 项均通过；具体结果在验证记录中保存。全仓 lint 147 条警告位于本批范围外。独立只读审查的实际范围与限制单列，不把评审当作运行时验证。

数据取消已提交不代表供应商任务已停止，特别是回执丢失后可能尚未尝试终止 RPC。已开始的费用和所有迟到 realtime 事件并未由本批解决。整个旧根子树的内容写入归属、完整素材事件归属、邮件、独立 Update all 预检、旧任务和真实环境验收继续开放；missing dependency 及其他非取消失败沿用原行为。

五份冻结 inventory 的 1,219 项均保持 pending、零批准，与 sourceBefore 一致。源码提交：4c6623759ff57b11cb1d0d4de1427fd256aab990。精确命令、首次失败、复跑、边界与指纹见 [implementation.json](implementation.json) 和 [verification-results.json](verification-results.json)。
