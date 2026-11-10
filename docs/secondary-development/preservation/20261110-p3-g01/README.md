# P3 G01：可信身份与任务语言入口复核

日期：2026-11-10。状态：reviewed-with-open-risks；G01 尚未全面验收，P3 仍进行中，P4 未开始。

## 固定范围

- before：`4a6df66fb27f0bbf39a31ce1a22ea7108e7b2585`。
- 测试及功能文档提交：`822f098cafc426eebd23463e7f1379912c400e7b`。
- 纯上游基线 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。
- [机器记录、原断言对照及验证边界](implementation.json)、[18 类入口矩阵](caller-matrix.json)、[7 个具名声明的上游 AST 对照](upstream-bridge-comparison.json)。

本批落实 GC-01 的 G01-verify，复核已经存在的可信请求与语言薄桥接，并补强回归。没有修改生产代码、增加通用上下文包装器或新增产品能力，不宣称减少上游核心修改路径或未来冲突数。

## 实际改动与保真

新增 middleware-locale.test.ts 的 18 项测试执行真实导出的 middleware server callback，验证网页 Cookie、外部固定 en、伪造输入、认证与 OAuth scope、成员和 compliance 拒绝顺序，以及成员被移除后的写入不会自动切换组织。principal、membership、DB 与 next 为 mock，没有执行完整框架 HTTP 链。

新增 upload-locale.test.ts 的 18 项测试执行真实单次／分片 route callback 和上传目标校验，验证 Request Cookie、真实 owner 参数、JSON 身份不能覆盖可信上下文，以及拒绝发生在存储之前。auth、membership、存储与上传检查为 mock；FixedLengthStream 明确使用流透传测试替身，不能据此认定真实 workerd／R2 长度约束已经验收。

外部 MCP gateway 新增 90 项，覆盖 API Key／OAuth 与五类 Cookie，以及八类伪造字段。真实 serveMcpRequest、SDK、mcpToolContext 和 tool callback 参与执行，已认证 caller、DB factory 与末端 runOneShotCreate 为 mock。当前 create schema 会剥离额外字段，测试保留该行为，未改为拒绝整个请求。原宽匹配断言保留，另加严格上下文断言。

MCP 音频测试补齐必填 promptLocale 的 typed fixture，新增八项 zh-CN／en 到音乐、音乐改写、角色声音和镜头对白的传播回归，检查原文、claim、reservation、版本与触发参数。共享领域服务和迁移后的内存 SQLite/D1 API 真实执行，workflow trigger 与 realtime 为 mock；没有调用真实供应商。

上游原有组织、角色、共享钱包和 API/MCP 能力保持。只有系统管理员 API Key 可以针对外组织 sequence 重绑 scopedDb；OAuth／session 没有该例外，重绑保持可信语言。此项由原有测试继续约束，不把语言接入扩展为权限改造。

静态对照仅覆盖七个具名声明：authRequestMiddleware 的 AST 原样相同；另六个仅去除 promptLocale 属性后 AST 相同。对照不能外推为整个模块或程序与上游等价，也不构成自动语义批准。

## 本轮验证

| 最终互不重叠的测试组           | 文件数 | 测试数 |
| ------------------------------ | -----: | -----: |
| 主线集成                       |     18 |    272 |
| MCP 两文件，fixture 整合后复跑 |      2 |    199 |
| organization-memo              |      1 |      6 |
| 唯一合计                       |     21 |    477 |

- 新增 134 项测试；早期单独运行的 middleware 和 upload 成绩已包含在最终组内，不重复累计。
- 19 个原测试文件的 964 处 matcher-call AST 全部保留。两个修改文件原有 117 处保留，新增 34 处；两个新增文件含 49 处，共增加 83 处。其余 17 个原测试文件归一化源码未改。
- 最终 standalone typecheck 与正常提交钩子的 typecheck 通过；全仓 lint 通过，146 条警告均在本批范围外；五个本批文件格式检查通过，未重跑全仓格式。
- 正常测试代码提交钩子用时 159.04 秒，client/server boundary（17 项）、knip、format、lint、typecheck 全部通过，无 bypass。钩子测试不加进上表的 477 项。
- 本批仅测试与文档变更，未重跑生产构建；生产源码保持，构建证据沿用 MC-B03 在 `95863667e4b58ac43718bd7a15f244787e97094b` 上的 bun run build 通过结果，不记为本批重新构建。

初次 typecheck 发现新测试 harness 中 callback 可选和 route 返回类型宽于 Response，已用运行时守卫修正。初期测试对额外字段和音乐 claim 的预期与实际 schema／pending 语义不符，已修正测试预期；没有为迁就测试修改生产实现。最终 MCP 复跑 199 项通过。

用户在本轮明确取消文件／函数行数、圈复杂度、嵌套层数及强制常量／枚举的数值规则。implementation.json 中尺寸指标只描述事实，不设硬门槛，也不登记尺寸整改债务。

## 仍待验证与全量状态

完整 HTTP token 认证、真实 membership／compliance 和共享领域服务的组合调用尚未执行。真实 Better Auth 内存测试与 gateway 测试分别提供局部证据，不能拼接宣称完整认证验收。REST create／enhance 和每个 UI server function 尚未逐个走完整框架 HTTP 链；浏览器、真实 Workflows 引擎重放和供应商验收未执行。

因此 G01-verify 保持开放；[18 类入口矩阵](caller-matrix.json) 逐行区分源码、真实回调、内存 D1 与 mock，不按矩阵行或整个文件批量批准。新增两个测试路径按 GC-01 追加至 [实施台账](../p3-implementation-log.jsonl)，冻结设计中的 1,219 条 pending inventory 保持原状。

G07-callers 的三类上游继承风险仍未修复：音乐 claim 异常后的新 hold 清理、motion 估价时长与实际时长、motion 引用路由估价。G09-ownership-verify 仍以 G03-verify 为前置，G03 依赖 G02；用户暂缓的 CONTINUE-LLM-SOURCE 保持。下一步继续 G01-verify 的组合验收，不将 G02 前置或 P3 整体记为完成。

本批未推送、部署、远程写库或调用真实供应商。两项原有工作区修改的字节指纹保持。
