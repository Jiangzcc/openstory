# C 侧原断言追溯与记录修正（2026-11-09）

## 固定对象与验证口径

- B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。原 P2 起点：`ce321c885f67e40fec1c8598bb759790d89359c9`。
- 主线 assertion inventory 的冻结 HEAD2b：`2b41bbf33b75c66035dc0af08df6eea79e3de929`，见 [summary](assertion-inventory-summary.json) 与 [逐文件 inventory](assertion-inventory.jsonl)。
- 本文沿用并补全已审的 12 份既有测试净差异。已逐文件核对 inventory 的 upstreamBlob 等于 B，reviewedBlob 等于该文件 P2 blob；这 12 份当前工作区源码仅规范 CRLF 后也与 P2 相同。主线冻结对象与本次追溯对象一致。
- 本文没有重新运行这些测试。AST 表达式相同不证明 setup、分支可达、调用参数或执行顺序相同；以下同时记录所读差异中的调用/guard 改动。测试数量只作定位，不证明等价。
- inventory 在本范围标出 generation-mode 1、model-assets.fn 4、api-keys 1 个原表达式变化；六处均在本文 C-ASSERT-01～06 展开。没有 inventory 变更表达式的文件仍按实际差异审阅。
- P1 的 helper/region 两份测试、P1 20/276 套件、其它 owner 的原测试追溯不在本文。Continue 计费缺陷依用户决定暂缓；本文没有处理或批准该缺陷。

## 十二份既有测试的保障与对应

### 1. src/models/ai.recommend-styles.test.ts

