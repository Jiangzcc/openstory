# 二开隔离试点结果（2026-11-15）

状态：B2 结构收口保留，B1 编译国际化未通过采用门槛，运行接入已撤出。用户已选择保留显式翻译，先同步固定上游再收口必要接缝。后续见 [C 阶段合入记录](upstream-merge-implementation-20261115.md)，原设计和不移动分母的验收规则见 [重构计划](fork-isolation-refactoring-plan-20261115.md)。

## 固定范围与测量方法

| 对象                 | 固定值                                     |
| -------------------- | ------------------------------------------ |
| B：已合入上游基线    | `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0` |
| L：试点前本地代码    | `fbf4396c6c241b834cf73fd7695a0b8cfa92fe2d` |
| U：固定原始上游目标  | `5da052c46d4a9ab232d865781f76e993a7667b2c` |
| B2 正常提交 / C 起点 | `3b8d8616e9ce6552ca175cb2db80ad58589334aa` |

分别对 L 与各候选使用同一 B→U 的 40 个累计主线目标、相同 Git/合并方向运行 `merge-tree`。文件数、文本块、路径并集分别计量，不将 40 行相加称为独立发布成本。试算只生成结果树，不实际合入目标。

两个试点分别对 L 测量，不能把结果相加称为一次集成实验。B2 测量对象 `4290e81a2b890fbfad0221a32925e510b5175cce` 与 B1 对象 `1cb330603239b044ba71b06f21ff4ef2ecfc72ff` 均由独立索引生成，仅用于测量，不是经过正常 hooks 的提交或用户分支发布；B2 的实际正常提交以上表为准。

| 同口径结果                      |   L | B2 候选 | B1 候选 |
| ------------------------------- | --: | ------: | ------: |
| 对 U 冲突文件                   |  54 |      54 |      53 |
| 对 U 文本冲突块                 |  94 |      94 |      94 |
| 40 个目标中冲突文件下降的目标数 |   — |       0 |      40 |
| 40 个目标中文本块下降的目标数   |   — |       0 |       8 |
| 冲突路径并集                    |  55 |      55 |      54 |

B2 的 40 个窗口均无变化，没有新增或退出的冲突路径。B1 的 `scene-group.tsx` 在全部 40 个窗口退出冲突路径；第 1–8 个窗口文本块各减 1，第 9–40 个窗口 `vite.config.ts` 从 1 块增至 2 块，抵消该收益。B1 没有新增冲突路径，但端点文本块没有净下降。不能把 B1 描述成完全没有局部收益，也不能把文件数下降升级成保真与长期维护验收通过。

[持久对照数据](refactoring/20261115-pilots.json)保存同一 40 目标的 B1/B2 结果、源码退出与新增接缝规模。本地原始材料位于 `.tmp/fork-isolation-measure-20261115/`：`before.json`、`b2-snapshot.json`、`b2-after.json`、`b2-comparison.json`、`snapshot.json`、`b1-after.json`、`b1-comparison.json`、`b1-source-exit.diff`；该忽略目录不保证其他检出可用。

## B2：配置渠道估价收口

原有两条生产入口各自完成计划分区、配置渠道 still/sheet 计价及原生剩余项组合；核心 `estimatePlanCost` 还接收渠道路由和参数。此次把组合决策收回既有 billing 模块，保持原金额及原生估价算法。

实际范围只有六个文件：

- `src/billing/cost-estimation.ts`
- `src/billing/configured-image-plan-billing.ts`
- `src/billing/configured-image-plan-partition.test.ts`
- `src/sequences/server/continue-plan.ts`
- `src/sequences/server/freeze-fresh-generation-plan.ts`
- `src/sequences/server/freeze-fresh-generation-plan.test.ts`

`estimatePlanCost` 函数归一换行后与 B 的函数文本相同，签名退出 `ConfiguredImageEstimateOptions`；函数内 routing 标识 4→0、parameters 标识 4→0，各原为两组 key/value 透传。两个生产入口的分区和组合决策 2→1，归 billing。配置 primary 与请求全原生时保留原金额；fallback 直接使用已有 `estimateConfiguredImageCost`，不复制原生 gate、视频或音乐算法。

图片和 Storyboard 的其它渠道参数链仍在，本次不能称 `cost-estimation.ts` 整文件恢复上游。结构收益已兑现，但这个函数不在当前 U 的冲突热点中，固定 40 窗口没有冲突下降。

