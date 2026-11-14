# P3 / GC-03 Storyboard 失败状态所有权守卫

本批承接 [voice claim 失败恢复](../20261114-p3-g03-voice-claim-recovery/README.md)与 [failure retry contract](../20261114-p3-g03-failure-retry-contract/README.md)，处理 Storyboard 父任务失败收尾的数据库读写窗口。源码提交为 `4153a336e36eed97eb492007b452eb58833e26cf`，正常 hooks 全部通过。GC-03/P3 仍在进行中，P4 未开始；冻结 inventory 未批准。

## 原有行为与根因

上游既有 Storyboard 失败 hook 先读取 sequence 当前状态，再无条件写入 failed。二开恢复必要清理的错误传播后，这个既有窗口仍存在：读到 processing 后，子任务可能已经写下具体失败原因，sequence 可能已完成，或新任务已取得 workflow slot；父任务随后仍会覆盖它。即使读取已经看到新 run，旧实现也没有校验任务归属。

单用 Cloudflare instanceId 又不完整。启动器先把原始 claimId 写进 workflowRunId，再发起工作流，返回后才回写实际 instanceId；平台实例 ID 会经过命名空间、字符清理和截断。不能从实例 ID 反推 claim，也不能把两者始终相同作为前提。

## 实现与保留契约

[数据库方法](../../../../src/sequences/server/db/sequences.ts)新增 failWorkflowIfCurrent：用一次条件 UPDATE 同时核对 sequence、本组织、当前 owner 等于实际 instanceId 或本次可信 claim，以及状态不是 failed/completed。返回 true 表示本次完成失败转换；终态、新 owner、空 owner、缺失行和异组织返回 false，原状态、错误和更新时间保持。

[启动器](../../../../src/sequences/server/launchers.ts)在取得 claim 后覆盖填入内部 payload 的 workflowClaimId；StoryboardTriggerInput 排除该字段。调用方即使额外传入同名属性，也不能改变实际 claim。trigger 抛错时也复用守卫，只匹配本次原始 claim；状态清理保持普通错误 best effort，保留原日志、run.failed 活动记录及原 trigger 异常。

[Storyboard failure hook](../../../../src/sequences/server/workflows/storyboard-workflow.ts)不再先读 mutable status，守卫返回 false 时跳过父级 generation.failed。普通 guard 异常仍独立尝试通知，再传播第一个错误供既有 durable step 重试；engine abort 立即停止后续动作。reservation 普通错误仍为 best effort。缺少 claim 快照的 payload 只匹配实际 instanceId，不猜测原始 claim。

这是二开本批修复的上游失败操作；不新增另一套工作流生命周期。外层 catch 或再读一次都无法使状态检查和写入原子化，所以必要改动落在既有 scoped-db、launcher、内部 payload 类型和失败 hook 四个接入点。未更改 schema、migration、公开 API/MCP 或计费规则。

## 验证证据

新增 [storyboard-failure-status.test.ts](../../../../src/sequences/server/workflows/storyboard-failure-status.test.ts)的 16 项回归使用真实 createTestDb、实际 migrations 与领域 DB 方法；WorkflowScopedDb 部分外壳、事件、billing 和 realtime channel 明确为 host-side 替身。旧读取替身保留真实数据库的交错前快照，确定性复现旧读写窗口；synthetic SQL trigger 只在测试内注入写入失败。这些是顺序交错证据，不是实际 Cloudflare 多实例并发或 durable replay。

修复前 9 项用例中复现 6 项行为失败。首次生产改动后的三个直接测试文件为 75 通过、1 项失败，原因是原 exact payload 断言尚未加入新增可信 claim；补入实际 claim 断言并扩充边界用例后，同三个文件共 84 项全部通过。原 runImpl 编排测试区从 makeStep 起与 sourceBefore 比对，仅归一化 CRLF 后逐字相同；已删除的状态读取阶段断言迁移到真实 DB 守卫和新的错误传播测试，未通过放宽 payload 相等断言规避失败。

最终集成回归 26 个文件、384 项全部通过；类型、7 份源码/测试的定向 lint 与格式、diff、client/SSR 生产构建和正常 pre-commit hooks 通过。hook 另运行 17 项客户端/服务端边界测试；构建仅有已记录的非阻断提示。7 份 Markdown/JSON 格式、2 份 JSON、45 条非空实施日志、178 处本地链接、两处架构交叉锚点与源码提交的 7 个路径核对通过；5 份冻结 inventory 的 1,219 项仍全部 pending。具体命令、首轮失败和最终结果见 [验证记录](verification-results.json)，接入范围与保留契约见 [实现记录](implementation.json)。

## 上游升级关注点与未关闭边界

上游若修改 workflow slot、instance ID、终态枚举、组织隔离或派发/回写协议，需要联动检查这四处接入。此 guard 只关闭列出条件下的失败状态写入窗口，不能据此宣布整个生命周期已完成。

- failed 已写入、emit 抛错后，同一失败清理重试仍可能被终态跳过逻辑抑制；真实 realtime 适配器还会吞掉普通 HTTP/RPC 错误，mock 拒绝不等于生产发送会触发重试。
- UPDATE 与 emit 不原子。新 run 可在两者之间启动；事件缺少 run 身份，旧事件及历史回放仍可能污染 useGenerationStream 状态。query-cache-updater 对该事件只失效查询，未证明旧事件会直接改坏持久状态或已完成页面。
- 启动和成功分支、launcher 最后回写 instanceId、子任务自身的失败 hook 尚未全部做归属收敛。
- 真实 Workerd HTTP、Cloudflare replay/restart、多实例并发、浏览器送达、供应商和钱包结算未验收；本批未 push、部署或执行远程 D1/R2 写入、真实模型调用。

后续按生命周期写入和事件契约继续核对，GC-03/P3 保持 in-progress；本批不批准 1,219 项冻结路径的全量处置。
