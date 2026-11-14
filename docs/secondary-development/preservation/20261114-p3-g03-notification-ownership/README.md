# P3 / GC-03：生成生命周期事件归属

本批承接 [生命周期写入归属](../20261114-p3-g03-lifecycle-branches/README.md)。数据库 guard 只能证明写入时的 owner；旧任务发送前的新任务接管、延迟实时事件和延迟历史响应，都仍可能污染当前生成横幅。本批治理的是 sequence 生命周期信号的身份、客户端启动窗口及回放顺序，GC-03/P3 仍为 in-progress，P4 未开始。

代码提交：ba86136d8a041e2e01494184f857798788405032。未推送、未部署。

## 归属契约及范围

六类信号为 generation.phase:start、generation.phase:complete、generation.complete、generation.failed、generation.error、generation.reservation:short。wire schema 增加可选 workflowOwner：workflowRunId 是根实际实例 ID，workflowClaimId 是 launcher 已生成并快照的原始 claim；两者可以完全不同，不能拆解实例名猜 alias。字段在传输层可选，以保留独立任务原有通知，但生成横幅只接受身份完整并匹配当前 sequence.workflowRunId 的生命周期信号。

Storyboard 的 3 个出口、AnalyzeScript 的 5 个出口、SceneSplit 的 2 个错误出口，以及 UpdateStaleShots 的 2 个阶段出口均带根身份。Storyboard 将同一根快照传给 AnalyzeScript 和 fresh/resume executor，AnalyzeScript 继续传给 SceneSplit。_parent 仍表示真实直接父级；仅已有真实 Storyboard parent hint 的兼容分支可回退到其实际实例，不能据未知父级猜 root 或 claim。

独立 MotionBatch 不持有 sequence 工作流槽，继续发送原失败通知并触发原缓存刷新，不伪造 Storyboard 身份。SceneSplit 边界合并告警仍是非致命 error。独立 AnalyzeScript CLI 原 DB 失败路径保留，其没有 slot 协议的风险也继续单列。

## 前端接入和恢复

原事件映射移入 [纯事件模块](../../../../src/sequences/ui/generation-stream.events.ts)，既有资源 action、重试计数、字幕/视频等缓存语义保持。新增 [会话 reducer](../../../../src/sequences/ui/generation-stream.session.ts) 在现有 progress reducer 外管理当前 sequence、owner、启动 token、历史请求和已接受终态。旧 route 回调、旧 owner 和旧请求不能重新绑定当前会话。raw claim 发布成其明确对应的实际实例时保留同一会话。

Continue 在同一 QueryClient 的 sequence 专属 key 中建立递增 pending token；主视图和音乐子视图共享它。pending 期间已具备根身份的生命周期不能改变横幅或触发根缓存副作用，独立无 owner 的 batch 缓存刷新仍执行；pending 也维持生成指示器，避免无关读取让旧 completed 行隐藏启动状态。拒绝只允许当前 token 在尚未观测不同 owner 时恢复旧快照，过期回调不覆盖后续任务。

[归属确认模块](../../../../src/sequences/ui/generation-stream.reconcile.ts) 在启动请求成功后取消旧 detail 读取，再通过已有 getSequenceFn 和真实 fetchQuery 强制读取，零 active observer 也执行。不把 invalidateQueries resolve 当作读取凭证，也不把 launcher 返回实例当成当前槽，因为 publication=false 仍可返回被取代的实例。只有取消屏障完成后才激活确认监听，实际 QueryCache fetch success 才解除 pending；manual setQueryData 不算。读取失败记录并保留 pending，后续 focus/remount 的真实成功读取可恢复；不同 token 或 query 清理会解除旧监听。没有定时重试、新网络协议或数据库字段。

实时处理每次从 QueryClient 读取当前指针；新 owner 的信号先使详情对账，不根据第一个事件认领身份。历史沿用现有接口和 SQLite 字符串保存，经过与实时流相同的 leaf parser。回放先恢复历史，再按收到的顺序重放请求期间的 live。已经接受的终态有会话内 terminalEvent 回执，同 owner 的历史、冲突终态和迟到 phase 都不能撤销它；只有明确新 owner/启动会话才能清空。

历史等待期间最多保留 2,000 个 live action，与现有服务端历史窗口的条目规模一致；达到上限后放弃本次历史水合并保留已展示的 live 状态，不丢掉新状态去采用旧历史。该客户端内存边界不是服务端任务超时或租约。

## 验证与审查

旧映射抽取后、尚未接入身份筛选时，39 项 wire/映射回归有 24 项失败、15 项通过。首轮 20 文件、380 项绿灯后，独立审查发现真实读取确认、终态再水合和独立缓存刷新三项遗漏；新增组合用例有 6 项复现失败、32 项通过。随后修复并增加真实 QueryClient 确认/恢复测试，相关 4 文件、59 项通过。进一步复核又发现 retryer 已 resolve 而旧 cache success 尚未提交的微任务窗口；新增单项先失败，随后将成功确认的激活放到取消屏障之后。最终 38 文件、681 项通过，其中新增 109 项。类型、32 文件定向 lint（0 错误，13 个既有代码段警告）、格式、diff、client/SSR 构建与正常提交 hooks 全通过，hooks 另跑 17 项客户端/服务端边界测试；最终范围及结果见 [验证记录](verification-results.json)。

测试证据分层如下：纯 reducer/映射使用合成事件；launch/delivery/reconcile 使用真实 QueryClient/QueryObserver，服务器读取是明确的替身；后端身份传播使用原工作流测试及既有真实测试 DB；通道往返使用现有 Node SQLite 与 Cloudflare class host stub，实际经过 HTTP Request/Response、SSE 字节、SQLite history 和真实 leaf parser。它们不能代替 Cloudflare 运行实例或浏览器验收。

完整改动、原断言处理及审查修正见 [实现记录](implementation.json)。冻结的 5 份 inventory、1,219 项保持原 pending 状态，本批没有批量批准任何条目。

## 上游升级复核点

- 新增生命周期事件、leaf schema 或 action 时，从根派发、子任务、当前槽到实时/历史还原整条核对；仅看相交文件不能证明兼容。
- launcher、executor 和 parent-notify 协议变更时，核对 actual/claim 的归属和可信来源，不把直接父级替换为根，也不把 create 返回值当 slot。
- TanStack Query 升级时复核 cancelQueries、fetchQuery 和 success/manual 语义，保留 retryer/cache 微任务回归；若上游提供同等职责协议，优先在现有接入点整合。

## 仍开放的边界

- 六类生命周期之外的素材进度、scene/new/shot 内容通知、poster/analysis 内容写入和所有后代事件尚无完整根归属保护；本批不把内容/素材污染说成已经闭合。
- failure/short DB 终态写入后发送失败的 durable 重试、真实 adapter 对普通发送错误的吞并、丢失事件的最终送达均未改变。客户端身份和终态回执不是外部发送事务，也不是持久投递回执。
- ready email、旧成功 workflow checkpoint 重放及其他外部副作用仍不能通过本批客户端筛选获得原子性。
- 未发布 raw claim 的启动互斥/取消仍开放；Continue 服务端设置保存/拒绝回滚、独立 Update all 预检及 create 成功但 publication SQL 失败的恢复仍开放。本批只增加客户端 token 对旧回调的保护。
- 独立 AnalyzeScript CLI 没有 sequence 槽协议，既有必填 payload 缺口也未在本批运行或验收。
- 未运行真实 Cloudflare durable replay/restart、Workerd 多实例 D1、浏览器、付费 provider 或钱包最终结算；不推送、不部署、不写远程 D1/R2、不发真实邮件。
