# 管理员文本渠道

更新：2026-11-16。本文保留现行契约，历史测试数字和逐批修复记录通过末尾固定 Git 版本查阅。

## 来源与范围

- **上游已有**：文本目录、用户选模、Google/xAI/OpenRouter/fal/组织 LLMTR 路由、组织凭证和余额框架。
- **二开已实现**：管理员平台文本渠道、内置/自定义模型绑定、只读候选发现、动态目录及冻结路由。
- **未实施**：全面禁止 BYOK、人民币售价、汇率、利润核算和销售结算；现行组织凭证优先规则仍在。

## 管理、发现与公开目录

入口为 `/admin/models?tab=text-channels`。管理读取、保存及候选发现均经 `systemAdminMiddleware`。

| 对象 | 当前契约                                                                 |
| ---- | ------------------------------------------------------------------------ |
| 渠道 | 名称、Base URL、启用状态、只写 Key、协议、可选 User-Agent                |
| 协议 | `openai-chat-completions` 或 `openai-responses`，新增默认使用前者        |
| 绑定 | 内置逻辑 ID 或 `custom:` 身份，绑定准确上游 ID；一个逻辑 ID 一个当前绑定 |
| 能力 | 图像输入、结构化输出、工具、上下文和最大输出；最大输出不超过上下文       |
| 成本 | 输入/输出每百万 token 的 USD 供应商估算单价，可显式为零，不是人民币售价  |

启用的内置绑定必须保留该模型必需的结构化输出、工具及原有视觉能力。
Base URL 填到 `/v1` 等公共前缀，由适配器补接口路径；使用 HTTPS，仅本地 loopback 允许 HTTP。
URL 不接受内嵌凭证、查询参数或 fragment。保存配置不等于认证供应商实际能力。
User-Agent 默认 `OpenStory/0.1.0`，自定义最多 256 个可打印 ASCII 字符；不提供任意请求头入口。

候选同步仅以已存凭证调用 `GET <baseUrl>/models`，限制超时/响应体，拒绝重定向。
New API 端点元数据按协议匹配 `openai`/`openai-response`；普通目录按既有文本候选规则筛选。
同步不写配置、不启用/删除绑定、不推断能力、额度或价格。选择候选只打开禁用草稿。
公开目录合并内置和有效自定义条目，保留内置隐藏/退休属性，不暴露地址、上游 ID、渠道和凭证信息。

## 实际路由与失败策略

绑定、渠道均启用且存在凭证引用，才进入执行快照。

1. 内置模型优先适用且有效的组织凭证：相应原生 xAI/Google、已映射 LLMTR、OpenRouter、fal。
2. 无可用组织凭证时使用有效管理员绑定；没有绑定时继续原平台兜底。
3. `custom:` 模型只使用有效管理员绑定；无有效路由时拒绝，不交给其他供应商猜测模型 ID。

停用内置绑定只撤销覆盖，不等于全局下架。不可用自定义默认覆盖回到该槽代码默认。
已选择的兼容路由调用失败不切换渠道、原生供应商、OpenRouter/fal 或地区替代模型。
SDK 重试为零；原工作流对同一路由的既有步骤重试语义另行保留。

适配器按协议发送 `/chat/completions` 或 `/responses`；前者使用 `max_tokens` 和流式 usage，后者使用 `max_output_tokens`。
结构化输出、工具、图像及 usage 由现有 SDK 转换，并受声明能力及 token 上限约束。
原生视频人物检查和助手视频理解仍走 Google Files 专用路径，`talentVideo`/`watchClip` 不被文本绑定捕获。

## 保存、凭证与运行快照

复用 `app_metadata`，不新增表或迁移：

| 键                                                                | 内容             |
| ----------------------------------------------------------------- | ---------------- |
| `secondary-development:text-channels:v1`                          | 渠道及绑定元数据 |
| `secondary-development:text-channel-credential:v1:<credentialId>` | 独立加密凭证     |

