# P3 MC-B02：配置文本成本归属迁移

日期：2026-11-10。状态：MC-B02 结构批次完成；MC-06 全职责和 P3 仍进行中，P4 未开始。

## 固定范围

- before：`ef6563cb75180bfc18982ef282ac3f38bdb59734`。
- 代码及功能文档提交：`c4c584a7fa9ded32aa2393e78857baea4851827c`。
- 纯上游基线 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。
- [机器记录、AST 对照及测试边界](implementation.json)。

本批落实全量设计 MC-06 的 MC-B02，只迁移 configuredTextCostUsd 与每百万 token 常量。该函数原本只有一份；本批收益是把计费算式归入 billing，服务端模块保留协议、采样、能力和 usage 包装职责，不把这次移动说成减少重复算式或已消除升级冲突。

## 实际改动

新增 src/billing/configured-text-cost.ts，原样承接函数的签名、函数体及 TOKENS_PER_MILLION。configuredTextUsage 与 llmCostFromUsage 分别导入新位置；两个原测试只调整导入，原断言不改。不新增再导出，也不复制第二份计算。新模块只有类型导入，没有 SDK 或服务端运行时依赖。

成本函数 AST 完全相同，适配模块在去掉迁移声明后的其余 AST 完全相同，llm-client 的全部非 import 声明 AST 完全相同。配置费率替代网关 cost=999、非法 token、明确零价、小数 token 和低于一微美元的 USD 精度保留；现有钱包边界继续转换微美元。source 解析、estimateLLMCost、原生/LLMTR/OpenRouter 费用规则和工作流 payload 保持。没有增加人民币销售计价或结算功能。

configured-text.ts 从 107 行减少至 92 行；新纯模块 19 行，迁移函数 14 行，圈复杂度 3、控制嵌套 1。新测试 100 行，各函数不超过 50 行。llm-client.ts 的既有 1,278 行保持，只有导入变动，其长函数和控制流未借机拆分；这项原有规模债务没有记为解决。该文件是本批唯一触及的既有上游路径，本批没有减少既有上游修改路径数。

## 验证

- 改前与改后相同 7 文件、各 186 项通过，其中新增 13 项边界测试先在原函数上通过，再切换到新模块。次数不相加。
- 6 个既有测试文件的 328 处 matcher-call AST 全部保留；两个文件仅改 import，其余四文件归一化源码不变。
- 新用例使用明确标注的 synthetic USD 费率和 TokenUsage，覆盖缺失 usage/字段、负数/NaN/无穷 token、网关费用和 totalTokens 元数据、零价/零 usage、分项计价、小数 token 及不提前舍入。
- 原路由用例使用 mock SDK stream；durable 与 durable-streaming 使用 mock workflow 上下文。assistant 用例 mock 成本函数，验证完整 key 信息和扣费接线，不能单独当作费用算式的动态验收；真实算式由纯函数和 llm-client 用例补齐。
- bun typecheck、bun lint、bun run build 通过。lint 的 146 条警告均不在本批路径。7 个本批文件格式检查通过，未重跑全仓格式。
- 正常提交钩子通过 client-server-boundary（17 项）、knip、format、lint、typecheck，无 bypass。
- MC-B01 的四个生产/测试路径保持其已提交内容，未为本批改写前一批。

## 全量状态与边界

新增源码和测试两路径按 MC-06 追加到 [实施台账](../p3-implementation-log.jsonl)，不改冻结设计的 1,219 条 pending inventory，不按整文件或 MC-06 批量批准。G07-callers 的三类继承风险、G09-ownership-verify 的 G03 前置、用户暂缓的 CONTINUE-LLM-SOURCE 均保持原状态。下一独立候选为 MC-B03。

没有推送、远程写入、部署或真实供应商调用。真实 Workflows 引擎重放、浏览器和供应商验收未执行。两项原有工作区修改的字节指纹保持。
