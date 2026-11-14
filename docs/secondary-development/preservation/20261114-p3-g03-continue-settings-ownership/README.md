# P3 / GC-03：Continue 设置与启动归属

本批承接[启动占槽与持久恢复](../20261114-p3-g03-startup-exclusion/README.md)，处理网页与 MCP Continue 在启动前保存设置、失败后恢复旧值所造成的并发覆盖。GC-03/P3 仍为 in-progress，P4 未开始。

## 原行为与根因

旧 `withContinueSwitches` 在占槽前先保存四个设置，回调启动器再从共享行读取设置，拒绝时无条件写回调用方旧快照。B 从 S0 保存 S1 后暂停，A 同样请求 S1 并成功启动，B 的失败回滚仍能覆盖 A；比较当前值是否为 S1 不能识别这类同值 ABA。异值请求还可能把启动前的临时设置混入另一个请求的 payload。

## 本批实现

网页与 MCP 将准备结果中的停止阶段和三个显式布尔值组成 `settings` 交给 `triggerContinue`，停止阶段只有一个来源。启动器在异步流程前复制设置，在语音配置校验和生成 payload 之前覆盖请求快照。删除提前保存和失败回滚，继续使用既有 `prepareContinue`、余额检查、合规检查和模型准备。

四个设置与 workflow slot、processing/清错、原 prepared 请求、开始活动在同一 D1 batch 提交。设置历史在 UPDATE 前以同一个 sequence/organization/expected-slot 条件读取真实旧停止阶段，并保留已有 summary 和 JSON 结构；事件 ID 先于开始活动分配。停止阶段相同或仅布尔开关变化时不增加设置历史。

确定拒绝或 CAS 落败不会改动设置；SQL 失败回滚整批写入；占槽/create/确认回执未知不触发设置补偿，已提交内容由上一批的 exact-ID 协议继续恢复。数据库还核对请求设置与 prepared payload 的四项映射，防止快照与保存值分离。本批没有新增 schema、迁移、设置版本令牌或平台领域例外。

## 验证与剩余边界

原版已有真实数据库同值 ABA 单项失败证据。实现和验证的精确文件范围、提交、最终测试结果、正常 hooks 及独立审查保存在 [implementation.json](implementation.json) 与 [verification-results.json](verification-results.json)。测试使用生成迁移加载的 SQLite/D1 兼容层，替换引擎准备、create/status 和外部领域读取；没有执行真实 Cloudflare 或付费模型调用。

本批修复 Continue 启动归属。内部普通 `sequences.update` 仍接受这四个字段，Workflow 启动步骤仍在 owner guard 下重复停止阶段，不由此声称已有通用设置版本或独立设置编辑失效协议。后代取消、完整内容与事件归属、外部发送与邮件一致性、独立 Update all 预检、无 durable request 的旧 raw claim 及真实运行环境验收仍未关闭。独立发现的 create 未持久化 `draftMotion` 是另一条路径，本批不顺带改写创建行为。五份冻结 inventory 的 1,219 项保持 pending，本批没有批准原 inventory 项。
