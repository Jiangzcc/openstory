# GC-03：分析结果发布的根任务归属

本批完成本地实现和验证；GC-03/P3 仍为 `in-progress`，P4 为 `not-started`。冻结 inventory 的 1,219 项仍全部 `pending`，没有批准原始条目。起点为 `c955d111ff20b1f03220951a8968c584d64893dd`，源码提交为 `19da5acde10f82e478c8e2cf83a14f00c61b078c`；20 个 Git blob 指纹及命令见[实现记录](implementation.json)和[验证记录](verification-results.json)。

## 原有能力与根因

上游已有场景服装连续性、镜头规格、从规格派生图像/运动提示词、版本选择、claim 撤销、旧对白迁移、完成活动及耗时。本批没有把这些算作新增能力。上一批只约束 SceneSplit，AnalyzeScript 随后的发布方法及内部直接 SQL 仍可能在换主或根任务终态后写入。

另一个已确认问题是提示词去重：原规则比较文案、hash 和运动音频，但不比较派生来源及规格版本。同文案、同 hash 可以属于不同规格版本，直接复用会把旧来源重新选中。方法入口查询一次归属或只检查新版本 INSERT，都不能保护后续选择指针、claim 撤销或旧对白 INSERT。

## 本批实现

新增独立 `scopedDb.storyboardAnalysisOutput(owner)`，保持上一批 `storyboardContent` 的返回形状。AnalyzeScript 通过既有 `resolveStoryboardOwner` 取得可信根身份后，在运行步骤前绑定这组窄写入方法；显式根优先，只有既有直接 Storyboard 父任务回退可以提供实例身份，回调地址和子实例名称不被当作根权限。

场景 upsert/连续性、镜头规格、派生图像/运动提示词、完成活动和耗时的每条实际写入，都检查同组织、同序列、当前实例/显式可信 claim 和 `processing`。新 frame/spec 谓词沿真实父关系核对 frame、shot、spec，不能只信 frame 的冗余 sequenceId。覆盖连续性脚本版本/选择、规格版本/选择、两个提示词选择/claim 撤销，以及旧运动对白迁移的 SELECT/INSERT。错误规格不能先触发旧对白迁移。

绑定面的派生提示词去重另外要求同 source 和同 specVersionId。普通独立 writer 的既有跨来源去重保持不变。规格的 canonical/hash/source 去重、pending rewrite claim、运动音频比较、`select: false`、参考模式不写图像提示词、有效旧对白迁移及既有 batch 边界保留；整个规格/提示词循环没有变成一个大事务。

共享 DB 检查器和步骤错误适配器提取为独立模块，供两组 facade 复用，逻辑不变：方法前后及 no-op 返回检查，确认换主在步骤内不可重试，未知检查仍可重试并保留 cause，双重失败保留两个原因，引擎 abort 原样传播。完成日志仍传播归属失败。失败清理回调使用原 DB，不会被 processing-only 内容防线错误拦截。

没有 schema、迁移、绑定、cron、依赖、公开 API、模型路由、计费规则或新 workflow read hatch 变更。

## 验证

- 保留新 facade 和前后检查，用起点提交的四个真实 DB factory 原源码复跑：四个预检后写入竞争、四个派生来源去重用例全部失败；随后精确恢复修复后的工作文件字节。
- 新增 259 项回归：155 项迁移后的 Node SQLite/D1 数据库矩阵、101 项显式替身适配/运行时验证、3 项真实 `createScopedDb → toWorkflowScopedDb → binder → persistShotSpec` 组合调用。普通/参考模式、实际派生/hash、重复执行，以及规格提交后换主保留已授权规格但拒绝迟到提示词均验证通过。
- 最终 32 文件、939 项全部通过。原有 28 个入选回归文件未修改，child-context 只补已标明的 factory 替身，保留原有断言与 spy。
- 类型、20 路径格式、全仓 lint、生产 client/SSR 构建和正常 hooks 通过；保留 147 条既有 lint 警告。knip 早期发现两个只在新 fixture 内使用的多余导出，已移除。新增八个文件及扩展 scope 的 Oxc AST 检查满足文件/函数长度、圈复杂度和控制嵌套约束；原有大型 factory 仅改必要接缝，新增旧对白 INSERT helper 保持修改后的迁移函数不超过 50 行。
- 独立只读源码审查无阻断；主执行者运行最终整合验证。原有 SceneSplit 错误及绑定协议测试一并通过。

数据库证据通过实际 Drizzle D1 驱动、完整迁移和进程内 SQLite；竞争替身只安排真实 SQL 的执行时点。Cloudflare 错误类、工作流引擎、模型结果和适配器的替身均显式标明，不是部署后 Workerd/D1、浏览器或供应商验收。

## 开放边界

- `createCastRecords` 内组织共享角色、look、voice、地点链接/清理和生成元素，以及自动风格和序列风格快照，仍需后续归属协议。
- 其它后代任务、整个根任务取消、内容/素材事件、成功写入后换主的 realtime/phase/preview/callback、旧缓存 checkpoint、无根身份任务、独立 Update all/CLI 和邮件一致性仍开放。
- 既有每方法 batch 保留，较早授权的历史可在后续失败后留下；本批不保证整段分析原子性。上一批尾部跨语句裁剪和大于 100 场景 ID 的读取限制未扩大处理。
- 未推送、部署、迁移现有数据库、调用真实模型或发送邮件。真实重启/回放、多实例并发、浏览器收敛、供应商终止与钱包结算验收仍待完成。