验证分开记录：

- 改前定向基线：4 文件、77 项通过。扩展集合首跑 7 项失败，原断言仍要求核心接收路由参数；将断言迁到配置组合入口并补充核心不接收 route/parameters 的保证，原金额断言保留。主智能体最终复跑 9 文件、124 项通过，包含 8 项新增回归。
- 六文件 type-aware lint、格式及 diff 检查通过。B2-only 的全局 `bun typecheck` 和 `bun run build` 通过，日志为隔离运行目录 `.tmp/isolation-checks/b2-typecheck.log`、`b2-build.log`；它们与下述包含 B1 的构建分开。
- 正常提交 `3b8d8616e` 的五项 hooks 通过：客户端/服务端边界 17 项测试、knip、格式、type-aware lint、typecheck。knip 保留 6 项配置提示，没有错误。

以上是本地自动化和构建证据，不是付费模型、生产账单或部署验收。

## B1：编译国际化试验未通过

样本为 `default-not-found.tsx` 的静态文案、`scene-group.tsx` 的动态通知，以及 `pricing.tsx` 的富文本。原型尝试在构建期生成现有 i18next 调用，让组件源码恢复上游表达。静态页面和 scene-group 的翻译源码修改确实退出；pricing 仍保留 metadata、动态价格文案等显式接缝。

语义复核确认三个反例：

1. 条件表达式中的 toast 文案未转换，已有严格模式只守住识别到的静态键，没有把该显示缺口可靠报告出来。
2. `const child = <em>{name}</em>` 再放入 `Removed {child}` 时，被当作普通 `t` 插值，实际 React/i18next SSR 输出包含 `[object Object]`，丢失 React 节点语义。
3. `useMemo(() => <p>Go home</p>, deps)` 且 `deps=[]` 时，没有像字面量 `[]` 对照一样跟随语言变化；实际 SSR 的最终语言为英文，变量依赖版仍输出中文。该反例的报告仍是 0 unresolved、0 unclassified。

后两项真实运行探针位于 `.tmp/fork-isolation-b1-review-20261115/runtime-probe.mjs`。它们不是由测试数量或源码类型检查可以排除的风险。

覆盖与维护面也没有达到采用门槛：pricing 有 22 次未分类动态显示表达式、scene-group 有 29 次，共 51 次；文件内唯一表达式分别为 22 和 14 个。**51 不是已证实漏译数**，而是尚未分类的显示位置，不能用 `unresolved=0` 代替完整覆盖。生产转换核心为 9 模块、960 行，另有 76 行 plugin、114 行测试加载辅助及 523 行测试；还新增 Vite/Vitest 接入。不能只统计恢复的组件行数而忽略这些维护面。

已有有限通过证据：43 项原型测试；在隔离运行目录将三个真实样本的生成产物写回实际路径后，全局 typecheck 通过，并恢复原输入 hash；包含 B1 候选和 B2 的生产构建也通过，使用隔离 test D1/R2 绑定。这证明转换产物可以检查和构建，**不证明行为保真**。此运行实际为 Node `22.22.2`、Bun `1.4.1`，不称项目要求的 Node 26 环境已验。首次包装启动 ENOENT 的准备失败单列保留，没有改写为产品失败。

包含 B1 的证据为 `D:/code/github/openstory-isolation-runtime-20261115/.tmp/isolation-checks/generated-typecheck.{json,log}`、`production-build.{json,log}`；不得冒认 B2-only 或最终显式翻译状态的构建。Storybook、HMR、Workerd 页面运行/水合与完整交互验收未执行，不能沿用历史成绩填补。

用户据此选择停止编译接入、保留显式翻译。当前运行配置已撤出 compiler，三个页面恢复显式翻译；原型归档在 `.tmp/fork-isolation-b1-rejected-20261115/`，不进入产品构建。该处置不将 B1 snapshot 转成正常提交，也不把未通过原型留成后台运行能力。

## 后续边界

C 从 B2 正常提交开始，逐项整合固定 U，优先让上游接管重叠职责并保留本地必要保证；首节点合入中、尚未提交。未来收口继续分别验收行为、结构和同口径合并成本。实际合入 U 后的零冲突没有隔离收益含义，不能覆盖本记录。