沿用 AES-256-GCM；管理读取只返回提示和引用，不回显原文或密文。Key 留空保留，变更已有渠道地址需提交新 Key。
轮换创建新凭证 ID；普通配置 upsert 与新凭证插入同一 D1 batch，保留旧密文供既有任务使用。
单管理员配置不并发，不维护 revision、数据库 CAS 或过期草稿协议；主库读取和会话切换隔离继续保留。
供应商撤销旧 Key 后，旧任务仍可能失败，不自动借用新凭证。

触发前加载完整运行配置，服务器快照覆盖请求 body，父子任务与失败处理沿用原配置。
现行文本 wire 为 v1 字典格式，按完整渠道身份去重；旧平铺数组不再支持。
快照冻结绑定、地址、协议、User-Agent、能力、token 上限、USD 单价及凭证 ID，不携带密钥或密文。
调用步骤只按冻结 ID 解密，不重读当前渠道；保存、停用或轮换不重定向已启动任务。
合法省略配置使用代码默认及空路由，不在回放时读取当前管理员状态。

## 预算、用量与鉴权归属

供应商成本估算由有效 prompt/completion token 及冻结的每百万 token 单价计算，不直接信任网关同名 cost 字段。
缺少有效 token 时报告成本缺失，不借用原生模型价格补算；这不是供应商账单核对结论。
余额预检、预留及扣费按实际解析的凭证来源判断，无关组织 Key 不免除平台支出。
LLM 前置粗估仍保留；助手固定预检不随渠道单价变成精确报价。

分场辅助调用在解析实际凭证后计算输出预算：兼容路由用冻结额度，其他 via 用已有静态规格。
请求侧预览加载完整运行配置，工作流内预览继承父快照，提示词软化不遗漏文本绑定。
鉴权失败使用实际失败调用的安全 source/via/model 信息，不重新解析父模型猜测密钥归属。

## 实现与升级检查

- `text-channels.ts`、`text-model-catalog.ts`：schema、路由和公开目录；静态目录不承接动态配置职责。
- `server/text-channel-service.ts`、`server/db/text-channels.ts`：保存、发现、加密凭证持久化。
- `text-channels.fn.ts`、`ui/admin-text-channels*`：权限及管理交互。
- `server/llm-key-routing.ts`、`configured-text.ts`、`create-adapter.ts`：凭证选择、协议、能力和预算。
- `workflow-text-model-routing.ts`、工作流调用桥接：wire、快照传递和不跨渠道回退。

升级时核对 SDK 协议/usage/defaultHeaders、模型能力、原地区策略、原生 Files 路径及工作流凭证边界。
详见 [模型配置架构](../architecture/model-configuration.md) 和 [媒体渠道架构](../architecture/media-vias.md)。

## 验证边界与历史

历史有本地 Mock/真实 SDK、测试 D1、Workerd/浏览器和构建证据；仅部分渠道曾做只读或授权短请求验证。
助手工具 Schema 修复的授权真实角色创建只证明该请求越过原报错点，不证明图像生成或回复准确性。
所有历史成绩受各自版本和场景限制，不能宣称任意网关工具、视觉、结构化输出、生产网络均已通过。
本次仅整理文档，没有新增供应商请求、数据库写入或部署验收。

- [完整文本渠道实施和历史验证](history-archive.md#records 'c92b2f5cb1739dc7585779b83a6177b1534e0f7d:docs/secondary-development/text-channels.md')
- [助手工具 Schema 修复及真实调用边界](history-archive.md#records 'c92b2f5cb1739dc7585779b83a6177b1534e0f7d:docs/secondary-development/assistant-tool-schema-fix-20261107.md')
- [保存与旧快照协议退役记录](history-archive.md#records 'c92b2f5cb1739dc7585779b83a6177b1534e0f7d:docs/secondary-development/fork-isolation-node26-followup-20261115.md')
