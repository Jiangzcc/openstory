# G14 资产入口、终态与来源验证（2026-11-13）

本批继续全量 P3 的 `G14-asset-verify`。起点为 `ffcaf1225a7dee1329721a1941a13fe2083b5fce`，上游 B 仍为 `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`，冻结 S 仍为 `db3ea57b5f419f69c51369c28819de17515b21f5`。实际实施目录为 `D:/code/github/openstory` 的 `develop`；沿用既有授权实施、验证及本地提交，没有合入新上游。代码提交、范围和状态见 [实现记录](implementation.json)。

## 原行为、动机与最小修复

本批核对资产入口的可信身份、语言、排队和终态，以及真实生成渠道、存储输出和来源之间的对应关系。原有组织钱包、渠道选择、逐项预占、权限和存储合同继续复用，发现并修复四类缺口：

- **Studio 图片／视频来源 key 不完整。** 上传 helper 返回桶内相对 `path`，父工作流原样写入 provenance，缺少 `thumbnails/` 或 `videos/`。现在只在两处来源写入点调用已有 `buildR2Key`，与序列图片、视频和 upscale owner 的现有用法一致。helper、attempt 和旧 `upload`／`uploads` 检查点保持相对路径；已存储视频原先会去除桶前缀，不会产生双前缀。该问题在固定 B 也有相同源码，未据此宣称发生过线上错误。
- **草稿生成禁令漏检。** 网页草稿入口和注册的 `draft_studio_prompt` 工具调用已有 `requireGenerationAllowed`，在共享草稿服务之前使用服务端身份检查用户及组织。普通 account access／write 权限不能代替 generation 权限。工具修复同时覆盖外部 MCP 和两种语言的 assistant 适配入口，没有增加工具或改变 scope。
- **区域回退后付款方仍取初始密钥。** 草稿实际使用平台回退渠道成功时，原来仍按最初组织密钥设置 `usedOwnKey`。现在跟踪实际解析并成功使用的密钥，交给原成本函数及组织钱包；组织密钥实际成功时的既有行为保持。
- **回退到平台前没有重新预检余额。** 原余额预检只检查首次密钥。现在把相同的预检放在实际密钥解析处，平台回退开始前也检查余额。没有新建计价规则；回答模型／配置渠道的 token 成本原先已经正确，不另算计价缺口。

上传路径、创建和调度骨架、模型身份、step 名称、去重键、claim、数据库结构、计价单位和币种均保持。未实施 BYOK 禁用、人民币售价／钱包／汇率改造；该草稿修复只纠正现有渠道回退后的付款事实。历史错误 provenance 及已完成的 provenance 检查点不会自动回填。

## 调用与本地证据

[调用矩阵](caller-matrix.json) 收录 6 行目录资产／父工作流记录、24 行 Studio caller 记录和两组实际注册的 29 个 MCP 工具；这些是有重叠的调用视图，不作为新的全量文件处置数量。

目录资产测试执行真实创建服务、上传 helper、来源记录及 scoped SQL：三类媒体保留可信身份／语言、`asset-<id>` 去重；触发拒绝标失败，成功触发后的 run-id 写失败保留数据库中实际 running／completed 状态。该目录路线只走 fal，完成成本仍为上游既有的 null，没有虚构供应商 units 或收费实现。Studio 父测试分别检查实际 via、配置渠道部分／完整输出、每个已存储输出的来源与现有微美元费用，并用 Map 检查点替身验证完成结果复用。

网页组合测试使用真实 Start builder、组织 middleware、Better Auth、Zod、服务、预占／资产／账本 SQL；测试编译适配器从解码后的函数入口进入。MCP 测试覆盖实际 SDK／assistant 注册适配、可信身份／locale、逐字段注入拒绝、scope、跨组织父链，以及真实上传分类分流、rights ledger、Studio 逐项创建和原始 prompt。真实 chat 事件、供应商、存储绑定、分类模型、通知和外部工作流效果按测试范围明确使用替身。

[基线记录](baseline-results.json) 保留改前与改后边界：最终相同父探针对旧 owner 为 **12 项中 11 失败、1 通过**；最终相同 MCP 探针只重定向旧工具 owner，为 **33 项中 6 失败、27 通过**。两轮均未回滚当前生产文件，临时 alias 已删除。网页／provider 另有早期有效 **35 项中 4 失败、31 通过**的[原始日志](studio-draft-baseline.log)；最终 Studio 36 项增加组织密钥成功的保持用例并拆分入口／上传测试，不能把旧 35 项说成完全相同的最终测试体。早期夹具、字段和适配器错误另列，没有归为生产缺口。

## 验证结果与保留范围

最终按文件取最后结果去重为 **54 文件、1,323 项通过、零跳过**，其中 47 个原测试文件有 1,002 项，7 个新增测试文件有 321 项，另有一份只供新测试使用的共享夹具。全仓 typecheck、lint、新生产 build 及正常提交钩子的结果见 [验证记录](verification-results.json)。146 条原 lint 消息逐条对照无新增；生产 build 的五个输入文件有独立 hash，实际运行时仍与它们一致。

这里的最终通过来自明确的复跑合并：54 文件整合初跑为 **1,318 通过、5 失败**，其中 4 项新探针误预期 assistant 保留领域错误子类，现按原适配器的普通 Error／消息合同修正；另 1 项是原 `media-upload.test.ts:775` 超过原 5 秒限制。两文件复跑为 45／46 通过，同一原超时仍在；该原文件独立复跑为 **13／13 通过**。因此这项组合超时继续列为开放的不稳定风险，不宣称根因已修复，也没有放宽原断言、timeout 或根测试配置。供应商替身、基线和重复运行不会累计到最终数字。

共享夹具抽出后，首次正常代码提交被 knip 拦住：夹具直接引用了未声明的内部上下文包。上下文接入现留在两个测试入口，夹具仅接收回调，沿用原组合测试的接入方式，没有修改依赖或检查配置。修正后 knip 通过；与 knip 并行的两文件复跑出现一次原 10 秒 `beforeAll` 超时，8 项通过、21 项未执行。保持相同断言和 hook 限制，随后独立复跑 **29／29 通过**。这次初始化超时也记录为开放时序风险，不能作为已修复问题关闭。

本轮原有 **797 份 TypeScript 测试逐字节保留**。冻结 25 文件、1,219 项 pending disposition、129 个非冻结旧归档，以及台账前 13 行均保持，台账只追加第 14 行；见 [源码保留证明](source-preservation.json)。[owner 对照](owner-preservation.json) 证明两处 key 及必要 import 反向还原后，整个 Studio 父文件与起点相同。[独立审查](qa-review.json) 限定于该 key 修复和父测试，没有独立重跑，不冒充新增动态证据。本批没有将既有生产路径恢复到上游，不以删行或当前冲突数宣称降低未来冲突。

复跑本批范围：

```powershell
node docs/secondary-development/preservation/20261113-p3-g14-assets/run-regressions.mjs
bun typecheck
bun lint
bun run build
```

G14 本批有限入口与来源合同已有本地证据，GC-14 整职责及 P3 整体仍未关闭。浏览器 RPC／生成 Router、完整 assistant 选工具及持久化／审批、OAuth consent/code exchange、真实 Workerd／持久 Workflows、供应商、远程 D1／R2、真实结算和 heap 仍未验收。G03 原冷导入超时及领域生命周期、G07 music hold 和 motion/reference 估价风险、其它 P3 职责继续开放；`CONTINUE-LLM-SOURCE` 继续按用户决定暂缓。P4 未开始；没有推送、部署、真实付费调用或远程数据库写入。
