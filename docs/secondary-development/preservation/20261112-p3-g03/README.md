# G03：父子任务快照传播与恢复契约验证

启动日期：2026-11-12；收尾日期：2026-11-13。状态：**reviewed-with-open-risks**。本批完成有限传播契约的审查、修复和验证，仍保留基线超时及领域生命周期覆盖风险；不代表 P3、GC-03 或 MC-13 全部完成。

- sourceBefore：`00cc4625c3823affa92186fbe98b66850e6e755a`。
- sourceAfter（代码、回归和功能文档提交）：`0dd178b3e00c2dc3e8a3a5b0ae711113ae37bf14`。
- 纯上游 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`；冻结设计 S：`db3ea57b5f419f69c51369c28819de17515b21f5`。
- [implementation.json](implementation.json) 保存实际命令、成绩、替身、文件指纹及上游保留证明；[caller-matrix.json](caller-matrix.json) 区分起点发现与修复后状态。

## 原有职责与本批改动

上游已有每父实例的子任务 ID、AlreadyExists 复用、通知地址、等待、超时后状态恢复、engine abort 透传及终态通知。二开要求父任务的 promptLocale 和模型配置快照进入子任务；领域仍显式决定业务 DTO、身份和资金引用，平台只负责派发、等待与通知。

本轮解析 1,461 个生产 TS/TSX 文件，未出现解析错误；识别 34 个工作流类、16 个包含派发的父工作流和 35 条领域派发边，其中 28 条 awaited child、3 条工作流内独立 variant/grid root、4 条经 portrait/preview helper。31 个仅请求根入口排除在这 35 条之外，独立请求 framing grid 单列。路径覆盖不是全部业务状态的动态验收。

起点有 33 条边继承配置，两条 portrait 边共用的 helper 漏传配置：CharacterSheetWorkflow 与 LocationSheetWorkflow 没有把 scopedDb.models 交给 triggerSheetPortrait，helper 又未提供 root 的可信 modelConfiguration option，实际 client 因而重新读取当前管理员配置。即使 portrait 的 model key 固定，已配置的图片渠道、能力、价卡和 credential reference 仍可能改变。

生产修复限于三个文件：给既有 helper 增加可选的内部第三参数，两个父工作流在原 trigger-portrait step 传 scopedDb.models。上传 sheet 的请求调用继续独立捕获当前配置；原版本去重、保存后派发、enforcement guard、失败只记录日志以及 portrait 的独立 hold/charge 保持。不传递父 reservationId、ownsReservation 或 _parent。

红灯为新增 portrait 文件 9 项中 4 失败、5 通过；最终 binding 观察到 current endpoint/credentialId 及合成价卡 0.99，预期是 frozen 0.01。修复后新增 9 项与原 character-sheet 的 10 项共 19 项通过。这里证明的是派发快照，不是实际供应商执行或钱包错扣。

## 新增回归及真实边界

四个新文件共 **31 项**，在最终整合中全部通过：

| 文件                                                                | 项数 | 真实执行                                                                                                                                                          | 替身与限制                                                                                                              |
| ------------------------------------------------------------------- | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| src/platform/server/workflow/child-snapshot-composition.test.ts     |   10 | spawn/notify、base、ScopedDb、迁移后的内存 D1、codec；并发父/子/孙、伪配置覆盖、empty/legacy、缓存步骤、create 后重试、丢失通知/终态父恢复、失败与受控 abort 恢复 | 父/子/孙业务体为 synthetic；binding、step/event、重试/中断调度、analytics 为替身；不是真实 Cloudflare checkpoint 或重启 |
| src/sequences/server/workflows/analyze-script-child-context.test.ts |    6 | AnalyzeScript runImpl、spawn helper、ID、codec 到 binding.create；zh-CN/en、两种完成顺序、split 失败不继续 matching/casting、原 45 分钟 timeout                   | 透明 base adapter、DB/casting、step/event 和 child 输出为替身；空 scenes 不覆盖后续 shot 生成                           |
| src/shots/server/workflows/variant-child-context.test.ts            |    6 | RegenerateShots runImpl、UpdateStaleShots.spawnImageModel、ShotImages.runImageJob；真实 root/codec/去重到最终 binding；三入口各 zh-CN/en                          | 前置 child、DB/claim、base 和 prepareImage 为替身；不是三个父任务全部分支的完整生命周期                                 |
| src/cast/server/workflows/sheet-portrait-context.test.ts            |    9 | 两个真实父 runImpl、hash/prompt builders、portrait helper、root/codec；两种语言、无 sequence、上传请求、去重和派发失败                                            | 生成/存储、landSheetRun、DB/资金/事件、当前配置 loader 和 binding 为替身；runImpl 直接调用，真实 base 另由平台组合验证  |

35 条领域边的 ownsReservation 全部缺省，不能改写为显式 false。reservationId 有 25 条显式赋值（可能为 undefined）、9 条缺省及 1 条 preview 显式 undefined。请求 framing grid 自己预留资金并设置 Boolean(reservationId)，仍是独立 enrichment，不附加通用父 envelope。

## 最终验证与保留证明

- 最终同一轮 33 文件、489 项：**488 通过、1 超时**，Vitest 用时 387.31 秒；新增 31 项全通过。未将中间 9 文件/202 项或钩子额外 17 项重复累计。
- 超时项是原有 claim-discipline.test.ts 的 every claim domain exposes claim, clear and promote，位于 ScopedDb 冷导入，原显式限制为 20 秒。当前单文件 forks、threads 各复跑仍超时；从 sourceBefore 用 git archive 提取的隔离源码，在同一主机和现有依赖下也复现 4 通过、1 同样超时。没有修改断言、时间限制或测试配置；不能把本轮完整回归写为全绿，也不能据此断定具体主机资源原因。
- bun typecheck 和 bun lint 均退出 0；lint 146 条警告全部在本轮范围外。
- 三处生产修复后的全新 bun run build 退出 0；后续只修改测试 fixture/JSON guard，未把上轮构建冒充本轮证据。
- 正常代码提交钩子：client-server-boundary、dead-code、format、lint、typecheck 全部通过，钩子用时 294.05 秒，提交命令总用时 314.36 秒，没有跳过检查。钩子后九文件归一化源码与最终验证时一致；全仓格式检查没有在本轮重跑。
- 29 个原测试文件与 sourceBefore Git blob 的归一化源码完全一致。await-child.ts 的 11 个具名函数与纯上游 B 的 AST 对照一致；spawn 仅剔除二开新增的 params.modelConfiguration 属性，其余函数不做语义归一化。
- 三个生产文件仅去掉本轮新增的快照 type import、参数、option/调用实参后，其整文件 AST 与 sourceBefore 相同；26 个审查来源只有这三个生产文件改变。
- 本地 .tmp/p3-g03-20261112/ 保存红绿、整合、基线、质量、构建和提交日志；机器记录保存对应 SHA-256。初期 fixture 语言、Set 和 JSON guard 修正单列，没有将 harness 问题当作业务红灯。

## 保留风险和下一批

G03-DOMAIN-01 已修复。G03-DOMAIN-02 仍是覆盖边界：起点 9/16 个父有部分 runImpl 证据，新测另覆盖 ShotImages、LocationSheet；MotionMusicPrompts、MotionBatch、ReplaceElement、RecastLocation、ShotSpecRewrite 的完整父业务体及 Motion lip-sync 子分支等仍未动态穷尽。已有 helper/局部测试不能冒充全部父任务的全生命周期。

G03-TEST-TIMEOUT 保留上述原测试超时；静态边核对与本轮 31 项传播回归为有限技术契约的证据，不意味着默认回归全绿或性能问题已修复。真实 Cloudflare 持久重放、HTTP/Workerd 身份入口、远程 D1、供应商及实际扣费均未验收。

下一批为 G09-ownership-verify；其 G09-reference-projection 和本轮有限快照契约已有证据，G03 的开放项继续保留。G07-callers 的三项继承风险、CONTINUE-LLM-SOURCE 用户暂缓项及其余 P3 职责不关闭。冻结目录保持原始字节，1,219 项 inventory 继续 pending；不据此减少上游核心差异路径或宣称未来冲突数下降。P4 未开始。

仅在 D:/code/github/openstory 的 develop 本地提交，没有推送或部署。[P3 台账](../p3-implementation-log.jsonl) 只追加当前批次，不改写之前九条记录。
