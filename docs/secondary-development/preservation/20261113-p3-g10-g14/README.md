# G10 契约验证与 G14 图片准备收拢（2026-11-13）

本批继续全量 P3，起点为 `58c9a69b6f4bc3f453d66bdbe610f052b5838ebd`，上游 B 为 `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`，冻结设计 S 为 `db3ea57b5f419f69c51369c28819de17515b21f5`。按既有授权实施、验证并本地提交，未合入新上游。

本地代码提交为 `7aab7bb9052554512b62c6c178579ca34ef8921e`（Studio 准备与契约）和 `1d2cf3d44aed64d29ab7778d9fd1247df363c9ce`（三处来源字段修复）。

## 原行为与本批结构变化

Studio 原创建函数已经先解析配置图片报价、再检查权利，完成全部逐项预占后才逐项建记录和派发。配置加载、能力校验、有效参数、报价和显示渠道在函数的不同位置组装。

本批在 Studio 服务端新增 `prepare-studio-image.ts`，把捕获配置、原报价、有效 `channelParameters`、endpoint/name 收入同一图片准备结果。创建函数消费该结果，原 rights、逐项 holds、insert、dispatch、失败清理和 run-id 回写骨架保留。无绑定 builtin 图片继续原能力及价格路径；video 不读取图片配置。没有建立通用 create 框架或把 attempt 搬到 Studio。

外层 count 仍是行/工作流数量，原生 n 仍是单次供应商输出数。逐行费用按 n 报价，未在服务端改写为用户界面目标总数。UI count/reuse 的既有换算另由原回归覆盖。

创建函数迁出的准备声明、能力调用和配置 spread 以外，14 个具名函数及创建剩余控制流的 AST 对照一致，详见 [AST 对照](create-ast-comparison.json)。归一化排除项逐项列明，不把排除后的相同误称为整文件相同。

## G10 保留的执行职责

共享 stills step、attempt SQL/identity/schema、generate/record 名称及重试策略保留。静态追踪 6 个直接桥接、9 个父工作流；[原始审查](caller-matrix-before.json)逐行说明动态覆盖不足。

新契约测试执行真实 attempt SQL、配置报价、configured 生成桥接和原存储 helper。并发读取空 attempt 后只允许一个供应商替身调用；metadata 写前失败和写后丢失确认仅重试 record；checkpoint 和未提交 metadata 同时丢失、超时及部分存储失败均拒绝重提；两类 engine abort 原样透传。大于 1 MiB 的模拟 data URL 在生成 step 内交给原 helper 消费，checkpoint 和 attempt 只保留小引用。原 Studio `upload` / `uploads` 检查点消费回归仍在，不触发重新生成。

这些是本地 SQLite/D1 夹具、步骤缓存与供应商/R2/凭证/余额替身的证据，不是实际 paid POST、远程 D1 竞争或 Cloudflare 持久恢复验收。未知已付费结果和部分存储遗留对象仍需运营恢复，测试没有消除这一风险。

## 追加的来源记录缺口

本批 G10 审查发现角色、地点和元素 sheet 的实际生成结果已有 `via`，而原父工作流向 provenance 固定传 `fal`。固定 B 也有这三处字面量；源码证据不能单独证明已发生的线上错账。

本批在原三个 owner 使用 `generation.via` 记录来源，沿用 ImageWorkflow/portrait 的现有契约。回归调用真实父 `runImpl`、`recordProvenance` 和本地 D1，外部生成/存储、余额及业务 landing 为明确替身。发现时的 open 审查原样保留，修复证据单列，不倒写原始结论。

## 验证与边界

最终去重 **52 文件、714 项全通过、零跳过**：48 个原测试文件的 664 项，加 4 个新测试文件的 50 项。全仓类型/lint、新生产构建、9 个改动代码文件格式及两次正常代码提交 hooks 均通过；146 条既有 lint 消息无新增。不同最终报告的重叠文件按最后结果替换，不把基线或复跑重复计数。

验证结果、首轮测试基础设施问题及复跑关系见 [验证记录](verification-results.json)；旧 Studio 入口的最终测试体对照及来源修复的红灯见 [基线记录](baseline-results.json)。最终去重文件范围列在 [test-files.txt](test-files.txt)，worker 定向运行、基线、复跑和 hooks 不重复累计。

原有 793 个测试文件逐字节保持；冻结 25 文件、1,219 个 pending disposition 和台账前 12 行的保留情况见 [保留证明](source-preservation.json)。本轮只追加实施行，119 个旧归档也逐字节保持。没有将任何既有修改路径恢复到上游；本轮实际结构收益限于图片准备的单一 owner 和可回归契约，不以文件移动、删行或当前冲突数作为治理完成指标。

重跑相关回归：

```powershell
node docs/secondary-development/preservation/20261113-p3-g10-g14/run-regressions.mjs
bun typecheck
bun lint
bun run build
```

runner 使用同一本地 Vitest 入口、未修改的根配置及一个 worker，不调用 Bun 内置测试框架。固定旧入口的基线通过同目录临时 alias 加载 Git 中的旧生产模块，只替换测试 import，未回滚当前生产文件；两份临时文件运行后删除。

G10 有限本地验证与 G14-image-prepare 的结构工作已有本批证据，GC-10/GC-14 不作整职责关闭。G14-asset-verify 其他入口、父工作流全部生命周期及真实 Cloudflare/provider/wallet/R2/heap 仍待验。G03 原冷导入超时及领域覆盖、G07 music hold 与 motion/reference 价格风险继续开放；CONTINUE-LLM-SOURCE 按用户要求暂缓。P3 整体进行中，P4 未开始；没有推送、部署、真实供应商调用或远程数据库写入。
