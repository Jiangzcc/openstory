# G09-ownership-verify：组织归属、引用权利与匹配验证

日期：2026-11-13，Asia/Shanghai。状态：**reviewed-with-open-risks；G09 验收未完成**。本批完成边界审查和可复现证据；发现六项开放缺口，没有把“上游原样保留”等同于“实现没有问题”。

- 实施工作区：D:/code/github/openstory，develop。当前聊天的 C:/Users/lszhichaoj/.codex/worktrees/p3-g03-baseline/openstory 仍为旧对照，未在该处实施或提交。
- sourceBefore：315081f74472c72ad02e9523d86019193327e68f；测试提交：4dcb039ec534dfbf3cdc2dc8623a7bb893d16b2a。
- 固定上游 B：2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0；没有 fetch 或合入新的上游。
- G09-reference-projection 和 G03 有限快照传播证据为依赖；G03 的原测试冷导入超时及领域生命周期覆盖风险继续保留。

## 本批做了什么

静态枚举 cast 根目录 11 个 .fn.ts 的 87 个 server function，并追到共享 media-upload.fn.ts 的 7 个角色／地点入口，共 12 文件、94 个声明。93 个声明访问中间件；公开的 getVoiceDesignAvailableFn 只返回服务可用性布尔值。[入口清单](web-entrypoints.jsonl) 是声明及调用链证据，不能当作 94 个 HTTP 端点的动态授权验收。

沿[调用矩阵](caller-matrix.json)核对独立页、sequence、analysis、recast/replace、上传与视觉描述、upload-check、sheet 与 portrait、REST/MCP 薄适配。组织实体、链接、条件 claim、face/rendering、引用 hash、声音释放仍由原 owner 负责。明确保留系统管理员的既有跨组织 sequence 接入能力，不能将其误当作需要删除的权限漏洞。

新增两个正式回归文件、14 项组合测试：

| 文件                                                    | 项数 | 真实部分                                                                                                     | 替身及边界                                                                                         |
| ------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| src/cast/server/upload-ownership-contract.test.ts       |   12 | D1 权利记录与地点写入、真实 requireUploadRights/requireCheckable、创建与描述服务                             | storage、sheet dispatch、视觉模型与余额/扣费 collaborator 为替身；拒绝在副作用前，未实际预留或扣费 |
| src/cast/server/db/character-ownership-contract.test.ts |    2 | CharacterSheet runImpl、迁移后的内存 D1、claim/promote/history/hash、无 sequence 存储目录与角色 channel 选择 | 供应商、R2、余额、实时传输、portrait 派发及 step 调度为替身；未验收持久引擎                        |

角色审查见 [character-audit.json](character-audit.json)，地点审查见 [location-audit.json](location-audit.json)。原有测试还覆盖 attached/shared 不被 analysis 重写、soft link removal 保留声音、过期任务保留历史等有限契约，不能据此批准整个目录。

## 六项开放缺口

| ID                    | 观察与根因                                                                                              | 证据边界                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| G09-LOC-01            | createBulk 的 boundTo/bind 分支未先 requireSequence，可以把本组织地点链接到其它组织序列                 | 真实本地 D1 直接 scoped-db 调用；未证明 HTTP/API 可利用                                                |
| G09-LOC-02            | 外组织 sheet completion 的版本 insert/park 已提交，随后 scoped parent read 才抛 not found，留下历史行   | 真实 D1；父选择指针没有被推进；不能将异常理解为写入回滚                                                |
| G09-LOC-03            | location insertDivergent 的已有行查找和插入缺 parent 组织限制                                           | 直接插入已动态复现；已有行读取风险为源码发现                                                           |
| G09-LOC-04            | 无 stored consistencyTag 的纯中文地点经 canonicalBibleTag → ASCII slugifyTag 得到空 tag                 | 上海车站／北京书店真实创建并 attach；涉及 tag/hash，不修改公共 slug 或既存摘要                         |
| G09-LOC-05            | 中文正文 fallback 经 ASCII tokenize 得到空 tokens，漏掉点名地点                                         | 正文点名失败；sceneLocation 精确中文匹配的对照通过；已有 normalizeLocationKey Unicode 改造未覆盖该分支 |
| G09-UPSTREAM-GUARD-01 | analyzeDraftElementFn 通过媒体 URL 语法校验后直接进入凭证、余额和付费视觉描述，未验证文件归属与权利记录 | 实际 handler 源码 + 注入的可信 context、全外部 collaborator 替身；非 HTTP 或真实扣费验收               |

