# P3 渠道执行决策：统一实际 API 路由判定

日期：2026-11-09。起点为 develop 的 a5f09212113edbfef66d9b5d7182100315a3c72b，已合入的上游基线保持 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0。范围来自[主计划](upstream-preservation-plan.md)第 5 节第二项；本批只整理路由分类这一项职责。

## 原行为、重复与取舍

上游普通调用 callLLM 通过 callLLMStream 排空结果；durableLLMCallCf 与 durableStreamingLLMCallCf 保留自己的 Workflow step、限流重试、结构化结果及扣费生命周期。二开管理员渠道沿用 resolveLlmKeyForModel、configuredTextModelOptions、configuredTextUsage 和 llmCostFromUsage；这些共享职责不再包装一遍。

实际重复发生在 llm-client 的 resolveChatRoute 与 llm-call-helper 的 chatModelOptionsForCall：两者分别按 compatible、可用 native xAI、可用 native Google、LLMTR、OpenRouter 的顺序选择 API 形状。模型名字不足以决定路线：Grok/Gemini 也能使用组织 OpenRouter/fal Key；fal 使用 OpenRouter API 形状，实际凭证 via 仍为 fal。

本批新增模型域 server 模块 llm-call-route.ts，集中上述判定，并将 compatible 的捕获路由留在判别联合里。两个现有参数构建入口消费同一结果，继续使用原生适配器的 resolver。现有上游执行器和管理员快照/凭证查找均沿用。

| 指标                                              | 改前 | 改后 | 口径与限制                                                         |
| ------------------------------------------------- | ---- | ---- | ------------------------------------------------------------------ |
| 普通/流式与 durable 参数构建中的 API 分类规则集合 | 2    | 1    | compatible、native xAI/Google、LLMTR 与 OpenRouter 形状的判定顺序  |
| 修改的上游执行器文件                              | 0    | 2    | 核心接入文件数没有减少，只移出重复判定                             |
| 各执行器参数构建入口                              | 2    | 2    | 普通请求采样参数与 durable 默认 reasoning/token 语义不同，继续独立 |
| 新增生产模块                                      | 0    | 1    | 只负责 API 分类，不另建执行/计费/失败恢复框架                      |

凭证优先顺序、native 专用协议、供应商 USD 成本、组织钱包、模型版本、语言、Workflow step 名和幂等键保持原语义。实际 compatible 不跨渠道恢复；仅有休眠绑定时组织/native 调用仍沿用原恢复。没有在本批统一重试或参数默认值，也没有解决禁止 BYOK。

## 行为对照与验证

实际命令、逐轮结果、源指纹、原测试保留证明及静态审查见[验证归档](preservation/20261109-p3-routing/verification.json)。

| 运行             | 结果                     | 用途                                                                                                  |
| ---------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| 改前相关回归     | 13 文件 / 340 项通过     | 固定原行为与原断言                                                                                    |
| 改后原回归       | 13 文件 / 340 项通过     | 原 13 个测试文件字节不变，原用例名称全部保留                                                          |
| 新矩阵首轮       | 40 项通过                | 随后删除普通入口无法接收 Workflow 模型快照的 4 项重复休眠绑定行，并修正 compatible 标签；没有测试失败 |
| 新矩阵精简后     | 36 项通过                | 8 类路线 × 4 入口，加 4 项 durable 休眠绑定对照                                                       |
| 最终格式化后集成 | **14 文件 / 376 项通过** | 0 失败、0 跳过、0 todo；最终统计只取本轮，不叠加各次执行                                              |

新矩阵覆盖 native Grok、native Gemini、同类模型使用组织 OpenRouter/fal、LLMTR Chat Completions/Responses，以及覆盖内置 native 模型的 compatible 两种协议。每行同时检查实际 SDK 工厂、模型/凭证及参数形状，流式入口检查实际 model/via/usage，durable 检查扣费金额与实际来源。结构化完成对象与文本草稿故意不同，避免把未验证草稿误作返回结果。休眠绑定只在实际接收模型快照的两个 durable 入口测试。

Babel TypeScript AST 对照确认 callLLM、callLLMStream、callLLMStreamOnce、两种 durable 执行函数、withCallRoute、resolveCallKey、usage 和成本函数保持原实现；生产差异只涉及移出原分类、baseChatOptions、工具参数类型及 chatModelOptionsForCall 的分类消费。相同源码 AST 不独自证明间接行为，实际调用由上述回归补证。

bun typecheck、四个改动源码文件的定向 type-aware lint 与格式检查通过。新增模块 25 行、函数 12 行；新增测试 631 行，最大函数 38 行。llm-client 原有 1,293 行，本批减为 1,278；durable 参数函数由 64 行增为 65 行，仅接入共享分类并保留其参数职责，不为本次提取拆分无关的遗留执行骨架。

## 升级关注与边界

上游增加 native API 或修改解析规则时，在 llm-call-route.ts 核对公共分类，并分别维护普通及 durable 的协议参数。分类结果不是实际凭证 via；fal 仍按 fal 认证、归因与成本语义处理。新增分类不能绕过 createAdapter 的模型/Key 不匹配拒绝。

本批测试使用 Node/Vitest，四个实际入口、真实参数/适配器构建配模拟 SDK stream、Workflow step、凭证与扣费；未证明 Workerd 引擎恢复、真实供应商兼容、供应商账单或部署。未执行远程 D1、付费模型、真实邮件或部署。CONTINUE-LLM-SOURCE 按用户决定继续暂缓；P3 其余事项、P4 持续门禁与新上游合入未计为完成。

原有 src/routeTree.gen.ts 改动保留且不纳入提交；本批只做本地提交，未推送。
