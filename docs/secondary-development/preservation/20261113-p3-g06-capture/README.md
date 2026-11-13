# P3 G06-capture：序列创建复用同次准备的模型配置

2026-11-13，实际实施目录为 D:/code/github/openstory、develop。起点为 `9d14dd318035a0b62b3675673a0675a623835c89`；代码提交为 `657dc9fe1662f99de1caf2f1cf81dc342f57e767`。上游基线 B=`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`，冻结设计来源 S=`db3ea57b5f419f69c51369c28819de17515b21f5`。

## 问题与实施范围

网页原入口先读取默认模型并验证输入，共享创建核心随后再次读取完整配置；管理员在两次读取之间修改设置，可使同一请求的默认值、渠道、能力、报价和派发使用不同版本。API one-shot 同样在早期读取设置，经过权利、增强和 inline 准备后才进入再次读取配置的核心。这里修复的是一次创作操作的配置一致性。

新增 server-only 准备模块返回“解析后的输入 + 服务端捕获的完整运行配置”。网页 validator/handler 传递该内部结果；API 在原配置读取位置使用原 scoped runtime loader，保持最终 parse 的原位置，并将配置传入核心。核心只新增可信内部 context 字段及原 loader 的回退路径，其余权限、资金、fan-out、创建、上传、失败清理和派发骨架保持。[调用矩阵](caller-matrix.json) 区分真实执行与替身。

公开 schema 未增加内部配置字段，显式模型选择继续优先，身份、组织和语言由既有可信入口确定。MCP create_sequence 与 assistant 复用同一 API service；regenerate_storyboard 继续由核心单次读取，full retry 已有的执行准备/估价/launch 同配置传递予以保留，后二者未改生产文件。plan 与 execute 是两次请求，execute 仍重新准备并校验摘要。

两个既有 loader 留在原组合根，不建立通用 resolver；该捕获不构成跨表原子 revision。G06-auxiliary 的元素、上传和 sheet 根任务同次配置复用留给下一独立批次。本批没有删除上游核心路径或减少原始 inventory 路径，也不以当前冲突数宣称降低未来冲突。

## 验证结果

固定 37 文件清单在单 worker 下最终为 **841/841 通过、0 失败、0 跳过**，其中 34 个原测试文件 797 项，3 个新增探针 44 项。[验证记录](verification-results.json) 和 [37 文件清单](test-files.txt) 保存逐文件统计。新增网页、共享核心、API 探针分别为 10、15、19 项；同一最终测试体重定向旧 owner 的对照为网页 4/10、共享核心 2/15、API 6/19 通过，其余失败命中本次缺少配置捕获的旧行为。[基线记录](baseline-results.json) 含测试和 owner hash、失败断言及原始日志；没有将当前 checkout 回滚到旧提交，也不能将失败数量解释为独立 bug 数量。

网页探针执行真实 Start builder、组织 middleware、Better Auth、迁移后的本地内存 D1、实际配置 loader、schema 和创建编排，最终 triggerStoryboard 使用替身。核心探针执行真实配置保存/轮换、合成密钥加解密、路由/能力、文本费率计算、图片报价、付款来源、预占/释放、sequence 写入、launcher claim 和 trigger codec；Workflows/Realtime 的最终出口、环境和 fal 价卡使用替身。文本预检仍为既有粗估 floor，不将费率计算断言冒充 G07 估价修复。API 新探针执行真实 service/schema/视频门禁/错误映射及处理顺序，scoped 读取、核心、权利/inline 写入、网络/存储与 sheet 使用替身。

全仓 `bun typecheck` 通过，全仓 `bun lint` 通过，`bun run build` 通过；正常代码提交钩子的 client/server boundary、knip、format、lint、typecheck 全部通过。全仓 `bun run test --maxWorkers=1` 运行 2,763 个 suite、10,192 项，10,189 通过、3 失败、0 跳过；失败均在本批未修改文件，两个 ElevenLabs/Voice Design 用例的原 5 秒超时和一个 agent discovery 首页标题断言，三项单独复跑仍复现，未修改无关代码。该失败不计入 G06 固定清单成绩。

[夹具历史](fixture-history.json) 和[原始记录](fixture-history.log) 保留首跑失败与修正：core 曾为 1/15、13/15、15/15、14/15 后再全过，API 初跑 17/18，均为新增夹具接口、合法阶段、能力或文案预期问题；API 初跑仅有注明来源的会话摘录。首轮全仓类型/lint 拦住的六条诊断也保留；修正在新增测试内部，不改生产保护、旧断言、原 timeout 或根检查配置。新增 core 的 30 秒 beforeAll 从初版已设定，各轮未发生该 hook 超时。

从本批代码提交复跑：

```powershell
node docs/secondary-development/preservation/20261113-p3-g06-capture/run-regressions.mjs
node docs/secondary-development/preservation/20261113-p3-g06-capture/run-owner-baseline.mjs web
node docs/secondary-development/preservation/20261113-p3-g06-capture/run-owner-baseline.mjs core
node docs/secondary-development/preservation/20261113-p3-g06-capture/run-owner-baseline.mjs api
bun typecheck
bun lint
bun run build
```

对照 runner 仅在成功观察预期红灯、生产 working file 未变时自身退出 0；被测 Vitest 的退出码 1 单独记录。runner 使用本地 Node/Vitest，临时 alias 在 finally 删除。

## 保留证明与开放边界

[owner 对照](owner-preservation.json) 对三个生产入口逐项撤销本次接入后，整文件 LF 内容等于起点。原有 804 份 TypeScript 测试中 802 份原字节保持；create.test.ts 仅新增空 text/image 快照夹具，entry-locale.test.ts 仅新增空 image 快照夹具，撤去这些属性后整文件 LF 等于起点，原断言全部保留。[源码保留证明](source-preservation.json) 核查 3,692 个原 tracked 文件、冻结 25 文件、1,219 个 pending disposition、140 个既有归档文件及台账原 14 行字节前缀；台账只追加第 15 行。

GC-06 整职责及 P3 整体仍开放，后续为 G06-auxiliary。真实浏览器 RPC/编译 manifest、完整 assistant 选工具与审批、真实 Workerd/持久 Workflows、远程 D1/R2、供应商调用/账单、真实结算和 heap 未验收。G03 冷导入超时、领域生命周期和持久重放，G07 music hold 与 motion/reference 估价，以及其它 P3 职责继续开放。CONTINUE-LLM-SOURCE 按用户决定暂缓；P4 未开始。没有推送、部署、真实付费调用或远程数据库写入。
