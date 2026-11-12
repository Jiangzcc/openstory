# P3 G01 可信请求与任务语言组合验证

日期：2026-11-12。验证前提交：`2d98cc8274691fd371c4edcfa19a76ddd6a744c2`；测试与功能文档提交：`99c6838b73bc782d7f5ce97208d47f7d2aab8e38`。

本轮完成冻结设计中 G01-verify 的两条有限技术契约：内部 zh-CN／en、外部固定 en 到最终服务参数的传播，以及原认证、组织隔离、scope 和生成权限断言的保留。完成依据是全部已发现入口的源码清单、不同身份／权限形态的真实组合测试与原领域回归，不代表所有入口都已跑过浏览器或 Workerd HTTP。GC-01 的逐文件差异处置没有批量批准，P3 整体仍进行中，P4 未开始。

## 原行为、动机与范围

上游原有 session、API Key、OAuth、组织权限、共享钱包和 API/MCP；二开已接入网页任务语言与外部固定英文。上一轮只分别验证过认证、middleware 和共享服务，尚缺真实组合证据；网页矩阵 C07 也只列六个文件。本轮补证以判断现有薄接入是否实际断链，不新增上下文包装器，不改生产行为。

新增三个测试文件并补两份功能文档，生产文件与原测试均未改。实际成果是验证覆盖和可重复的入口清单；既有上游生产修改路径减少为 0，不宣称减少未来冲突。详细字段见 [机器证据](implementation.json)。

## 入口与真实执行范围

[18 类入口矩阵](caller-matrix.json) 保留逐行源码、真实执行和替身的边界。[完整网页入口清单](web-callers.json) 记录 19 个 .fn.ts 文件、51 个 server function 的 export、源码行号、下游服务、身份形态和源码指纹。相对上轮 C07 新增 13 个文件、29 个函数，包括上传、保存、恢复、九宫格选择等间接触发生成的入口。这是完整发现清单，不是 51 个浏览器流程的动态成绩。

| 新增测试                                                     | 项数 | 真实执行                                                                                                                                                                          | 测试替身与限制                                                                                                                                            |
| ------------------------------------------------------------ | ---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| src/platform/server/mcp/request-composition.test.ts          |   69 | 生产 Better Auth 配置／Drizzle adapter、OTP 登录与 Key 签发、JWT 签名及 JWKS 校验、MCP handler／SDK、REST create middleware／callback、共享创建服务、D1 写入和 workflow admission | synthetic 用户／OTP／配置；邮件、analytics、JWT limiter、最终 binding.create 为替身；Node 显式调度路由，不运行 Workerd transport 或真实 Workflows         |
| src/platform/server/api-v1/entry-locale.test.ts              |   46 | REST create／enhance callback、request middleware callback、runOneShotCreate、增强生成器、真实英文系统指令与 SSE                                                                  | principal／membership／compliance、ScopedDb、最终创建服务、调度、计费和 LLM transport 为替身；不能与独立认证测试拼称完整增强 HTTP 验收                    |
| src/platform/server/auth/server-function-composition.test.ts |   40 | 生产 session、迁移后的内存 D1、组织／sequence／shot／cast 查询、Start middleware、Zod validator、五个真实 handler 与安装版 __executeServer                                        | 测试编译适配器提供 extracted metadata 与原 handler；末端共享服务为参数观察替身，不运行编译插件、manifest、RPC 序列化、全局 request middleware 或浏览器 UI |

网页五个代表形态分别是 describeUploadFn 的显式 actor、generateMusicFn 的 sequence、generateShotImageFn 的 shot、regenerateLocationSheetFn 的可空 cast、createGeneratedAssetFn 的 scopedDb 身份。它们验证 Cookie 中英／缺省／非法值、body 与已解码 context 的伪造字段、实际目标隔离、两层 validator 和 sequenceId=null。

MCP／REST create 的 session、Bearer Key、x-api-key、OAuth 凭证来自真实 auth 或生产 signer。实际 membership 被删除后下一次写入拒绝，不自动选另一组织；Key metadata 在两组织之间决定其组织。禁用、过期、无效 Key 不能借有效的其他用户 Cookie 降级认证。OAuth 的签名、audience、expiry、scope 拒绝按现行规则执行；OAuth fixture 没有经过 consent／code exchange。

