# GC-03：自动风格写入的根任务归属

本批完成本地实现和验证；GC-03/P3 仍为 `in-progress`，P4 为 `not-started`。起点为 `74a773d105164789e460dc4aac89c7eed0837e3a`，源码提交为 `355dee0cd0de8d67a5a588f044b110d1ec616fe1`；15 个 Git blob 指纹见[实现记录](implementation.json)，完整命令和首次失败见[验证记录](verification-results.json)。冻结 inventory 的 1,219 项仍全部 `pending`，没有批准原始条目。

## 原有能力与根因

上游已有从脚本派生自动风格、序列绑定风格、提升到组织风格库、风格历史及选择指针。本批没有把这些算作新增能力。原风格 UPDATE 仅检查组织及序列绑定，原快照 INSERT 不检查根任务；即使方法入口查询归属，旧任务仍可能在预检后换主或终态后写入风格、历史和选择指针。

## 本批实现

新增窄 `scopedDb.storyboardAutoStyle(owner)`，只返回原 `styles.setGeneratedForSequence` 和 `sequences.snapshotAutoStyle`。风格 UPDATE、历史 INSERT 和指针 UPDATE 在实际 SQL 中检查同组织、同序列、当前根实例/显式可信 claim 与 `processing`。两个 writer 提取为独立 DB 模块，由普通入口和绑定面复用；默认查询顺序、JSON/default 编码和 batch 边界保留。

AnalyzeScript 通过既有 `resolveStoryboardOwner` 传递可信根，自动风格在 `save-automatic-style` 步骤内使用绑定方法和共享错误适配器。分析子实例、通知父任务或子实例名称不被推断成根权限。方法前后、空结果和失败的检查复用既有协议：确认换主在步骤内不可重试，未知检查仍可重试并保留原因，引擎 abort 原样传播。无根身份的独立入口保持普通 writer。

提升到风格库后不能被迟到任务重写；用户另选风格后选择指针不被覆盖。若用户在快照预读与 batch 之间改选，原有历史行仍可保留；这不是新增去重或事务行为。已授权的风格 UPDATE 与后续快照仍分开提交，后者换主失败不会回滚前者。LLM 请求、语言、模型快照、reservation、收费规则、返回配置、步骤名和通知行为保持原有约定。

没有 schema、迁移、依赖、绑定、cron、公开 API、hash 输入或新增 workflow read hatch 变更。

## 验证

- 新增 122 项：106 项实际迁移后 Node SQLite/D1 数据库矩阵、5 项真实 `deriveAutoStyle → scopedDb → writer` 组合、9 项显式错误适配/独立入口替身、2 项真实 AnalyzeScript 主体配替身的可信根传递。数据库矩阵覆盖组织/序列、根实例/显式 claim、全部非 processing 状态、no-op 后换主、18 项 SQL 时点竞争、普通入口、提升/改选、历史/指针回滚及编码。
- 最终 39 文件、1,132 项全部通过。36 个原有入选测试文件未改；既有分析输出测试只加强 mock 的签名并追加两项根传递用例，原断言保留。
- 恢复起点的两个原 DB factory，并让新窄面调用它们、保留前后归属检查后，18 项实际写入竞争全部失败，88 项按过滤跳过。初次过滤未选中用例，未计为红测。之后在 `finally` 中精确恢复三个修复文件的原始工作字节，120 项相关用例复跑通过。
- 类型、15 路径格式、全仓 lint、生产 client/SSR 构建及正常提交 hooks 通过，保留 147 条既有 lint 警告。首轮新夹具漏填 title、父 binding 字面量类型及 JSON 可选字段序列化断言已修正；临时 AST 审计脚本的两个 lint 诊断随该临时文件移除而清除。
- 七个新增文件及自动风格步骤文件的 Oxc AST 检查满足文件/函数长度、圈复杂度和控制嵌套约束。既有大型 factory 仅保留必要委托接缝；步骤内函数拆分围绕同一发布职责，外部行为不变。
- 独立只读源码审查无可操作问题；主执行者运行所有验证。另已梳理后续 cast 写入链，尚未修改或验收该范围。

数据库证据使用完整迁移、真实 Drizzle D1 驱动与进程内 SQLite。时点替身延迟真实语句/整个原子 batch，不伪造 batch 内并发；Cloudflare 引擎/错误类、LLM 和 realtime 为显式替身。构建和本地测试不代表部署后 Workerd/D1、浏览器或供应商验收。

## 开放边界

- 共享角色/服装/声音、地点链接/清理及生成元素仍开放。后续应覆盖 `characters.create`、`characterLooks.syncFromAnalysis/linkFromAnalysis`、`locations.createBulk`、`sequenceElements.create` 及内部版本、指针、claim、活动和清理，不只在 `createCastRecords` 外围加检查。
- 本批保护持久化，不保证已启动的 LLM 停止或不会继续产生供应商成本。成功检查后与 `generation.style:ready` 之间仍可能换主，完整事件归属另行处理。
- 整个根任务取消、其它后代、缓存 checkpoint、缺根身份任务、独立 Update all/CLI、邮件及真实重启/回放、多实例、浏览器收敛、供应商终止与钱包结算仍待完成。
- 未推送、部署、迁移现有数据库、调用真实模型或发送邮件。本批闭合不代表 GC-03 或 P3 闭合。