前三项 locations/variants/shared landing 与 canonical tag 文件均与 B 按 LF 规范化后相同；正文 tokenize/matchLocationInText 片段与 B 相同。未在 B 独立运行地点 D1 探针，因此不把静态同源说成 B 动态成绩。草稿视觉 handler 的 B/current 各两例则已隔离执行；四例均到达 vision/debit 替身边界。[复现脚本](draft-element-guard-reproduction.mjs)和[结果](draft-element-guard-reproduction.json)保留具体事件，退出 0 表示成功复现缺口，不表示权限保护通过。

## 红灯诊断如何保留和重跑

地点新探针是 **9 项、4 通过、5 失败、0 跳过**。[原始探针源码](location-ownership-contract.test.ts.txt)以文本逐字节归档，SHA-256 为 68ad46088cc4728e689b764153442ec831c4ac0fd370dfa83bacc92be07d638c；所有断言和 import 均保留。它不成为默认回归承诺，也没有改成 skip、xfail 或“应允许跨组织”的断言。[归档说明](diagnostic-relocation.json)区分首次源路径与最终重跑路径。

从仓库根目录运行：

```sh
node docs/secondary-development/preservation/20261113-p3-g09/run-location-diagnostic.mjs
node docs/secondary-development/preservation/20261113-p3-g09/draft-element-guard-reproduction.mjs
```

地点 runner 以 wx 独占创建一个原 db 测试目录内的临时文件，使用当前未修改的根 Vitest 配置，仅执行该文件，并在 finally 只删除自己创建的文件；目标已存在即拒绝覆盖。最终显式运行仍为 4 通过、5 失败、退出 1，临时文件已清理。根测试配置、质量规则、原测试断言和 timeout 没有为归档而放宽。

## 验证结果与保留证明

- 整合运行 36 文件、515 项：510 通过、5 失败；失败均为地点新诊断。之后新增角色 2 项，并对分组调整后的上传 12 项一起最终复跑，14 项全通过。
- 按最终源码与测试去重：37 文件、517 项，512 通过、5 失败。其中选定常规回归 36 文件、508 项通过，独立地点诊断 9 项为 4 通过、5 失败。这个统计由原 34 文件的 494 项、最终新增常规 14 项及诊断 9 项组成，并非一次完整仓库测试；不重复累计中间 160 项、复跑或提交钩子。
- 34 个原测试与 sourceBefore 归一化源码相同；44 个审查生产来源未变。没有修改生产实现、数据库 schema/hash 或根测试配置，也没有恢复任何上游核心生产路径，因此不宣称本批降低未来冲突文件数。
- 初次上传测试 2 项失败是新断言误把 null 当作 undefined，已修正预期。归档脚本的 Function 构造及初版 docs 可执行诊断触发 lint；最终分别使用隔离 VM 和原始文本 + 显式 runner，未削弱规则。地点五项红灯始终保留。
- 全仓 lint 最终退出 0，146 条警告均在本批范围外；初次 typecheck 通过，正常测试提交的 typecheck、lint、format、dead-code 与 client-server-boundary 均通过。最终交付检查及原始日志的摘要/hash 见 [implementation.json](implementation.json) 与 [verification-results.json](verification-results.json)。
- 本批只新增测试和文档，未重跑生产 build；不引用上批 build 当作本批成绩。没有浏览器、真实 R2、远程 D1、真实供应商、实际扣费或 Cloudflare 持久重放验收。Intent 技能发现/加载解析并下载过两个缓存包，不能称整个过程零网络；没有改变仓库依赖。

## 冻结边界和后续建议

GC-09 冻结 stopCondition 是：“仅共享确定投影；需改hash/schema/guard/ownership则停止。”本批据此只完成诊断和归档，**G09 验收及 GC-09 整体责任均不关闭**。相关失败不是继续扩大通用生成器的理由。

建议后续明确调整该边界后，分别做三个最小职责变更：地点原 owner 补组织检查（优先参照角色版本入口已有 requireLook，保留通用 landing/claim 语义）、草稿元素在原请求服务补归属与权利 gate、中文 fallback 独立设计并核对持久 tag/hash 与旧英文行为。没有在本批实施这些修复，也没有预先批准任何匹配策略。

G03/G07 的开放项、CONTINUE-LLM-SOURCE 用户暂缓项、GC-09 其它职责及全量 P3 仍开放。冻结目录 25 文件保持原始字节，1,219 项 inventory 全部仍 pending。[实施台账](../p3-implementation-log.jsonl)仅追加第 11 条，不改前十条。P4 未开始。

本批仅在原 develop 本地提交，不推送、不部署。