- B 原保障（`B:src/models/ai.recommend-styles.test.ts:48`）：编号与 style-id 顺序、空字段分隔、色板/参考上限、热度与描述截断；推荐索引映射、排序/去重/无效索引/limit/reasoning 处理。
- 当前对应：[ai.recommend-styles.test.ts:48](../../../../../src/models/ai.recommend-styles.test.ts#L48)。buildStyleCatalog 的四处原调用显式传 en；原 catalog 文本、ID 顺序及 rankStyleRecommendations 的具体期望保留。
- 必要替换与依据：C-13 显式语言契约；英文模式用于继续检查 B 的原保障。没有替换上游 matcher/期望。
- 覆盖边界：审阅的是 B→P2 的完整测试净差异和对应调用；未证明所有 locale、用户风格和真实模型推荐效果。

### 2. src/models/aspect-ratios.test.ts

- B 原保障（`B:src/models/aspect-ratios.test.ts:8`）：宽高比数值、零面积 box、横竖/方形 fit 与 Tailwind class 原期望。
- 当前对应：[aspect-ratios.test.ts:9](../../../../../src/models/aspect-ratios.test.ts#L9)。B 的原测试主体没有删除或替换；新增 resolveVariantImageSize 的比例网格与旧任务未带比例时的请求尺寸回退。
- 必要替换与依据：C-07 规格/报价与执行共用尺寸；新断言追加，原保障不因新增用例自动视为已验证。
- 覆盖边界：未运行；图片供应商是否按该尺寸交付不在此纯逻辑测试内。

### 3. src/models/enhance-duration.test.ts

- B 原保障（`B:src/models/enhance-duration.test.ts:143`）：Scene 时长解析与 TOTAL 流式过滤、grid/纠正阈值、合计与估算、title-card 识别；英文提示要求总和/TOTAL/真实结尾与非 clip-grid。
- 当前对应：[enhance-duration.test.ts:158](../../../../../src/models/enhance-duration.test.ts#L158)。两个原英文用例仅补 en，原具体 matcher 保留；中文新增用例将 Scene 标签交给 parseSceneDurationLabels，并检查 TOTAL 删除及纠正 sum/target/标记。
- 必要替换与依据：C-13；system-prompt-localization.md:13、43 明确语言参数及 Scene/TOTAL 协议。
- 覆盖边界：中文测试检查指定文本/数值和解析兼容，不是全文语义等价或模型遵从性证明。

### 4. src/models/generation-mode.test.ts

- B 原保障（`B:src/models/generation-mode.test.ts:46`）：模式切换四类默认、同模式保留、原推荐值、选择器顺序、Turbo 风格/目录规则；图片目录元素通过原 isValidTextToImageModel 检查。
- 当前对应：[generation-mode.test.ts:50](../../../../../src/models/generation-mode.test.ts#L50)。原具体默认、排序和同模式期望保留；静态注册表索引与一处身份 expect 改用 isBuiltinTextToImageModel，新增管理员四类槽位和 Studio 视频回退用例。
- 必要替换与依据：C-01／FC-05：配置默认和显式选择策略；C-06 仅覆盖本测试真实存在的内置 guard 适配。变更表达式 C-ASSERT-01 逐项记录。
- 覆盖边界：内置 guard 的替换是有意收窄，不宣称函数名字/契约完全未变；新增供应商回退场景的比例实际均为 16:9。

### 5. src/models/model-assets.fn.test.ts

- B 原保障（`B:src/models/model-assets.fn.test.ts:155`）：动态输入 schema 的接受/拒绝与额外键；受限账号和无效输入在 credit gate 前拒绝、无余额不插行/触发；正常行/trigger/dedup 身份与失败落库后重新抛错。
- 当前对应：[model-assets.fn.test.ts:155](../../../../../src/models/model-assets.fn.test.ts#L155)。所有 createGeneratedAsset 调用显式补 en，正常 trigger 期望增加 promptLocale: en；原 AccountRestrictedError、Insufficient credits、binding exploded、DB 行和原 payload/dedup 字段保留。
- 必要替换与依据：C-13 显式 locale 与父子载荷；C-ASSERT-02～05 覆盖 inventory 的全部四个变更表达式。
- 覆盖边界：schema/余额/插行断言保留不等于真实 Workflows 已执行；此处 trigger 与外部依赖使用 Mock，D1 行断言是真实隔离回读。

### 6. src/models/models.test.ts

- B 原保障（`B:src/models/models.test.ts:222`）：内置目录、编辑/参考、媒体能力与合法/非法模型及 safe fallback；Type Guards 中合法静态图片分支的 IMAGE_MODELS 索引非空。
- 当前对应：[models.test.ts:223](../../../../../src/models/models.test.ts#L223)。图片 Type Guards 用例更名并将 if 条件改为 isBuiltinTextToImageModel；分支内原 toBeDefined 期望不变，其余原净差异无断言删除。
- 必要替换与依据：C-06：TextToImageModel 含自定义身份后，静态 IMAGE_MODELS 索引需要内置 guard。库存中的 expect 文本不变不能替代对此 if 条件的审阅。
- 覆盖边界：原用例和当前用例都没有额外断言该 if 必进入；保留它不证明所有自定义/非法输入的 guard 语义。

### 7. src/models/resolve-asset-models.test.ts

- B 原保障（`B:src/models/resolve-asset-models.test.ts:9`）：图片/视频按显式请求→最后失败→选中版本→序列→应用默认解析，并跳过无效/退役值；无编辑 endpoint 的 upscale 使用原 fallback。
- 当前对应：[resolve-asset-models.test.ts:12](../../../../../src/models/resolve-asset-models.test.ts#L12)。B 原测试主体保留；新增配置图片 identity、缺失/停用、编辑未验证/不支持、冻结绑定与 fallback 绑定验证。
- 必要替换与依据：C-06／C-08；配置身份不伪造静态 endpoint，执行受已捕获的 edit 能力约束。
- 覆盖边界：没有把配置新用例数当原解析器完整等价证明；供应商实际编辑效果未验证。

### 8. src/models/server/db/api-keys.test.ts

- B 原保障（`B:src/models/server/db/api-keys.test.ts:558`）：组织凭证缓存/逐次解密与失效、各 provider 及平台回退等原测试；特定 Gemini + 组织 LLMTR + 平台 Google 场景原来要求平台 Google 先行。
- 当前对应：[api-keys.test.ts:558](../../../../../src/models/server/db/api-keys.test.ts#L558)。该场景明确改为组织 LLMTR；原 key/source/via 三个期望被替换，属于有意业务变化，不属于与 B 等价。其它原测试在该文件净差异中没有删除。
- 必要替换与依据：C-02 和 model-configuration.md:3、49 的组织适用凭证→管理员绑定→平台回退策略；C-ASSERT-06 展开原/当前表达式。
- 覆盖边界：本轮不重跑 P1；不由这一单场景推断所有模型/凭证组合均已验证。

### 9. src/models/server/elevenlabs-config.test.ts

- B 原保障（`B:src/models/server/elevenlabs-config.test.ts:58`）：ElevenLabs 配置/E2E 保护、CI 两个 dev.vars block 的 mock key/localhost、adapter/lazy loader、429/400/5xx/abort 重试规则。
- 当前对应：[elevenlabs-config.test.ts:58](../../../../../src/models/server/elevenlabs-config.test.ts#L58)。唯一净变化是在读取 CI YAML 后将 CRLF 规范为 LF；两 block、有效 mock key 与 localhost:4010 等原期望没有替换。
- 必要替换与依据：跨平台文本读取适配；B 的正则以 LF 匹配，不改变 CI provider 授权策略。
- 覆盖边界：此为静态文本测试读取适配，不能冒充实际执行全部 CI E2E job。

### 10. src/models/server/response-schema-budget.test.ts

- B 原保障（`B:src/models/server/response-schema-budget.test.ts:71`）：已测 schema 的 Anthropic grammar 字节预算、调用点扫描覆盖以及转换后不含不支持 JSON Schema 的约束。
- 当前对应：[response-schema-budget.test.ts:75](../../../../../src/models/server/response-schema-budget.test.ts#L75)。保留原 autoStyleResponseSchema，额外将 createAutoStyleResponseSchema(zh-CN) 纳入 MEASURED_SCHEMAS；原预算、未测 schema 和 violations 期望保留。
- 必要替换与依据：C-13 的中文工厂 schema 也接受原结构约束，不用新 schema 替换原英文样本。
- 覆盖边界：扫描器只识别源码中的指定 responseSchema/outputSchema 标识符形态；不能据库存或测试标题称全应用所有动态 schema 都已测。

### 11. src/models/ui/resolution-support.test.ts

- B 原保障（`B:src/models/ui/resolution-support.test.ts:7`）：视频/图片输出 tier、固定输出、选择并集与宽高比下的可用分辨率，以及低于 tier/fixed-size 的说明。
- 当前对应：[resolution-support.test.ts:18](../../../../../src/models/ui/resolution-support.test.ts#L18)。原主体和期望保留；新增配置 generate/edit、实际参考数、比例/尺寸、只生成 still 时不被视频 draft 限制等场景。
- 必要替换与依据：C-07／C-12 的配置能力接入；新增用例与原静态目录覆盖分别记录。
- 覆盖边界：纯逻辑参数/说明测试，不验证浏览器控件交互或真实输出分辨率。

### 12. src/models/vision-model-routing.test.ts

- B 原保障（`B:src/models/vision-model-routing.test.ts:13`）：带图 text-only 调用切到 DEFAULT_VISION_MODEL；无图或已支持视觉时保留所选；默认 fallback 自身支持视觉。
- 当前对应：[vision-model-routing.test.ts:13](../../../../../src/models/vision-model-routing.test.ts#L13)。原四类保障保留；追加显式 vision fallback、保留可视觉模型和后续调用默认值不被修改。
- 必要替换与依据：C-05 的可配置辅助模型，不改变用户视觉模型选择的原优先规则。
- 覆盖边界：这里只检查模型 ID 解析；实际凭证、协议输入及模型视觉质量依各自边界验证。

## 主线 inventory 的全部 C 侧变更表达式

以下逐项回链 [inventory](assertion-inventory.jsonl)，原表达式使用其中的原文，当前表达式已与本地源码逐字定位（仅 CRLF→LF）。这里的六处定位不是六项运行通过。

### C-ASSERT-01 — src/models/generation-mode.test.ts

- inventory：[第 36 行](assertion-inventory.jsonl#L36)；B 行 213；原 AST 指纹 `d21b1fe633a07b2d4b8c6eb1e0e8f429033d9a5f8d9796134ec54af032771797`。
- 当前位置：[generation-mode.test.ts:217](../../../../../src/models/generation-mode.test.ts#L217)。
- 原保障与对应：原保障是 TURBO_IMAGE_MODELS 的每个 ID 均属于静态图片目录；当前改为显式内置 guard，toBe(true) 和相邻 hidden=false 断言保留。TextToImageModel 增加 custom-image 身份后，原 isValid 的识别范围扩大，静态目录不可继续靠它收窄。这是有意的 guard 适配，并非声称两个函数对所有输入等价。
- 替换依据：C-06；model-configuration.md:73；models.ts 的内置/配置身份分离。

B 原表达式：

```text
expect(isValidTextToImageModel(id)).toBe(true)
```

当前对应：

```text
expect(isBuiltinTextToImageModel(id)).toBe(true)
```

### C-ASSERT-02 — src/models/model-assets.fn.test.ts

- inventory：[第 37 行](assertion-inventory.jsonl#L37)；B 行 163；原 AST 指纹 `d1237127ba527099f31753b8d6cd21eacbc67ef13d9406331aca3840c8ede100`。
- 当前位置：[model-assets.fn.test.ts:163](../../../../../src/models/model-assets.fn.test.ts#L163)。
- 原保障与对应：原保障是受限账号抛 AccountRestrictedError，且 credit gate 尚未调用、无生成行。当前仅为函数补必填 en；错误类型及紧邻的未预检/零行断言保留。
- 替换依据：C-13；system-prompt-localization.md:13、18、49；不改变错误或门禁期望。

B 原表达式：

```text
expect(
      createGeneratedAsset(scopedDb, createData({ prompt: 'ok' }))
    ).rejects.toBeInstanceOf(AccountRestrictedError)
```

当前对应：

```text
expect(
      createGeneratedAsset(scopedDb, createData({ prompt: 'ok' }), 'en')
    ).rejects.toBeInstanceOf(AccountRestrictedError)
```

### C-ASSERT-03 — src/models/model-assets.fn.test.ts

- inventory：[第 37 行](assertion-inventory.jsonl#L37)；B 行 195；原 AST 指纹 `bfb5cc8233ddca4bb4bc086efe109b6bf358393b6dbe17190c4d28b12c89e7aa`。
- 当前位置：[model-assets.fn.test.ts:196](../../../../../src/models/model-assets.fn.test.ts#L196)。
- 原保障与对应：原保障是余额门禁失败抛含 Insufficient credits 的错误，且不触发 workflow、不插行。当前仅补 en；matcher、未触发和空行断言保留。
- 替换依据：C-13；system-prompt-localization.md:13、18、49；不改变错误或门禁期望。

B 原表达式：

```text
expect(
      createGeneratedAsset(scopedDb, createData({ prompt: 'a red fox' }))
    ).rejects.toThrow('Insufficient credits')
```

当前对应：

```text
expect(
      createGeneratedAsset(scopedDb, createData({ prompt: 'a red fox' }), 'en')
    ).rejects.toThrow('Insufficient credits')
```

### C-ASSERT-04 — src/models/model-assets.fn.test.ts

- inventory：[第 37 行](assertion-inventory.jsonl#L37)；B 行 232；原 AST 指纹 `cd86e09e95583f1389838e3851c133b2fb4d802ec967237e960257dda6edf082`。
- 当前位置：[model-assets.fn.test.ts:234](../../../../../src/models/model-assets.fn.test.ts#L234)。
- 原保障与对应：原保障是 /asset 的组织/用户/素材身份、endpoint/activity/input 和 deduplicationId 与插入行一致。当前仅在同一对象增加必填 promptLocale: en；原字段和 deduplicationId 原样保留。整对象有意不与 B 字面相同，目的是显式冻结语言，不是改变生成或计费参数。
- 替换依据：C-13；system-prompt-localization.md:13、17、18；generated-assets.ts 的 workflowInput 组装。

B 原表达式：

```text
expect(mockTriggerWorkflow).toHaveBeenCalledWith(
      '/asset',
      {
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        assetId: result.id,
        endpointId: 'fal-ai/flux-1/dev',
        activity: 'image',
        input: { prompt: 'a red fox', num_images: 2 },
      },
      { deduplicationId: `asset-${result.id}` }
    )
```

当前对应：

```text
expect(mockTriggerWorkflow).toHaveBeenCalledWith(
      '/asset',
      {
        promptLocale: 'en',
        userId: USER_ID,
        organizationId: ORGANIZATION_ID,
        assetId: result.id,
        endpointId: 'fal-ai/flux-1/dev',
        activity: 'image',
        input: { prompt: 'a red fox', num_images: 2 },
      },
      { deduplicationId: `asset-${result.id}` }
    )
```

### C-ASSERT-05 — src/models/model-assets.fn.test.ts

- inventory：[第 37 行](assertion-inventory.jsonl#L37)；B 行 250；原 AST 指纹 `8731b7407b8c9bdea817a5c0cfa287c1a8679ab49b25e999d5518458ad4504cc`。
- 当前位置：[model-assets.fn.test.ts:253](../../../../../src/models/model-assets.fn.test.ts#L253)。
- 原保障与对应：原保障是 trigger 抛 binding exploded 时重新抛出，并将已预留行标 failed、保留安全错误和空 workflowRunId。当前仅补 en；matcher 及后续真实 DB 行断言保留。
- 替换依据：C-13；system-prompt-localization.md:13、18、49；不改变错误或门禁期望。

B 原表达式：

```text
expect(
      createGeneratedAsset(scopedDb, createData({ prompt: 'a red fox' }))
    ).rejects.toThrow('binding exploded')
```

当前对应：

```text
expect(
      createGeneratedAsset(scopedDb, createData({ prompt: 'a red fox' }), 'en')
    ).rejects.toThrow('binding exploded')
```

### C-ASSERT-06 — src/models/server/db/api-keys.test.ts

- inventory：[第 41 行](assertion-inventory.jsonl#L41)；B 行 563；原 AST 指纹 `26b2c111106160657c6a1758b2e7a571184abf50033594720509e0d3344829d8`。
- 当前位置：[api-keys.test.ts:563](../../../../../src/models/server/db/api-keys.test.ts#L563)。
- 原保障与对应：输入场景和 Gemini 模型 ID 保留；B 要求平台 Google，当前要求组织 LLMTR（key/source/via 三字段均改）。这是已确认的组织适用凭证优先级变化，原跨付款方优先规则被有意替换；本项明确不判为与 B 等价。不能由单场景推断所有 provider 组合。
- 替换依据：C-02；model-configuration.md:3、49 明文规定适用组织 native/LLMTR/OpenRouter/fal → compatible 管理员绑定 → 平台回退。

B 原表达式：

```text
expect(await scope.resolveLlmKey('google/gemini-3.1-pro-preview')).toEqual({
      key: 'platform-google',
      source: 'platform',
      via: 'google',
    })
```

当前对应：

```text
expect(await scope.resolveLlmKey('google/gemini-3.1-pro-preview')).toEqual({
      key: 'llmtr-organization',
      source: 'organization',
      via: 'llmtr',
    })
```

## 新增 provider 持久化补证（不计入上述十二份原差异）

原 P2 的 generated-assets.test.ts 在 B→P2 没有净变化，因此不在这十二份差异或 inventory 的原断言变化分母中。现有 [generated-assets.test.ts:162](../../../../../src/models/server/db/generated-assets.test.ts#L162) 已真实回读 byteplus 完成标记；原失败用例没有传入/断言 provider。C-15 现在直接关联以下断言，不再借用 C-09 的 credential/session 测试：

- [generated-assets.test.ts:189](../../../../../src/models/server/db/generated-assets.test.ts#L189)：在原用例保留 status/error/outputs 断言的基础上，新增未传 provider 时仍为 fal 的回读保障。
- [generated-assets.test.ts:201](../../../../../src/models/server/db/generated-assets.test.ts#L201)：从 fal 行开始，经 markRunning/markCompleted，回读 compatible、completed、实际传入的 outputs 和已清 error。
- [generated-assets.test.ts:219](../../../../../src/models/server/db/generated-assets.test.ts#L219)：从 fal 行开始，经 markRunning/markFailed，回读 compatible、failed、原 error 和 null outputs。
- [generated-assets.test.ts:235](../../../../../src/models/server/db/generated-assets.test.ts#L235) 的既有跨组织拒绝用例保留；它直接覆盖 markFailed，本轮没有新增跨组织 markCompleted 场景。

这些用例使用同一文件已有的 createTestDb/真实迁移内存 D1 与 scoped-db，不 Mock DB 返回值；输出 URL 和错误是合成测试数据，没有供应商请求、文件上传或计费。已阅读 model-configuration.md、media-vias.md 及 image-channels.md 的相关契约，未改生产代码或领域架构文档。

**领域补证完成时未执行；主线整合阶段已统一运行，单独复跑 11 项全部通过：**

```text
bun run test src/models/server/db/generated-assets.test.ts
```

B→P2 的生产差异只是 MediaVia→ImageVia 类型扩展，原 UPDATE 已能保存调用方传入的 provider；不能要求这些运行时回读用例在 B 必须失败，也不能据其通过宣称已验证 TypeScript 静态约束、实际供应商身份、扣费或 Workflows 重启。当前运行状态见 [verification.json](verification.json)：初次 DB 初始化 hook 超时的 11 项不计通过，独立复跑后全部通过。

## 固定 blob 与复核方法

| 测试路径                                           | B blob                                     | inventory 冻结 HEAD2b blob（与 P2 相同）   |
| -------------------------------------------------- | ------------------------------------------ | ------------------------------------------ |
| `src/models/ai.recommend-styles.test.ts`           | `29006b1f2a39b67cf81e8d702ca15adc8d4ef136` | `b653f7002c66622faee9209723d9a63e164116dc` |
| `src/models/aspect-ratios.test.ts`                 | `874b6d1e797f9f3c3d769a662fd29fa3984f4d14` | `c0ad223d19ba8fb8939c8e41c3766d4ce0179311` |
| `src/models/enhance-duration.test.ts`              | `21dd21cfd42dac7904c5d931f3892fecc16b7406` | `4940aef8383db0d013a8c208a3b5bc3aa49c114c` |
| `src/models/generation-mode.test.ts`               | `1ccfa77206cafda21b542a2a21756be3e20e5213` | `8937d2f7eb449430204c2d2106f49b07918aa070` |
| `src/models/model-assets.fn.test.ts`               | `a8cc4383b61c694bfa5b6e170920cbb36dc9c033` | `8650cf39ac01cbaff6188c777de4f46cfcede425` |
| `src/models/models.test.ts`                        | `81efdb4758ff09bc27eae2438364864638004a78` | `fb553cb8ae095fea237cf51d8a5f1c70389eb529` |
| `src/models/resolve-asset-models.test.ts`          | `5d266e5bd047c9a108dbcf4a43313face53547c1` | `102ea4d510f7eea9947d6fb189fc83595378e110` |
| `src/models/server/db/api-keys.test.ts`            | `e231cc1db54977e6b079056cc5fcc7cd7f22d924` | `14a96ac6699ec818b4ef0d912e7094481246be12` |
| `src/models/server/elevenlabs-config.test.ts`      | `8428027e28721c13cd62310713a5e776037ad8a7` | `987427dec0e34b61cee7ee444f834f0bb50b6c93` |
| `src/models/server/response-schema-budget.test.ts` | `13853f9e9252f0d99f741eb18222e3e75c394f08` | `62873cb6b21bd52a047b128a4088c20c91e60116` |
| `src/models/ui/resolution-support.test.ts`         | `3eb823bcb0dce90248df5811ae1d6ce5ab79863f` | `5e93164f3fb4de587b65636971ec3ac4aa5ffe89` |
| `src/models/vision-model-routing.test.ts`          | `effea7055dd784e2b492ae1e66a8c82622b9e324` | `7083da359c5eb8b5b4b5d5f1ccdcc5340c6aee6b` |

读取方式为一次 git cat-file --batch，通过 stdin 传入上述 B/P2 的 commit:path，全部对象在内存解析；没有创建诊断临时文件。逐文件差异可用下列固定命令复核（替换为表中实际 path）：

```text
git --no-optional-locks -c gc.auto=0 diff 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0 2b41bbf33b75c66035dc0af08df6eea79e3de929 -- <path>
git --no-optional-locks -c gc.auto=0 cat-file --batch
```

这些是源码/表达式追溯命令，不是测试通过记录。2026-11-08 的 99 文件/1551 通过仍属历史归档；未随检出携带的 C 原始日志不在本轮重新证明，归档口径见 [P2 README](../README.md)。本轮没有真实模型/远程 DB、服务启动、提交或推送。十二份测试以外的所有 C/F-C 状态没有因本补证自动闭合。
