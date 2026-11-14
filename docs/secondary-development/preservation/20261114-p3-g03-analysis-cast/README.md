# GC-03：分析角色、地点和元素的根任务归属

本批完成本地实现和验证；GC-03/P3 仍为 `in-progress`，P4 为 `not-started`。起点为 `14dbc6c103988349282b82139033ac92d19b562b`，源码提交为 `f9a2ab5921abb7f92d4b02d7f7999c323bd2a560`；26 个 Git blob 指纹及精确范围见[实现记录](implementation.json)，首次失败、命令和替身边界见[验证记录](verification-results.json)。冻结 inventory 的 1,219 项仍全部 `pending`，没有批准原始条目。

## 原有能力与根因

上游已有组织共享角色、服装和声音、地点匹配/链接、生成元素、历史版本、claim、活动和清理。原分析方法先读取组织或父对象，再按 ID 写入；根任务换主、终态或真实父关系变化后，迟到的内部版本、指针、状态及清理仍可能落库。只在 `createCastRecords` 外围检查一次，不能保护这些实际 SQL。

## 本批实现

新增窄 `storyboardCast(owner)`，绑定 `characters.create`、`characterLooks.syncFromAnalysis/linkFromAnalysis`、`locations.createBulk` 和 `sequenceElements.create`。方法拒绝不属于该根序列的参数；实际 SQL 同时检查组织、序列、当前根实例/显式可信 claim 与 `processing`。共享 scope 通过真实 character→cast、look→character→cast、location→link 关系验证既有目标。新建内部 ID 可在原 batch 中先于 link 入库；地点匹配和已移除 link 后的孤立地点清理使用组织加根归属及原有资格条件。

覆盖角色/bible/cast/服装/版本 INSERT、选择指针、状态、claim 撤销、默认服装回填、legacy features 迁移、独立声音描述 batch、服装恢复/退休及活动，以及地点身份/bible/link、重指向、冲突删除和后续孤立清理。生成元素的条件 INSERT 保留 schema 默认值与编码。多服装 INSERT 拆成原子 batch 内的语句以控制 D1 参数；没有把一个 batch 拆成多个提交。

AnalyzeScript 把既有可信根传入 `createCastRecords`。独立 `withOwnership` 前后及失败检查覆盖空输入和复用元素；它不替代 SQL 谓词，也不提供整段事务。确认换主在 `create-cast-records` 步骤内不可重试；未知校验保留重试及原因，引擎 abort 保留。服务内原顺序按角色、地点、元素拆为短函数；普通无根调用保持原行为。

共享/attached bible、removed link、archived 序列、changed-only history、isPerson 单调规则、sheet/voice claim、服装退休资格、上传元素优先和数量上限均保留。已授权的较早 batch 可以在后续换主失败后留下。没有 schema、迁移、依赖、绑定、cron、公开 API、计费、模型路由、hash 输入或新增具名 workflow read hatch 变更。

## 验证

- 新增 212 项：54 项角色/服装、64 项地点、83 项 facade/scope/元素、11 项真实 `createScopedDb → toWorkflowScopedDb → createCastRecords` 组合。另在既有两项可信根传播测试中追加 cast 参数断言，保留原风格断言。
- 最终 57 文件、1,610 项全部通过；50 个原有入选测试文件保持原 Git blob。真实数据库验证初始化、重复执行、共享、父关系变化、部分成功、no-op、错误及 D1 参数上限；7 个新服装的 14 条 INSERT 同批提交，末条失败会完整回滚。
- 保留新 facade、服务及方法前后检查，恢复起点四个原 DB factory 后，选中 32 项竞争/父关系用例全部失败，115 项按过滤跳过；随后在 `finally` 精确恢复四文件工作字节，相关 212 项复跑通过。
- 类型、26 路径格式、全仓 lint、生产 client/SSR 构建和正常提交 hooks 通过，保留 147 条既有 lint 警告。首次组合用例误把其它测试组织的行计为空，改为严格比较原有行；早期并行编写中的测试未使用 import 已消除。SQL 夹具移入 DB 测试目录后消除 lint 边界诊断，未增加例外；首次 hooks 的三个多余夹具导出已改为私有，再走正常提交检查。
- 13 个新增文件及 cast 服务的新建/拆出函数经 Oxc AST 检查，满足长度、圈复杂度及嵌套约束。原样保留的 `buildLocationInsert` 复杂度为 11，其 AST 与起点一致；既有大型 DB 模块只改必要接缝，不据此宣称全仓达标或顺手整改无关函数。
- 独立只读审查无可操作问题；17 个受审源码/共享依赖的原始字节 SHA256 与最终源码核对一致。全部最终整合结果由主执行者运行；领域子任务结果不重复累计。

证据使用完整迁移后的进程内 Node SQLite、真实 Drizzle D1 驱动和 scoped DB。SQL 时点替身延迟真实语句或整个原子 batch，不模拟 batch 内并发。Cloudflare 引擎/错误类及工作流边界为显式替身；未调用供应商。构建和本地验证不代表部署后 Workerd/D1、浏览器或供应商验收。

## 开放边界

- 本批只覆盖 AnalyzeScript 的 cast 阶段；其它后代、独立编辑/生成入口及完整内容/素材事件归属仍开放。
- 共享资格检查与实际写入之间新增 attach 的原有并发窗口未重设计。原有元素 token lookup 与 INSERT 的唯一约束竞争仍保留；重复 token 的实际 SQLite 错误没有被吞掉。
- 整个根任务取消、旧缓存 checkpoint、无根身份任务、独立 Update all/CLI、邮件及检查后才发生的 realtime/preview/callback 竞态仍待处理。已授权 batch 不会因后续换主自动回滚。
- 未推送、部署、迁移现有数据库、调用付费模型或发送邮件。真实重启/回放、多实例、浏览器收敛、供应商终止及钱包结算仍未验收；本批闭合不代表 GC-03/P3 闭合。
