# P3 G02 任务模型配置快照验证与断链修复

日期：2026-11-12。验证前提交：`ce67452ad64c02bda60b6ff867bae238096eaefb`；代码与功能文档提交：`98346494abc05e7a268e2e2bbbb6f4807d96a3da`。

本轮完成 G02-verify 的有限技术契约验证：请求侧捕获可信模型配置，root 封装并经 JSON 传输后，任务执行和失败处理继续消费同一快照。完整调用者审查发现两处断链，已做最小修复并取得改前失败、改后通过的证据。GC-02 逐文件语义处置没有批量批准，P3 整体仍进行中，P4 未开始。

## 原行为、动机与范围

上游已有 root workflow、scoped DB、组织权限和共享钱包。二开模型配置在请求侧捕获 defaults、渠道身份、协议、能力、价格和不可变 credentialId；凭证执行时按该 ID 解密。保留 queued 配置是二开扩展的既有契约，本轮没有增加供应商、售价或钱包能力。

本轮只修改两个生产文件：freeze-fresh-generation-plan.ts 与 smart-retry.ts；新增四个测试文件，补两份功能文档。没有增加生产模块、扩大 platform 的领域依赖或重写 root 配置体系。上游生产修改路径恢复为 0，不宣称减少未来冲突数量。详细范围见 [implementation.json](implementation.json)。

## 发现与修复

| 缺口         | 修复前的实际调用链与影响                                                                                                                                                                             | 本轮修复与红绿证据                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G02-AUDIT-01 | 旧 payload 缺配置或缺 imageModelRouting 时，fresh-plan 将 undefined 传入 computePlan → buildPlanReferences → configuredImageRoutingForModels，最终读取当前管理员配置；可能改变未缓存的参考图计划报价 | 仅在 workflow fresh-plan 边界归一为显式空路由 []。5 项贯通测试在旧实现上 2 失败、3 通过；修复后连同原套件共 2 文件、19 项通过。请求侧缺配置仍可正常捕获当前路由                                  |
| G02-AUDIT-02 | prepareRetry 将同一配置传给 dry-run 和 execute，但 motion、music、music-prompt 分支没有继续传给 root；各 root 会重新捕获当前配置                                                                     | triggerKeyed 以分支专用配置为优先，再取可信外层配置；direct music 在有配置时转发 options，无配置时保留原两参数调用。新增 15 项在旧实现上 5 失败、10 通过；修复后与两个原套件共 3 文件、52 项通过 |

第一项的合成 fixture 报价由期望的 30,000 微美元变为当前渠道的 100,000 微美元，是本地计划报价对照，不是实际用户扣费证据。第二项证明参数传播丢失与修复，未证明此前 motion/music 有钱包错账。claim、reservation、deduplication、status、onLaunched 和 dry-run 的既有流程未改。

[调用者矩阵](caller-matrix.json) 的原始扫描记录针对 sourceBefore：发现时解析 2,245 个 TS/TSX 文件，其中生产文件 1,495 个；32 个 root/共享服务派发点分布于 29 个具名函数，27 个准备/loader 符号有 72 条直接调用边。当前没有 getModelRuntimeConfiguration 符号，实际入口为 load* 和 scoped readers。原行号和旧 finding 保留其历史含义，修复状态及 sourceAfter 指纹另列；52 个审查来源中仅上述两个生产文件改变，其余 50 个未变。不能把静态发现数量说成全部动态入口验收。

## 新增验证的真实与替身边界

