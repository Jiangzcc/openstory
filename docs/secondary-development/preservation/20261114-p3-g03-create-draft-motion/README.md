# P3 / GC-03：保存创建时的 Draft first 设置

本批承接 [Continue 设置与启动归属](../20261114-p3-g03-continue-settings-ownership/README.md) 中单独列出的创建缺口。修复现有草稿生成开关的字段丢失；GC-03/P3 仍为 in-progress，P4 未开始。

## 原行为与根因

现有创建输入、预检估价与共享创建服务均接受 draftMotion，数据库 schema 也已有默认 false 的布尔列。但 sequences.create 手动构造 sequenceData 时遗漏此字段，调用方选择 true 后，返回对象和保存行均变成 false。启动器再读取该行构造 Storyboard payload，因此最初的选择在任务启动前已经丢失。

## 本批实现

只在既有序列创建映射中补上 draftMotion: params.draftMotion ?? false，显式 true 和 false 原样保存，省略保持默认 false。保留现有生成模式、提供方可用性、停止阶段和启动流程；没有 schema、迁移、新接口或额外补偿写入。既有 sequences.ts 已超过单文件行数约束，本批仅增加一行相关映射，没有为满足行数限制拆分其它职责。

## 验证与边界

修改实现前，数据库创建与网页创建各有一项真实失败：请求 true，实际 false。修复后 9 文件、151 项测试通过，其中新增 8 项：数据库创建和网页创建分别覆盖开启、显式关闭、字段省略；启动器覆盖两种布尔值的 prepared/dispatch 快照。

数据库回归使用生成迁移加载的 SQLite/D1 兼容层。网页测试保留真实 Start/auth、输入校验、数据库和共享创建服务，使用显式测试编译适配器并替换最终 dispatch 与外部副作用；启动器测试替换 scoped DB 与工作流引擎。没有把这些证据当成浏览器、真实 Cloudflare 或付费提供方验收，也未宣称公开 API/MCP 的真实 HTTP 回放已经覆盖。精确文件、提交、正常 hooks 和独立审查结果见 [implementation.json](implementation.json) 与 [verification-results.json](verification-results.json)。

五份冻结清单共 1,219 项仍全部 pending，零项批准。后代取消、完整内容/事件归属、外部通知与邮件投递一致性、独立 Update all 预检、Standalone AnalyzeScript CLI、旧 raw claim 恢复及实际环境验收继续保持开放。
