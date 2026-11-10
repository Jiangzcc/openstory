# P3 G07-partition：计划图片费用分区

日期：2026-11-10。状态：本批已完成；P3 整体进行中，GC-07 尚未关闭，P4 未开始。没有新增产品能力。

## 固定来源与实际范围

- 分支：`develop`。
- before：`4b6788db7da445abfca26d413ddec47a36be4e0b`。
- 代码提交：`ecd0a77f787f4d0b38ab3d25da85a7ea86173882`。
- 纯上游基线 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。
- 冻结全量设计 S：`db3ea57b5f419f69c51369c28819de17515b21f5`。
- 责任：GC-07 的 `G07-partition`，依赖的 G09-reference-projection 已完成。本批复核现有图片报价契约，没有新造模型接口。

本批沿冻结设计实施，没有刷新或合入新的上游提交。原上游已有 generation plan、stopAt、Continue、fresh handoff、计数估算、保守门槛和余额检查；配置图片渠道与逐请求报价属于现有二开，本批只整理它们的费用分区。

## 删除的重复决策与必要接入

`continueImageEstimate` 和 `remainingPlanCost` 原来分别判断计划是否含配置渠道图片，调用逐图估算，将 still、角色设定图、地点设定图、元素引用四类 counts 清零，再叠加图片小计。相同规则有两个维护位置。

现在既有 billing 模块的 `partitionPlanImageEstimate` 统一这项职责，返回剩余 counts、图片小计，以及供原调用方使用的可选 priced/source 元数据。没有另建生成框架或复制工作流。

| 决策                                 | before | after | 所属位置                                   |
| ------------------------------------ | ------ | ----- | ------------------------------------------ |
| 含配置渠道图片时切换到逐请求图片小计 | 两处   | 一处  | `billing/configured-image-plan-billing.ts` |
| 单独报价后排除四类图片 counts        | 两处   | 一处  | 同一分区函数                               |

Continue 和 fresh 两个核心文件仍需要薄接入。Continue 的安全选模、旧展示价格/source fallback、时长及余额检查契约留在原位；fresh 的冻结输入、模型数量、分辨率、draft、reference-only、时长与剩余费用使用方留在原位。原 estimatePlanCost、quote/estimatePlanImageCost 的函数体也没有改变。函数体比对与批准路径指纹见 [机器记录](implementation.json)。

收益是这项重复规则只有一个权威实现，不是减少了整个 fork 的差异路径，也不保证以后合入上游没有冲突。上游修改计划、模型或原估算契约时，两处必要接入仍需复核。

## 保留的行为

表中金额来自 synthetic/mock 费率的自动化测试，币种和钱包单位仍为 USD / 微美元。

| 场景                                  | 保留结果与证据                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| mixed configured / built-in           | 每张图计一次；混合设定图用例为 $0.66，移除 built-in 价格后为含 floor 的 $0.80          |
| 无价 mixed 图片                       | `priced: false` 继续传到 Continue；保守数值仍供余额门槛使用                            |
| 单价为零的有效配置图片                | 仍清除图片 counts，并保留 platform source，不以费用是否大于零判定 quote 存在           |
| 完全未绑定的内置图片                  | 原 counts 交回旧估算器；保留原 fanout 和未知价格 floor                                 |
| 参考图但没有 still                    | 仅报价真实参考图，不增加 still；未绑定 sheet-only 的旧 priced 判定保持                 |
| 多模型                                | 按冻结 picker 模型去重；参考图不乘 still fanout；内置绑定仍走所捕获的渠道              |
| 真正零图片                            | 零图片小计，无新增 floor 或 platform source，不为未执行的图片校验渠道                  |
| 无效渠道或缺配置价格                  | 原拒绝继续抛出，不转到其他供应商，也不先修改 counts                                    |
| 待保存 picker / 720p / 1080p          | 原真实规划和内存 D1 测试保留，报价使用请求选择，既有持久化和余额断言保留               |
| draft 480p 与原 720p / 1080p 视频估算 | fresh 新用例运行真实估算器并断言固定金额；原保守 reference route、时长和分辨率参数保持 |

仅有无价内置参考图而没有 still 时，Continue 原逻辑仍可能返回 priced=true。这是本批明确保留的旧展示判定，没有顺手扩大检查范围。估算不是最终账单，原资金 owner、claim、reserve/capture/release、dispatch 和运行快照没有迁移。

## 原断言、验证与限制

原 6 个测试文件的 159 处 matcher-call AST 均保留；5 个测试文件源码完全不变，fresh 原断言也没有删除或替换。新增两个独立测试文件，并在 fresh 原文件增加真实估算器矩阵。具体逐文件数量见机器记录。

- 改前：6 文件、57 项通过。
- 修正新增测试后：3 文件、27 项通过。
- 最终集成：12 文件、135 项通过，包含真实内存 D1 余额、旧估算器、fresh render gate、客户端/服务端和 domain-blind 边界。
- `bun typecheck`、`bun lint`、`bun dead-code`、`bun run build` 通过。lint 的 146 条警告来自其他文件，本批路径没有警告；knip 有 6 项配置提示，构建依赖及插件时长提示保留。
- 本批 7 个文件格式检查及 diff 检查通过。全仓格式未在本轮重跑，上一批的范围外问题仍见其记录，没有批量格式化或声称全仓格式通过。
- 正常提交钩子的 typecheck/lint/format/knip/client-server-boundary 通过，没有绕过。
- 新函数 25 行，保守复杂度上界 4、判断嵌套 1；两个接入函数由 46/47 行缩为 41/42 行。既有 freezeFreshGenerationPlan 仍为 55 行，函数体没有改变，不借本批拆分其控制流。

首次检查暴露新增合成测试输入的可选分辨率类型、三条误用 i2v 价格的金额预期，以及新增顶层用例没有继承 describe 内网络 spy 的作用域问题。已分别以必填 fixture 类型、原源码的 reference-route 金额 oracle、文件级原钩子修正。生产逻辑没有为测试预期改价；最终上述检查通过。初次失败与复跑关系见机器记录。

本轮证明源码、单元和构建状态。新 Continue/fresh 费用衔接用例明确 mock 规划读取与配置，并运行真实报价/估算器；原 Continue 真实规划与内存 D1 测试、余额 gate 测试另外保留。未执行真实供应商或付费生成、Cloudflare Workflows 引擎重放、浏览器端到端、远程数据库写入或部署。没有推送。

## 全量进度、后续和回退

冻结设计及 1,219 个原始 pending 记录保持原样，没有按整文件、目录或 GC-07 批量批准。两个新增测试路径归入 GC-07，实际 before/after 与实施状态追加到 [台账](../p3-implementation-log.jsonl)。

下一批是 `G07-callers`：按完整入口矩阵复核 Update all preview/run、plan/execute、smart-retry、sequence-models 等分支及现有模型快照契约，保持 digest 拒绝、partial/hold 和父子任务配置。本批没有用这 135 项测试代替其完整验收。G09-ownership-verify 和其余全量职责仍待推进。`CONTINUE-LLM-SOURCE` 按用户决定暂缓，商业规划仍按各自授权范围推进，P4 未开始。

后续上游增加图片单位种类、修改原 estimatePlanCost/floor、冻结请求字段、picker fanout、分辨率或配置价格校验时，复核共享分区及原断言。可以单独 revert 上述代码提交回退本批；本批没有数据或任务字段迁移。
