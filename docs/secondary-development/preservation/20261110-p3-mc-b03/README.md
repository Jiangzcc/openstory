# P3 MC-B03：配置图片价格精度策略归属迁移

日期：2026-11-10。状态：MC-B03 结构批次完成；MC-10 全职责和 P3 仍进行中，P4 未开始。

## 固定范围

- before：`a5c8e6261e4d5564f57a7c500ff96aacbec970c0`。
- 代码及功能文档提交：`95863667e4b58ac43718bd7a15f244787e97094b`。
- 纯上游基线 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。
- [机器记录、原断言 AST 对照及验证边界](implementation.json)。

本批落实全量设计 MC-10 的 MC-B03，只调整图片单张 USD 售价的钱包接纳策略归属。原函数已有两个调用点并且只有一份；本批不把职责移动说成减少重复谓词、减少既有上游修改路径或消除未来升级冲突。

## 实际改动

新增 src/billing/configured-image-price-policy.ts，承接 imageUnitPriceFitsWallet。启用模型保存与运行报价直接导入新位置；新模块只依赖 money.ts 的 usdToMicros、microsToUsd 和 ZERO_MICROS。重复的微美元换算字段 IMAGE_PRICE_LIMITS.microUsdPerUsd 无外部使用者，随原实现移除；不增加旧路径再导出或第二份谓词。

仍然先把单张售价转换为微美元，再要求其为非负安全整数且精确还原原 USD 数值，保持原来的严格相等语义，包括接受 0 和 -0。纯钱包策略不负责价卡最高售价：例如 synthetic 8,000,000,000 USD 可通过纯精度判断，但仍被价卡 schema 的 1,000,000 USD 上限拒绝。价格匹配、最具体规则、imageCount、priceCardId、unitPriceUsd、totalUsd、错误字符串和 issue path 保持。

钱包精度 refinement 继续只位于启用保存和报价边界，没有放入共用价卡 schema。精度不合格但其他字段合法的历史配置仍可读取、纠正或禁用；supplierCost 保留原币种和数值约束，不套销售钱包精度。未修改 schema、迁移、账本、货币含义、预占或扣费规则，没有实施人民币销售计价。

pricing 模块除移走的声明、无引用换算字段和 import 外，其余 AST 完全相同；image-channels.ts 非 import AST 完全相同；money.ts 归一化源码不变。新增纯模块 11 行（含文件末尾空行），函数 8 行、圈复杂度 3、控制嵌套 0；新增测试 151 行，最长函数 36 行。两处原模块均未扩大职责。

## 验证

- 新增 33 项边界用例先调用旧 models 函数：与三个原测试文件合计 4 文件、93 项通过；迁移后包含该套用例的 16 文件、288 项通过。两次成绩不相加。
- 固定三文件的 103 处 matcher-call AST 全部保留。进一步与 before 提交对照，本轮选中的 15 个原测试文件归一化源码均未改，664 处 matcher-call AST 全部保留。新增测试的 17 处 matcher-call AST 改前改后相同，仅切换函数导入。
- synthetic 数值覆盖 0、-0、最小微美元、普通合法小数、价卡上限、纯精度与最高售价分离、负数、NaN、无穷、极小值、超安全整数以及不能精确还原的单位价。历史可读／纠正／禁用、启用失败的原消息和路径、CNY 供应商成本不影响销售接纳均有真实 schema 用例。
- 原纯函数测试保留单张价格先验、部分输出、零价和混合计划累计。生成测试 mock 付费供应商；Workflow 测试使用 mock step、存储及上下文，验证按实际交付张数计价。渠道 CRUD/CAS 和余额／预占测试使用 createTestDb 的真实内存 SQLite/D1 API；未据此宣称完成历史异常记录从数据库读出再纠正的端到端验收。
- 中英文费用展示使用真实 React renderToStaticMarkup 和 i18next，保留最小微美元显示，不是浏览器 hydration／导航验收。
- bun typecheck、bun lint、bun run build 通过。146 条 lint 警告均不在本批路径；5 个本批文件格式检查通过，未重跑全仓格式。
- 正常代码提交钩子用时 120.35 秒，client-server-boundary（17 项）、knip、format、lint、typecheck 全部通过，无 bypass。

## 全量状态与边界

新增源码和测试两路径按 MC-10 追加到 [实施台账](../p3-implementation-log.jsonl)，不改冻结设计 1,219 条 pending inventory，不按整文件、目录或 MC-10 批量批准。MC-B01／MC-B02 已提交内容没有为本批改写。G07-callers 的三类继承风险、G09-ownership-verify 的 G03 前置、用户暂缓的 CONTINUE-LLM-SOURCE 保持原状态。

下一独立职责为 G01-verify：真实身份、组织与任务语言入口复核，先验证已有薄桥接，不增加通用上下文包装器。该职责开始静态核对，未计为完成。

没有推送、远程写入、部署或真实供应商调用。真实 Workflows 引擎重放、浏览器／端到端和供应商验收未执行。两项原有工作区修改的字节指纹保持。