| 测试文件                                                        | 项数 | 真实执行与观察                                                                                                                                                                                                  | 替身及边界                                                                                                                                    |
| --------------------------------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| src/platform/server/workflow/model-snapshot-composition.test.ts |   11 | 生产 D1 配置读写、加密 credential 记录、root client/trigger binding、JSON wire、workflow base、ScopedDb 和凭证解析；捕获后管理员改 defaults、协议、endpoint、能力、rate、credentialId，任务和失败处理仍用旧快照 | actor/配置为 synthetic fixture；最终 binding、step runner、analytics/E2E seed 为替身；没有认证 HTTP、Workerd transport 或持久 checkpoint 引擎 |
| src/models/workflow-routing-contract.test.ts                    |   11 | 真实 runtime/text/image packer 与 decoder 经 JSON 往返；完整渠道身份、falsy/0、legacy v1/数组、缺省和空数组区别；合法图片参数覆盖 262,143、262,144、262,145 UTF-8 bytes 的准入边界                              | 图片路由分量限制，不是整个 payload、checkpoint 或生产 heap 的证明                                                                             |
| src/sequences/server/fresh-plan-snapshot.test.ts                |    5 | 真实 freezeFreshGenerationPlan → computePlan → buildPlanReferences → configuredImageRoutingForModels 与报价；包含请求侧加载当前配置的对照                                                                       | row readers、generation-plan unit loader、当前配置 loader、fal rate card 为标明的合成替身                                                     |
| src/sequences/server/smart-retry-snapshot.test.ts               |   15 | 真实 retry 分析、定价和分支编排；最终 trigger 观察快照对象，覆盖三独立分支、混合分支、image 专用配置优先、full、缺外层配置及 dry-run                                                                            | DB、reservation、launcher/config capture、最终 trigger 和通知为替身；不是完整 retry HTTP 或供应商执行                                         |

root 组合的 SQL 观察只允许按不可变 credential key 读取，拒绝读取当前 defaults/channel registry；捕获凭证不存在时，即使替代渠道和平台凭证存在也失败。body 中伪造配置仍由 root 覆盖；可信 prepared option、显式空路由、重复实例原 payload 和 oversize 零启动均覆盖。

## 最终验证与保留证据

- 最终同一轮 `bun run test --maxWorkers=4 …`：36 文件、640 项全部通过，用时 407.01 秒；其中原 32 文件保持源码不变，本轮新增 4 文件、42 项。命令和完整路径见 implementation.json。之前的局部成绩与钩子额外执行的 17 项 client/server boundary 测试不重复计入。
- `bun typecheck` 与 `bun lint` 通过；lint 146 条警告均在本轮八文件范围外。
- 两处生产修复后的 `bun run build` 通过，客户端与服务端阶段分别显示 4m 和 2m 35s；构建日志保留现有 bundler/plugin 提示，没有把旧构建当成本轮结果。
- 正常代码提交钩子用时 203.14 秒，client-server-boundary、dead-code、format、lint、typecheck 通过，没有跳过检查。钩子后八文件归一化源码与最终验证启动时相同。
- 原 32 个测试的归一化源码均与 sourceBefore 一致；冻结设计目录未改，1,219 项原 inventory 仍全部 pending。尺寸、复杂度、嵌套及强制常量/枚举规则按用户决定不作为门槛或债务。
- 最终日志、红绿日志与提交日志位于本地 `.tmp/p3-g02-20261112/`，对应 SHA-256 记录于 implementation.json。初期测试 fixture、SQL 观察器、类型和 lint 修正单列，未将 harness 失败冒充目标缺口红灯。

## 用户原有工作区修改

按用户“另外工作区原有的两项修改后面也提交了”的授权，独立提交 `41ddf826f597760b59d4d9a0f9dc002cd4f3b988` 保留 .codex/project-rules.md 中取消硬规则的原始删除。src/routeTree.gen.ts 的 Git 内容对象与 HEAD 相同（`a1df6ca62d3554fb1f7218090ee8d7a9c94e4589`）；精确 git add 后状态已刷新，它没有实际内容差异，因此没有制造一个路由变更提交。两项处理前后的原始字节指纹保留在机器记录。

## 仍待推进

- 下一批为 G03-verify，检查父子任务的快照继承；当前矩阵只定位三个 workflow 内 direct trigger，不宣称已完成其传播验证。G09-ownership-verify 继续按 G03 前置推进。
- G07-callers 已登记的音乐 claim 异常后新 hold 清理、motion 估价时长、motion 引用路由估价风险仍开放；CONTINUE-LLM-SOURCE 按用户决定暂缓。
- 配置 loader 仍读取多个 D1 记录，本轮没有建立全局原子配置版本。legacy codec 接受旧路由格式不代表允许缺少 promptLocale，任务语言仍必须合法。
- MODEL-SNAPSHOT-CONTRACT 复用 MC-13，不据此关闭整个 MC-13 或 GC-02，也不批准冻结清单的全部差异。真实供应商、远程 D1、浏览器/Workerd HTTP 和持久 Workflows 重放均未执行。

仅本地提交，没有推送或部署。实施进展仅追加到 [P3 台账](../p3-implementation-log.jsonl)，冻结设计保留原始时间含义。