MCP 的跨组织 sequence 例外只允许系统管理员 API Key，测试执行真实 regenerate 并在最终 binding.create 参数核对 caller、foreign organization 和 en；普通 Key、OAuth、session 均无该例外。网页原有管理员 session 的跨组织规则在网页组合测试中单独验证，不能套用 MCP Key 规则。

保留一项既有行为：MCP script-only create 在 admission 拒绝暂停生成前可能已写失败 sequence 行，测试只断言零 binding 启动，不虚称零数据库写入。REST 暂停／终止账户由 middleware 在创建前拒绝。本轮没有修改上述行为。

所有新组合测试阻断外网并断言没有网络调用；测试 D1 是迁移后的内存 SQLite 包装 D1 API，不是远程 D1。原文、对白和用户内容保持原样。

## 最终验证与原断言保留

| 互不重叠的最终测试组   | 文件数 | 测试数 | 日志                               |
| ---------------------- | -----: | -----: | ---------------------------------- |
| 上轮 G01 全部原范围    |     21 |    477 | g01-existing-integration-tests.log |
| 额外网页领域原测试     |      4 |     54 | web-domain-existing-tests.log      |
| 本轮三个新增文件整合后 |      3 |    155 | new-entry-integrated-tests.log     |
| 唯一合计               |     28 |    686 |                                    |

- 新增 155 项；早期 115 项或网页单独 40 项等成绩已包含在最终三文件组，不重复累计。钩子额外执行的 17 项 client/server boundary 测试不加入上表。
- 本轮选用的 25 个原测试文件，归一化源码与 before 提交完全相同。由此上轮 G01 的 19 个原文件中 964 处原 matcher AST 继续保留；964 不是全部 25 文件的 matcher 总数。
- bun typecheck 和 bun lint 通过，lint 146 条警告都在本轮范围外。本批五文件格式及正常提交钩子通过；钩子用时 214.76 秒，包含 client/server boundary、dead-code、format、lint、typecheck，无 bypass。
- 提交钩子格式化前后，三个新测试的归一化源码相同。未重跑全仓格式或生产构建；生产源码保持，构建证据沿用 MC-B03 在 `95863667e4b58ac43718bd7a15f244787e97094b` 上的 bun run build 通过结果，不计为本轮重新构建。
- 具体命令、逐文件指纹、临时日志 SHA-256 与真实／替身边界存于 implementation.json；临时原始日志位于本地 .tmp/p3-g01-composition-20261112/。

初期失败来自测试 harness：MCP 2026 协议 fixture 缺 _meta 和 Mcp-Method／Mcp-Name 头，补齐为仓库现行信封；synthetic enforcement reason 改为真实 other 枚举。REST fixture 的 scope／style／strip-strict 预期按现有契约修正。lint 发现的新测试 raw-DB 声明、tuple 非空断言和初始化问题已修正。没有为迁就测试改生产实现，最终 155 项整合及类型检查全部通过。

用户已取消文件／函数行数、复杂度、嵌套层数及强制常量／枚举规则；本轮不据此拆分或登记尺寸整改债务。

## 剩余边界与后续

浏览器语言切换、完整 generated Router／RPC／Workerd HTTP、OAuth consent／code exchange、真实 JWT limiter、Cloudflare Workflows 引擎与供应商质量未执行；REST enhance 的真实认证全链也未执行。它们不算本轮通过，不扩大成 G01 有限契约之外的完成声明。

冻结设计的起点仍为 `db3ea57b5f419f69c51369c28819de17515b21f5`，1,219 条 inventory 全部保持 pending；本轮三个新增测试路径以 GC-01 身份追加至 [实施台账](../p3-implementation-log.jsonl)，没有改写旧七行。G01 验证批次完成不等于 GC-01 或全部文件自动获得语义批准。

下一批为 G02-verify：核对可信配置进入任务、codec／admission 与入队后配置修改隔离。G03 仍依赖 G02，G09-ownership-verify 仍依赖 G03。G07-callers 的音乐 claim 异常后新 hold 清理、motion 估价时长、motion 引用路由估价三类继承风险保持开放；CONTINUE-LLM-SOURCE 按用户决定暂缓。

本批未推送、部署、远程写库或调用真实供应商。用户原有 .codex/project-rules.md 与 src/routeTree.gen.ts 的字节指纹保持原样。
