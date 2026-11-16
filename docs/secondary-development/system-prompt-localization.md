# 中英文系统指令

更新：2026-11-16。本文记录当前语言传递、模板、内容及协议契约；历史实现与逐批验证见[归档原件](history-archive.md#records 'c92b2f5cb:docs/secondary-development/system-prompt-localization.md')。本次整理未重新运行模型或生成链路。

## 上游基础与二开范围

上游已有代码模板、业务上下文、异步工作流、配方快照及作品提示词版本管理。二开增加按网页请求语言选择独立中英文系统指令，并补齐平台风格配方、示例及新创作描述的语言要求；不新增模板管理后台或作品翻译系统。

中文请求使用中文系统指令，英文请求保留英文指令。用户查看、编辑和恢复的始终是真实保存内容；系统语言不等于对白语言，也不保证模型请求完全没有英文。界面、邮件及风格展示规则见[国际化契约](localization-plan.md)。

## 请求与任务语言

- 语言类型复用 `Locale`；内部上下文和工作流载荷的 `promptLocale` 必填，只接受 `zh-CN`、`en`。
- 网页从原始 Request 的 `openstory_locale` Cookie 确定语言；缺少、非法或不支持的值默认中文，非法编码按既有解析规则处理。
- 助手从自己的原始 Request 取语言，再通过内部 MCP 上下文传给共享服务；客户端工具参数不替换可信用户、组织或语言上下文。
- 外部 API/MCP 入口显式使用 `EXTERNAL_PROMPT_LOCALE = 'en'`，不新增公开语言参数；额外语言字段不覆盖认证上下文。
- 新任务保存本次请求的语言；父子任务、继续、预览及重试显式传递所属任务语言，不在执行中重读 Cookie。
- 幂等复用已有实例不重写原载荷，语言不改变幂等键、扣费或实例身份。
- 不使用进程级可变语言，不把语言放入 ScopedDb 或数据库插入参数；工作流 base 拒绝缺少或非法的 `promptLocale`。
- 项目未上线，不兼容缺少语言的历史任务；纯内容 DTO 不因此添加语言字段，真正创建子任务时再带入语言。

请求解析和外部默认值归 `src/platform/i18n/prompt-locale.ts`；任务类型及触发器归既有 workflow 层。跨域只传语言上下文，不把领域资源引入无领域依赖的平台模块。

## 资源与选择入口

| 所有者                                       | 职责                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/platform/server/ai/workflow-prompts.ts` | 版本化英文主注册表                                                                            |
| `src/platform/server/ai/prompts/zh-CN/`      | 与主注册表配对的独立中文资源                                                                  |
| `src/platform/server/ai/prompts-index.ts`    | `getPrompt(name, variables, locale)`、`getChatPrompt(name, variables, locale)` 与原有变量替换 |
| 各业务域的 server/资源模块                   | 助手、Studio、上传、风格、音视频及其他领域独立指令                                            |

未知模板仍报错；中文资源缺项可回退已有英文，目录完整性测试负责发现缺项，不能据回退宣称已翻译。翻译固定 `user` 包装消息不改变其消息角色，多模态引用继续使用原内容结构。

覆盖主注册表普通/流式调用、拆场景直接入口、助手系统说明/页面上下文/附件包装、Studio 草拟、精简与时长估算、风格推荐、上传描述/元素识别/真人分类、看片、润色/边界修复及拒绝软化。新增直接 LLM 调用须显式检查是否经过语言选择。

Schema 描述、共享 MCP 和工具技术说明可保留英文；结构完整性不代表中文指令与英文在语义上等价，仍需人工审校安全约束与格式要求。

## 风格与新创作描述

平台风格只有在可信服务确认 `isTemplate === true` 后，才按请求语言解析已知配方字段；自定义、自动生成、推广入库风格及未知原文不套用平台目录译文。具体显示及示例规则归界面国际化文档。

新建或明确换用配方时保存解析后的真实内容。生成、继续、重试及复制已生成自动风格读取实际快照；目录变化或切换界面语言不覆盖旧作品。平台推荐、剧本润色和创建复用同一配方解析入口，数据库层只接配方。

中文场景分析、设定提取、镜头设定、自动风格及镜头重写要求新写自由描述使用简体中文；自动风格的缺字段正文按任务语言补全。用户姓名、指定画面文字、逐字引用、对白、ID 和枚举保持原值。

静帧/动态提示词的固定运镜描述、自然光兜底、导演风格、海报/预览及音轨说明按调用语言组装；单镜头、合镜、长度预检和请求预览传递同一语言。已有光线、时间、地点及用户描述保留。

旧镜头设定的纯重建仍从旧内容派生，不调用模型翻译。切界面语言后仍可能看到原英文配方或历史描述；另一语言的创作内容须通过明确新建或重写产生。

## 保存、哈希与供应商协议

- 不因系统指令语言新增表、迁移或数据库语言字段；`promptLocale` 不进入 `inputHash`，语言切换不使历史提示词过期。
- 配方本身是实际输入，保存后的内容由生成与待更新判断读取；明确换用不同内容沿原有版本和哈希规则处理。
- 画面/视频提示词及音乐继续使用各自既有版本与复用规则；音乐可返回 `alreadyUpToDate` 或复用同摘要行，不保证切语言会重新生成或保存另一语种。
- JSON 字段、限定枚举、变量、引用 token、素材绑定及供应商 markup 不翻译。软化模板继续在原位置保留模型专用标签，内容和安全约束不能弱于英文。
- 中文润色保留代码解析的 `Scene N — Xs`、`TOTAL:`；Seedance 时间标记、`cut to`、引用/音频 token 和 Kling `multi_prompt` 结构保持。
- MiniMax 的 `<d>`、`[English]`、`overall_soundscape`、`non_diegetic_music: N/A` 等沿原协议；`[English]` 不由 UI locale 推断对白语言。
- `Photoreal live action` 等精确比较常量、内部标识和资源路径保持原值；供应商最终请求不做整段自动翻译。

## 上游升级检查

1. 核对主英文模板、新增领域 owner、变量、消息角色、多模态引用、Schema 和中文配对资源；英文规则变更须同步审校中文。
2. 检查网页/助手/上传入口、手工构造的父子任务、Continue、Update all、预览、重试及直接 LLM helper 的语言透传。
3. 保留权限、凭证解析、模型快照、费用、claim、存储及供应商安全分类原流程；不复制执行器或借语言增加兼容/恢复协议。
4. 模板至 Mock 请求回归应覆盖普通与流式调用，以及最终消息的语言和结构；录制夹具按真实匹配条件维护，不能把英文录制当作中文链路验收。

只读差异报告的命令见[国际化维护入口](localization-plan.md#上游更新与差异复核)。英文 owner 或局部 guidance 的 AST 变化会提示配对中文复核；注释/格式/CRLF 不触发。同文件双语模块不推断改动语种，中文同时变动也不批准语义，`semanticApproval` 始终为 `false`。新增 owner 与间接依赖仍需人工分类。

报告只解析文本，不 import 或运行真实模板，不自动执行既有 catalog 测试，不能替代变量、角色、引用、安全约束和协议格式检查；P4 的 CI 接入未实施。

## 证据与待验证范围

历史本地自动化已覆盖 Cookie 默认/中英/非法值及请求隔离、可信入口和外部英文默认、任务/子任务传递、工作流拒绝非法语言、真实模板加载至 Mock `chat()`、风格资源、真实本地数据库快照与哈希，以及视频自然语言和协议标记。各批次的类型、静态检查、构建和定向/全量成绩保存在原件，不将历史成绩冒充当前重跑。

已有浏览器证据覆盖风格详情及示例、中英切换、部分新建页灵感与草稿恢复；隔离组件、合成路由或 Mock 验证各有边界，不代表完整中文登录与生成流程。真实供应商中文生成质量、中文全流程录制、真实邮件及生产部署仍待对应环境验收。

修改此区域时按范围复用现有测试，例如：

```bash
bun run test src/platform/i18n/prompt-locale.test.ts src/platform/server/ai/prompts/catalog.test.ts src/models/server/llm-call-helper.prompt-locale.test.ts
bun run test src/sequences/server/resolve-style-source.test.ts src/look/localization/style-content.test.ts
```

这些测试使用本地/Mock 证据；通过后仍需检查新增入口与中文语义。历史来源：[系统指令改造](history-archive.md#records 'c92b2f5cb:docs/secondary-development/system-prompt-localization.md')、[风格与派生描述](history-archive.md#records 'c92b2f5cb:docs/secondary-development/style-localization.md')、[版本差异报告](history-archive.md#records 'c92b2f5cb:docs/secondary-development/upstream-preservation-p3-localization-20261109.md')。
