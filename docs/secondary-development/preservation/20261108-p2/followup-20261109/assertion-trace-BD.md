# BD 原断言追溯补充（2026-11-09）

本补充服务于 P2 审计文档修正。上游 B 固定为 `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`；当前表示冻结 HEAD `2b41bbf33b75c66035dc0af08df6eea79e3de929`，不表示任意时刻的工作区。原 P2 起点仍为 `ce321c885f67e40fec1c8598bb759790d89359c9`，未移动既有候选分母。

先前筛查了 72 份既有变更测试的文本差异，并详查上传权利、smart-retry、分场、冻结计划、update-stale 五组；本次按主线 [assertion-inventory.jsonl](assertion-inventory.jsonl) 中 `owner=BD && changedOriginalExpressions.length>0` 扩展至 **全部 20 个文件、43 个原变更表达式**。未读取其它 owner 的变更候选作语义结论。

43 项中，34 项为语言/显式模型适配，3 项为配置快照适配，3 项为次数/参数的等效或加强，3 项为有意契约/fixture 替换。smart-retry 的两条原表达式合并到同一条当前 ExactlyOnceWith，故当前唯一对应表达式为 42 条。两个精确对象 matcher 改为包含匹配的边界明确记在 BD-A13、BD-A14，未将其伪称为严格等价。

本轮未运行或新增测试，未修改生产代码。每节“归档记录”只引用既有 `../unit-verification.json` 的 `files[path]`（source=`BD-tests-result.json`），不是本轮或冻结 HEAD 的新执行证明。原通过数不替代断言、fixture、控制流和运行边界对照。

## 方法与可重建证据

每个文件列出 inventory 行、B/当前完整 blob；每条原表达式以“路径＋B 行号”唯一标识。表中表达式由实际 Git blob 的 AST 去掉排版和注释后输出，保留完整参数、matcher、字符串与正则，不使用省略号。B 原始文本还可直接从 inventory 的 expression 字段取回；下列行号均以冻结 Git 对象为准。

```powershell
git show 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0:<真实测试路径>
git show 2b41bbf33b75c66035dc0af08df6eea79e3de929:<真实测试路径>
git show <本节的完整blob>
git diff --no-ext-diff --unified=4 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0 2b41bbf33b75c66035dc0af08df6eea79e3de929 -- <真实测试路径>
```

主线 AST 清单覆盖 126 份既有测试、34 文件/78 个原变更表达式，统计方法及局限见 [assertion-inventory-summary.json](assertion-inventory-summary.json)。本补充只闭合其中的 BD 20/43；未由 expect 数量不下降推断行为不变。已对照下面的前置 fixture 和相邻保留断言；不宣称覆盖 72 份筛查文件的全部原断言、所有新增用例或 309 条路径的每个执行状态。

## 逐文件、逐表达式追溯

### BD-A01：上传描述

真实路径：[src/cast/server/describe-upload.test.ts](../../../../../src/cast/server/describe-upload.test.ts)；inventory 第 13 行。

B blob：`973df130b976e2401dc082b11d0086501fa76cb8`；当前 blob：`1865ed4bfbc44bb3480145d83c91dbd2e276b345`。

| 编号     | B 行与原表达式                                                                                                                                                       | 当前行与对应表达式                                                                        | 判定                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| BD-A01.1 | 28：`expect(describeUpload({scopedDb:scopedDbWithLedger([]),userId:'u',url,filename:'x.jpg',subject:'character'})).rejects.toBeInstanceOf(AttestationRequiredError)` | 124：`expect(describeImage(c.scopedDb)).rejects.toBeInstanceOf(AttestationRequiredError)` | 必要适配：提取 describeImage 包装并补英文语言；无声明时的 AttestationRequiredError 保留。 |

对照结论（必要适配：语言/显式模型）：B 的 scopedDbWithLedger([]) 对应当前 context([]).scopedDb；describeImage（54–68 行）仍传同一 userId/url/filename/subject，默认 subject=character、promptLocale=en。当前 124–128 行同时断言拒绝类型、零 LLM 调用和零配置读取，未将合规拒绝改成余额或模型错误。

运行边界：31–57 行 scoped-db/配置/凭证/余额为 stub；15–22 行 LLM 和媒体源转换为 Mock。无 createTestDb。 归档记录：passed，7 个用例；未重跑。

### BD-A02：元素上传绑定

真实路径：[src/cast/server/sequence-elements/attach-element-upload.test.ts](../../../../../src/cast/server/sequence-elements/attach-element-upload.test.ts)；inventory 第 14 行。

B blob：`d84fbffd0ff883db4ec33abb3814f902cdc4f7eb`；当前 blob：`66d6e2e5f4781e7bab0a90d9416bdd896512513f`。

| 编号     | B 行与原表达式                                                                                                                                                                                                                       | 当前行与对应表达式                                                                                                                                                                                                                                     | 判定                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| BD-A02.1 | 180：`expect(attachElementUpload({scopedDb:makeScopedDb(),organizationId:'organization-1',userId:'user-1',sequenceId:'seq-1',path:'elements/organization-1/seq-1/el-1.png',filename:'jersey.png'})).rejects.toThrow('binding down')` | 181：`expect(attachElementUpload({promptLocale:'en',scopedDb:makeScopedDb(),organizationId:'organization-1',userId:'user-1',sequenceId:'seq-1',path:'elements/organization-1/seq-1/el-1.png',filename:'jersey.png'})).rejects.toThrow('binding down')` | 必要适配：仅补 promptLocale=en；binding down 拒绝不变。 |

对照结论（必要适配：语言/显式模型）：保留工作流启动失败的原错误，不把失败视为成功；上传权利、存储存在性与元素行方法仍是原测试的替身。

运行边界：13–19 行 trigger/storage/rights 为 Mock；31–41 行 sequenceElements 为 scoped-db stub，无真实持久化。 归档记录：passed，13 个用例；未重跑。

### BD-A03：人才识别地区回退

真实路径：[src/cast/server/talent-vision-region-fallback.test.ts](../../../../../src/cast/server/talent-vision-region-fallback.test.ts)；inventory 第 16 行。

B blob：`610505a6515468357115d7ea2a08853d31a53738`；当前 blob：`19b810372314f5d97e9c8196c87c3970a0724d6b`。

| 编号     | B 行与原表达式                                                                                                                                                                                            | 当前行与对应表达式                                                                                                                                                                                                                                          | 判定                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| BD-A03.1 | 149：`expect(analyzeTalentMedia({imageUrls:IMAGES})).rejects.toThrow('402 Insufficient credits')`                                                                                                         | 159：`expect(analyzeTalentMedia({promptLocale:'en',model:TALENT_VISION_MODEL,imageUrls:IMAGES})).rejects.toThrow('402 Insufficient credits')`                                                                                                               | 补 en 和 TALENT_VISION_MODEL；402 Insufficient credits 及仅一次适配器调用的原约束不变。 |
| BD-A03.2 | 160：``expect(analyzeTalentClip({clip:{uri:'https://files.example/abc',mimeType:'video/mp4'},llmKey:{key:'k',via:'google',source:'platform'}})).rejects.toThrow(`answered on ${REGION_FALLBACK_MODEL}`)`` | 174：``expect(analyzeTalentClip({promptLocale:'en',model:'google/gemini-3.8-flash',clip:{uri:'https://files.example/abc',mimeType:'video/mp4'},llmKey:{key:'k',via:'google',source:'platform'}})).rejects.toThrow(`answered on ${REGION_FALLBACK_MODEL}`)`` | 补 en 和原生 google/gemini-3.8-flash；仍因回答落在 REGION_FALLBACK_MODEL 拒绝。         |

对照结论（必要适配：语言/显式模型）：图像地区回退、重解析凭证和实际回答模型的相邻断言仍在 103–154 行；视频拒绝仍在 171–181 行。显式模型把此前隐式默认值移到输入，并未授权任意跨渠道回退。

运行边界：30–85 行 env、媒体 URL、createAdapter 和 chat 流为 Mock；执行真实 helper/流处理，无供应商或 D1。 归档记录：passed，5 个用例；未重跑。

### BD-A04：人才视频原生凭证门禁

真实路径：[src/cast/server/talent/analyze-talent-media.test.ts](../../../../../src/cast/server/talent/analyze-talent-media.test.ts)；inventory 第 18 行。

B blob：`faf65a607e8ea6158584b012dc20fd4acd5a2421`；当前 blob：`0256db54f62dfb33b237f298dcd21c7db8c5de0e`。

| 编号     | B 行与原表达式                                                                                                                                                                                 | 当前行与对应表达式                                                                                                                                                                                               | 判定                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| BD-A04.1 | 32：`expect(analyzeTalentClipForOrganization({scopedDb,userId:'u',key:'talent/t/uploads/clip.mp4',mimeType:'video/mp4',idempotencyKey:'likeness:x'})).rejects.toBeInstanceOf(ValidationError)` | 39：`expect(analyzeTalentClipForOrganization({promptLocale:'en',scopedDb,userId:'u',key:'talent/t/uploads/clip.mp4',mimeType:'video/mp4',idempotencyKey:'likeness:x'})).rejects.toBeInstanceOf(ValidationError)` | 有意替换 fixture：非原生 resolveLlmKey 返回值 → 缺失 Google 专用凭证；保留上传前拒绝。 |

对照结论（有意替换：契约/fixture）：B 21–42 行通过 resolveLlmKey 返回 OpenRouter 凭证触发拒绝；当前 31–50 行改为 resolveOptionalKey 返回 undefined，并仍检查 ValidationError、零上传和零分析。源码 analyze-talent-media.ts:97–108 已专取 Google key，不再调用通用 LLM resolver，因此这是 API/fixture 契约适配，不能说两个前置条件字面相同。当前 135–161 行另验 resolveOptionalKey(google)、不调 resolveLlmKey、配置模型、清理和计费调用；这保留原生边界，不撤销安全拒绝。

运行边界：12–20 行 Gemini Files/人才模型调用为 Mock；32–37、68–82 行 scoped-db/余额/扣费为 stub，无 D1。 归档记录：passed，4 个用例；未重跑。

### BD-A05：上传权利（BD-ASSERT-UPLOAD-RIGHTS）

真实路径：[src/cast/server/upload-rights.test.ts](../../../../../src/cast/server/upload-rights.test.ts)；inventory 第 20 行。

B blob：`2c3295efd4f9c6777351b3004747f74d387c6eda`；当前 blob：`ec8c0b429c5cbcef40601f432cb79879dc8c9744`。

| 编号      | B 行与原表达式                                                                                                                  | 当前行与对应表达式                                                                                                                                | 判定                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| BD-A05.1  | 133：`expect(await classifyUpload({scopedDb,userId:USER_ID,url,request})).toEqual({status:'needs_portrait'})`                   | 135：`expect(await classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url,request})).toEqual({status:'needs_portrait'})`                   | 首次真人判定仍返回 needs_portrait。                         |
| BD-A05.2  | 142：`expect(await classifyUpload({scopedDb,userId:USER_ID,url,request})).toEqual({status:'needs_portrait'})`                   | 150：`expect(await classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url,request})).toEqual({status:'needs_portrait'})`                   | 重复真人判定仍返回 needs_portrait；相邻原一次分类约束保留。 |
| BD-A05.3  | 155：`expect(classifyUpload({scopedDb,userId:USER_ID,url,request})).rejects.toThrow('vision down')`                             | 169：`expect(classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url,request})).rejects.toThrow('vision down')`                             | 分类器故障仍抛 vision down；不记新账本行。                  |
| BD-A05.4  | 195：`expect(classifyUpload({scopedDb,userId:USER_ID,url:clip,request})).rejects.toThrow('not an upload of yours')`             | 216：`expect(classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url:clip,request})).rejects.toThrow('not an upload of yours')`             | 他组织 clip 仍拒绝 not an upload of yours。                 |
| BD-A05.5  | 208：`expect(classifyUpload({scopedDb,userId:USER_ID,url,request})).rejects.toThrow('not an upload of yours')`                  | 235：`expect(classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url,request})).rejects.toThrow('not an upload of yours')`                  | 逐个错误 owner URL 仍拒绝 not an upload of yours。          |
| BD-A05.6  | 219：`expect(classifyUpload({scopedDb,userId:USER_ID,url:clip,request})).rejects.toThrow('can’t be checked for a real person')` | 252：`expect(classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url:clip,request})).rejects.toThrow('can’t be checked for a real person')` | 外部 clip 仍拒绝 can’t be checked for a real person。       |
| BD-A05.7  | 246：`expect(await classifyUpload({scopedDb,userId:USER_ID,url,request})).toEqual({status:'signed'})`                           | 285：`expect(await classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url,request})).toEqual({status:'signed'})`                           | 用户补签仍返回 signed。                                     |
| BD-A05.8  | 277：`expect(await classifyUpload({scopedDb,userId:USER_ID,url,request})).toEqual({status:'signed'})`                           | 322：`expect(await classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url,request})).toEqual({status:'signed'})`                           | 重复已签声明仍返回 signed，无额外分类。                     |
| BD-A05.9  | 315：`expect(await classifyUpload({scopedDb,userId:USER_ID,url,request})).toEqual({status:'signed'})`                           | 366：`expect(await classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url,request})).toEqual({status:'signed'})`                           | 同秒签署/发现顺序仍返回 signed。                            |
| BD-A05.10 | 331：`expect(await classifyUpload({scopedDb,userId:USER_ID,url:cleared,request})).toEqual({status:'cleared'})`                  | 388：`expect(await classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url:cleared,request})).toEqual({status:'cleared'})`                  | 非真人 ledger 仍返回 cleared。                              |
| BD-A05.11 | 340：`expect(await classifyUpload({scopedDb,userId:USER_ID,url:signed,request})).toEqual({status:'needs_portrait'})`            | 398：`expect(await classifyUpload({promptLocale:'en',scopedDb,userId:USER_ID,url:signed,request})).toEqual({status:'needs_portrait'})`            | 真人 ledger 仍返回 needs_portrait。                         |

对照结论（必要适配：语言/显式模型）：11 行仅增加显式英文输入；每个 matcher、状态或错误文本均原样保留。相邻签署、归属、重复次数和 attestation ledger 约束也未移除；未以本组通过数推断真实分类模型有效。

运行边界：16、38、66–67 行为真实 createTestDb 和 #db-client 本地 D1 替换；39–41 行图像/clip 分类器为 Mock。此组有隔离持久化，无真实供应商或远程 D1。 归档记录：passed，15 个用例；未重跑。

### BD-A06：角色声音入队

真实路径：[src/cast/server/voice/enqueue-character-voice.test.ts](../../../../../src/cast/server/voice/enqueue-character-voice.test.ts)；inventory 第 21 行。

B blob：`55b9eba54f46d7deb62d1fb7d89e9329aafd8ef2`；当前 blob：`aa8eb07f6fe7349dc6949e613ad6f4864d6da225`。

| 编号     | B 行与原表达式                                                                                                                                                                                                                                         | 当前行与对应表达式                                                                                                                                                                                                                                                       | 判定                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| BD-A06.1 | 172：`expect(enqueueCharacterVoiceDesign({scopedDb,character:character(),sequenceId:'seq-1',userId:'user-1',analysisModel:null,takes:2,trigger:async()=>{throw new Error('workflow binding missing');}})).rejects.toThrow('workflow binding missing')` | 175：`expect(enqueueCharacterVoiceDesign({promptLocale:'en',scopedDb,character:character(),sequenceId:'seq-1',userId:'user-1',analysisModel:null,takes:2,trigger:async()=>{throw new Error('workflow binding missing');}})).rejects.toThrow('workflow binding missing')` | 必要适配：仅补 promptLocale=en；workflow binding missing 拒绝保留。 |

对照结论（必要适配：语言/显式模型）：当前 172–194 行继续在 trigger 抛错后检查 claim 标为 failed（含原错误）且不写入成功 workflowRunId；新增语言不改变失败清理职责。

运行边界：62–95 行 voice claim 方法为 Mock/stub；trigger 为函数替身，无 provider 或 D1。 归档记录：passed，7 个用例；未重跑。

### BD-A07：自动风格步骤

真实路径：[src/look/server/workflows/auto-style-step.test.ts](../../../../../src/look/server/workflows/auto-style-step.test.ts)；inventory 第 29 行。

B blob：`9f6b4a09b52c3724e63a824f14884eceb7fbf0d0`；当前 blob：`3e8193916840efbdb454c39a12797e72c8fc70ef`。

| 编号     | B 行与原表达式                                                                                              | 当前行与对应表达式                                                                                                                    | 判定                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| BD-A07.1 | 151：`expect(deriveAutoStyle(step,{scopedDb,...PARAMS})).rejects.toThrow(/invalid option\|unsalvageable/i)` | 211：`expect(deriveAutoStyle(step,{promptLocale:'en'as const,scopedDb,...PARAMS})).rejects.toThrow(/invalid option\|unsalvageable/i)` | 保留非法枚举解析拒绝 /invalid option\|unsalvageable/i 以及零写入/零 emit。 |
| BD-A07.2 | 163：`expect(deriveAutoStyle(step,{scopedDb,...PARAMS})).rejects.toThrow(/no longer bound/)`                | 227：`expect(deriveAutoStyle(step,{promptLocale:'en'as const,scopedDb,...PARAMS})).rejects.toThrow(/no longer bound/)`                | 保留已解绑行拒绝 /no longer bound/，不继续 snapshot 或 emit。              |
| BD-A07.3 | 190：`expect(deriveAutoStyle(step,{scopedDb,...PARAMS})).rejects.toThrow(/unsalvageable/)`                  | 262：`expect(deriveAutoStyle(step,{promptLocale:'en'as const,scopedDb,...PARAMS})).rejects.toThrow(/unsalvageable/)`                  | 保留不可挽回答拒绝 /unsalvageable/，不写入或 emit。                        |

对照结论（必要适配：语言/显式模型）：211–270 行原失败保护仍在。新增 146–198 行双语默认 recipe 检查是独立补充，未拿中文默认值覆盖原非法值/解绑/空色板拒绝。

运行边界：14–26 行 durable LLM、realtime 与 step 为 Mock/stub；47–55 行写方法为 stub。响应 schema 在替身中真实 parse，无 D1/Workflows replay。 归档记录：passed，8 个用例；未重跑。

### BD-A08：草稿高质量重渲染

真实路径：[src/motion/server/render-at-quality.test.ts](../../../../../src/motion/server/render-at-quality.test.ts)；inventory 第 51 行。

B blob：`119c84b16a650bc51b88c3daa8ec08d793d55da8`；当前 blob：`bd19a055029efe40d38f779aaf7283fa4dee3744`。

| 编号     | B 行与原表达式                                                                                                                                       | 当前行与对应表达式                                                                                                                                                     | 判定                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| BD-A08.1 | 131：`expect(renderDraftAtQuality({scopedDb,userId:'u1',sequence,version:draft,sceneId:'scene-1'})).rejects.toThrow(ALREADY_RENDERING)`              | 131：`expect(renderDraftAtQuality({promptLocale:'en',scopedDb,userId:'u1',sequence,version:draft,sceneId:'scene-1'})).rejects.toThrow(ALREADY_RENDERING)`              | 仍在预占前拒绝 ALREADY_RENDERING。                              |
| BD-A08.2 | 238：`expect(renderDraftAtQuality({scopedDb,userId:'u1',sequence,version:draft,sceneId:'scene-1'})).rejects.toThrow(/Couldn't read the draft clip/)` | 241：`expect(renderDraftAtQuality({promptLocale:'en',scopedDb,userId:'u1',sequence,version:draft,sceneId:'scene-1'})).rejects.toThrow(/Couldn't read the draft clip/)` | 仍拒绝 /Couldn't read the draft clip/，并在相邻断言中禁止预占。 |
| BD-A08.3 | 275：`expect(renderDraftAtQuality({scopedDb,userId:'u1',sequence,version:draft,sceneId:'scene-1'})).rejects.toThrow('binding down')`                 | 280：`expect(renderDraftAtQuality({promptLocale:'en',scopedDb,userId:'u1',sequence,version:draft,sceneId:'scene-1'})).rejects.toThrow('binding down')`                 | 仍抛 binding down，原 zeroReservation 释放检查保留。            |

对照结论（必要适配：语言/显式模型）：源表达式表保留正则原始 ASCII 文本。测试中的已在渲染、无法读取草稿和启动失败均保持原分支；报价函数用合成 TEST_FAL_PRICING，未变成真实供应商价卡。

运行边界：15–35 行 reserve/trigger/时长读取为 Mock；81–92 行 billing.zeroReservation 为 stub，无真实 D1 预占释放。 归档记录：passed，7 个用例；未重跑。

### BD-A09：配乐输入构造

真实路径：[src/sequences/sequences.fn.test.ts](../../../../../src/sequences/sequences.fn.test.ts)；inventory 第 75 行。

B blob：`79b4c291df0a17e0165285d824fa927064a3ecbc`；当前 blob：`f9860520552c0ab355718c68595527b90ee967e6`。

| 编号     | B 行与原表达式                                                                                                                                                               | 当前行与对应表达式                                                                                                                                                                             | 判定                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| BD-A09.1 | 261：`expect(input).toEqual({userId:'u1',organizationId:'t1',sequenceId:'seq-1',prompt:'epic score',tags:'cinematic',duration:42,model:'elevenlabs_music',isPrimary:false})` | 266：`expect(input).toEqual({promptLocale:'en',userId:'u1',organizationId:'t1',sequenceId:'seq-1',prompt:'epic score',tags:'cinematic',duration:42,model:'elevenlabs_music',isPrimary:false})` | 必要适配：精确输入对象增加 promptLocale=en；原全部字段及 isPrimary=false 保留。 |

对照结论（必要适配：语言/显式模型）：238–279 行纯 buildAddAudioMusicInput fixture 同步带语言；user/org/sequence、epic score、cinematic、42、elevenlabs_music 与非主轨约束均不变。

运行边界：纯决策函数与合成 shot/sequence 数据；不执行 server-fn 鉴权、中间件、D1 或真实音乐生成。 归档记录：passed，21 个用例；未重跑。

### BD-A10：导出异剪辑忙碌拒绝

真实路径：[src/sequences/server/export.test.ts](../../../../../src/sequences/server/export.test.ts)；inventory 第 78 行。

B blob：`ffa1efa45bccd9bb258bc6e9b5d379380a22f3cc`；当前 blob：`e613f63a18bb839c7c998c60c7c45618ef1f0c73`。

| 编号     | B 行与原表达式                                                                                                                                                                                       | 当前行与对应表达式                                                                                                                                                                                                             | 判定                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| BD-A10.1 | 165：`expect(startExport(scoped(),{userId:generateId(),organizationId,sequenceId,cut:await resolveExportCut(scoped(),sequenceId),refuseOtherCut:true})).rejects.toMatchObject({code:'EXPORT_BUSY'})` | 167：`expect(startExport(scoped(),{promptLocale:'en'as const,userId:generateId(),organizationId,sequenceId,cut:await resolveExportCut(scoped(),sequenceId),refuseOtherCut:true})).rejects.toMatchObject({code:'EXPORT_BUSY'})` | 必要适配：仅补 promptLocale=en；异剪辑 EXPORT_BUSY 拒绝保留。 |

对照结论（必要适配：语言/显式模型）：149–177 行仍先合并相同剪辑的进行中任务，再真实更新 videoVariants.url 形成不同 cut，检查 EXPORT_BUSY 且 trigger 总计一次。

运行边界：8、49–51、110 行为真实隔离 createTestDb/scopedDb；37–38 行工作流 trigger 为 Mock。验证导出行/剪辑查询，未启动渲染容器。 归档记录：passed，5 个用例；未重跑。

### BD-A11：冻结新生成计划（BD-ASSERT-FREEZE-PLAN）

真实路径：[src/sequences/server/freeze-fresh-generation-plan.test.ts](../../../../../src/sequences/server/freeze-fresh-generation-plan.test.ts)；inventory 第 79 行。

B blob：`2199ec4aeb9bf668ba89d354f57a0034ba081ede`；当前 blob：`cfab3528b11c5469356e49c9da85296e2d1e702f`。

| 编号     | B 行与原表达式                                                                                                                                                                                                                                                                                                                                                                                                                                    | 当前行与对应表达式                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 判定                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| BD-A11.1 | 96：`expect(computePlan).toHaveBeenLastCalledWith(expect.objectContaining({units:[expect.objectContaining({kind:'sheet:character',id:'cast'})],sequenceOverrides:expect.objectContaining({status:'completed',generateStartFrames:false,generateVoices:true,includeMusic:false,styleConfig,analysisModel:input.analysisModelId}),renderOptions:expect.objectContaining({imageModels:['nano_banana_2'],videoModels:['grok_imagine_video_1_5']})}))` | 197：`expect(computePlan).toHaveBeenLastCalledWith(expect.objectContaining({promptLocale:'zh-CN',units:[expect.objectContaining({kind:'sheet:character',id:'cast'})],sequenceOverrides:expect.objectContaining({status:'completed',generateStartFrames:false,generateVoices:true,includeMusic:false,styleConfig,analysisModel:input.analysisModelId}),renderOptions:expect.objectContaining({imageModels:['nano_banana_2'],videoModels:['grok_imagine_video_1_5']})}))` | 必要适配：预期 computePlan 参数增加 promptLocale=zh-CN；原工作、开关、风格和模型约束保留。 |

对照结论（必要适配：语言/显式模型）：B 82–125 对应当前 183–227：computeGenerationPlan 仍获 ignoreOwnProcessing/styleConfig/analysisModel；computePlan 仍要求唯一 sheet:character/cast、completed、三项开关、原 imageModels/videoModels。pending auto-style 排除旧 styleConfig 的相邻例外仍在。新增合成渠道价卡不能充当真实持久化证明。

运行边界：规划器、shots 读取和 fal pricing 为 Mock/stub；配置价卡配合真实纯计价函数，无 createTestDb。 归档记录：passed，7 个用例；未重跑。

### BD-A12：生成操作的重试计划

真实路径：[src/sequences/server/generation-operations.test.ts](../../../../../src/sequences/server/generation-operations.test.ts)；inventory 第 81 行。

B blob：`1b36abea0217ac7e7a37f5b3279b6c0a224ad931`；当前 blob：`f11093540a06bfaef5e6268ab1621b67b35ea64b`。

| 编号     | B 行与原表达式                                                                                            | 当前行与对应表达式                                                                                                                              | 判定                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| BD-A12.1 | 605：`expect(executeSmartRetry).toHaveBeenLastCalledWith(expect.anything(),{dryRun:true,smartOnly:true})` | 632：`expect(executeSmartRetry).toHaveBeenLastCalledWith(expect.anything(),{dryRun:true,smartOnly:true,modelConfiguration:expect.any(Object)})` | 必要适配：精确 dryRun/smartOnly 参数增加 modelConfiguration；两原开关保留。 |

对照结论（必要适配：运行配置快照）：632–646 行检查 dryRun=true、smartOnly=true、对象快照及原估价/余额参数；667–672 行新增身份相等断言，要求启动使用最新 preview 的同一配置对象。prepareContinue（94–122 行）是 fixture：模拟 planner 返回 plan/modelConfiguration，不可据此宣称真实 Continue 的 llmSources 缺口已修复。

运行边界：10、191–193、258 行为真实 createTestDb/scopedDb 组织数据；规划、报价、requireCredits、launchers 和 executeSmartRetry 为 Mock。这里验证计划/执行适配，非真实钱包或 Continue 计费。 归档记录：passed，19 个用例；未重跑。

### BD-A13：故事板启动器选项

真实路径：[src/sequences/server/launchers.test.ts](../../../../../src/sequences/server/launchers.test.ts)；inventory 第 82 行。

B blob：`baff81a5aad0492acc6de128c90318fc22fd81e9`；当前 blob：`027fd1032557e3cd7631713035da095ba2ef151b`。

| 编号     | B 行与原表达式                                                                                                                  | 当前行与对应表达式                                                                                                                                       | 判定                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| BD-A13.1 | 227：`expect(triggerWorkflowMock).toHaveBeenCalledWith('/storyboard',expect.objectContaining(INPUT),{deduplicationId:claimId})` | 256：`expect(triggerWorkflowMock).toHaveBeenCalledWith('/storyboard',expect.objectContaining(INPUT),expect.objectContaining({deduplicationId:claimId}))` | 有意放宽选项对象精确性：{deduplicationId} → objectContaining；去重值保留。 |

对照结论（有意替换：契约/fixture）：原精确对象禁止额外选项的约束被有意替换，以容纳 modelConfiguration；源码 launchers.ts:384–387 实际传两个字段。当前 248–267 行仍校验 claim、processing、deduplicationId 和新 run 写回；675–685 行另验完整路由配置，718–723 行验复用调用方配置且不再读取路由。不能称 matcher 严格度完全不变；这是已确认模型运行快照契约所需的替换，并非删除去重要求。

运行边界：工作流触发/run-state 为 Mock，93–170 行 scoped-db 为 stub；无 D1 并发锁或真实 Workflows 启动。 归档记录：passed，36 个用例；未重跑。

### BD-A14：风格来源返回配置

真实路径：[src/sequences/server/resolve-style-source.test.ts](../../../../../src/sequences/server/resolve-style-source.test.ts)；inventory 第 85 行。

B blob：`feef5c291127fe0b6e65915d0fbcb8190483518b`；当前 blob：`ba84bb1f99539eb2ddc6418c3eedbd633282070a`。

| 编号     | B 行与原表达式                                                                        | 当前行与对应表达式                                                                          | 判定                                                                                  |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| BD-A14.1 | 108：`expect(resolveStyleSource(scoped(),row.id)).resolves.toEqual({kind:'library'})` | 123：`expect(resolveStyleSource(scoped(),row.id)).resolves.toMatchObject({kind:'library'})` | 有意放宽返回对象精确性：toEqual → toMatchObject；library 分支保留并新增 config 契约。 |

对照结论（有意替换：契约/fixture）：B 108–110 只允许 {kind:library}；当前 123–125 为包含匹配。源码 create-sequences.ts:76–104 让 library 返回本次语言的 config，故原“无其他字段”限制有意退役。128–176 行补验中英配置、默认英文、用户同名风格不变、共享 row 不被写回及编辑字段保留；188–205 行保留 clone 的历史快照。不是凭 expect 总数推导等价。

运行边界：7、35–37、59–63 行使用真实 createTestDb 及真实组织 scoped-db 方法，无供应商调用。模板本地化及风格历史读写在隔离 D1 上发生。 归档记录：passed，10 个用例；未重跑。

### BD-A15：分场提示词（BD-ASSERT-SCENE-SPLIT）

真实路径：[src/sequences/server/workflows/scene-split-workflow.test.ts](../../../../../src/sequences/server/workflows/scene-split-workflow.test.ts)；inventory 第 89 行。

B blob：`84478e5e1af02193c21c3b1abdfe55845a95d41f`；当前 blob：`912e6f386a04a0c342bf10bdddcba13214f79416`。

| 编号     | B 行与原表达式                                                                                                                                                                                      | 当前行与对应表达式                                                                                                                                                                                       | 判定                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| BD-A15.1 | 536：`expect(getChatPrompt).toHaveBeenCalledWith('phase/scene-bibles-chat',expect.objectContaining({userCountry:userCountry??''}))`                                                                 | 580：`expect(getChatPrompt).toHaveBeenCalledWith('phase/scene-bibles-chat',expect.objectContaining({userCountry:userCountry??''}),'en')`                                                                 | 保留 scene-bibles-chat 与 userCountry??空串。                |
| BD-A15.2 | 548：`expect(getChatPrompt).toHaveBeenCalledWith('phase/scene-bibles-chat',expect.objectContaining({cast:''}))`                                                                                     | 593：`expect(getChatPrompt).toHaveBeenCalledWith('phase/scene-bibles-chat',expect.objectContaining({cast:''}),'en')`                                                                                     | 保留 scene-bibles-chat 与 cast 空串。                        |
| BD-A15.3 | 591：`expect(getChatPrompt).toHaveBeenCalledWith('phase/scene-bibles-chat',expect.objectContaining({cast:expect.stringContaining('- char_ada: Ada — 30s, woman, tall. Looks: "Default" (coat)')}))` | 637：`expect(getChatPrompt).toHaveBeenCalledWith('phase/scene-bibles-chat',expect.objectContaining({cast:expect.stringContaining('- char_ada: Ada — 30s, woman, tall. Looks: "Default" (coat)')}),'en')` | 保留 Ada、30s、woman、tall、Default look/coat 的 CAST 文本。 |
| BD-A15.4 | 796：`expect(vi.mocked(getChatPrompt)).toHaveBeenCalledWith('phase/scene-shot-list-chat',expect.objectContaining({characters:'(none)'}))`                                                           | 843：`expect(vi.mocked(getChatPrompt)).toHaveBeenCalledWith('phase/scene-shot-list-chat',expect.objectContaining({characters:'(none)'}),'en')`                                                           | 保留 scene-shot-list-chat 与 characters=(none)。             |

对照结论（必要适配：语言/显式模型）：四个 matcher 的原 prompt 名和变量检查逐项保留。显式语言属于系统指令资源接口适配，不翻译脚本/对白或改变 cast 条件。

运行边界：37–52、90 行 trigger/prompt/realtime/deduction/LLM 为 Mock；239–317 行 scoped-db stub，335–344 行 step stub。无真实 D1/供应商/持久回放。 归档记录：passed，36 个用例；未重跑。

### BD-A16：完整重试次数与来源（BD-ASSERT-SMART-RETRY）

真实路径：[src/sequences/smart-retry.test.ts](../../../../../src/sequences/smart-retry.test.ts)；inventory 第 91 行。

B blob：`82128cd41572a1d6784d76c66cfc1208ec626614`；当前 blob：`9feb3c6a8474bd1f68ce2a5ff7451b7a9297aee3`。

| 编号     | B 行与原表达式                                                                                                                                                | 当前行与对应表达式                                                                                                                                                                                                                                 | 判定                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| BD-A16.1 | 589：`expect(triggerStoryboardMock).toHaveBeenCalledTimes(1)`                                                                                                 | 628：`expect(triggerStoryboardMock).toHaveBeenCalledExactlyOnceWith(scopedDb,expect.objectContaining({sequenceId:'seq_1',organizationId:'t1',reservationId:undefined}),{...DEFAULT_MODEL_CONFIGURATION,textModelRouting:[],imageModelRouting:[]})` | 加强合并：调用一次与原参数匹配同收敛为 ExactlyOnceWith，并检查配置快照。             |
| BD-A16.2 | 590：`expect(reserveRunCreditsMock).toHaveBeenCalledTimes(1)`                                                                                                 | 641：`expect(reserveRunCreditsMock).toHaveBeenCalledOnce()`                                                                                                                                                                                        | 等效：CalledTimes(1) → CalledOnce，预占调用次数仍为一次。                            |
| BD-A16.3 | 591：`expect(triggerStoryboardMock).toHaveBeenCalledWith(scopedDb,expect.objectContaining({sequenceId:'seq_1',organizationId:'t1',reservationId:undefined}))` | 628：`expect(triggerStoryboardMock).toHaveBeenCalledExactlyOnceWith(scopedDb,expect.objectContaining({sequenceId:'seq_1',organizationId:'t1',reservationId:undefined}),{...DEFAULT_MODEL_CONFIGURATION,textModelRouting:[],imageModelRouting:[]})` | 加强合并：原参数全部保留，新增完整默认模型和路由；与上一次数断言映到同一当前表达式。 |

对照结论（保留/加强：次数和参数）：B 581–606 扩为当前 599–649 的 organization/platform helper 参数化用例。628–640 的 ExactlyOnceWith 合并 B 589 和 591；641 的 CalledOnce 等价 B 590；642–647 仍禁止直接 workflow trigger/status 并检查 full 结果。619–625 新增平台 helper 余额不足拒绝，同时保留组织 helper 成功。此完整重试证据不外推到暂缓的 Continue 门禁。

运行边界：74、608 行载入真实 reserveRunCredits；keys/billing/reservation/launcher 为 Mock（如 402、410–411 行），无 createTestDb。 归档记录：passed，27 个用例；未重跑。

### BD-A17：静帧准备输入

真实路径：[src/shots/server/shot-image-input.test.ts](../../../../../src/shots/server/shot-image-input.test.ts)；inventory 第 98 行。

B blob：`c150f0eb6e97bfc3ae59ce5fa0ae8abeedeb2cd4`；当前 blob：`00d3899ff8e2f2b575919757744443aedc1835cd`。

| 编号     | B 行与原表达式                                                                                                                                                                                              | 当前行与对应表达式                                                                                                                                                                                                                    | 判定                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| BD-A17.1 | 215：`expect(prepareShotImageWorkflowInput({...baseArgs(scopedDb),promptOverride:'   ',promptVersionOverride:'fpv_from_caller',modelOverride:'nano_banana_pro'})).rejects.toThrow(NO_STILL_PROMPT_MESSAGE)` | 236：`expect(prepareShotImageWorkflowInput({promptLocale:'en'as const,...baseArgs(scopedDb),promptOverride:'   ',promptVersionOverride:'fpv_from_caller',modelOverride:'nano_banana_pro'})).rejects.toThrow(NO_STILL_PROMPT_MESSAGE)` | 空白 promptOverride 仍在余额检查前拒绝。                        |
| BD-A17.2 | 293：`expect(prepareShotImageWorkflowInput({...baseArgs(scopedDb),scene,scriptExtract:scene.originalScript.extract,deriveMissingPrompt:false})).rejects.toThrow(NO_STILL_PROMPT_MESSAGE)`                   | 489：`expect(prepareShotImageWorkflowInput({...baseArgs(scopedDb),promptLocale:'en',scene,scriptExtract:scene.originalScript.extract,deriveMissingPrompt:false})).rejects.toThrow(NO_STILL_PROMPT_MESSAGE)`                           | deriveMissingPrompt=false 仍拒绝，工作流不实时读 spec pointer。 |
| BD-A17.3 | 306：`expect(prepareShotImageWorkflowInput({...baseArgs(scopedDb),scene,scriptExtract:scene.originalScript.extract})).rejects.toThrow(NO_STILL_PROMPT_MESSAGE)`                                             | 503：`expect(prepareShotImageWorkflowInput({...baseArgs(scopedDb),promptLocale:'en',scene,scriptExtract:scene.originalScript.extract})).rejects.toThrow(NO_STILL_PROMPT_MESSAGE)`                                                     | 缺少已选 spec 仍拒绝，不用脚本替代静帧提示。                    |

对照结论（必要适配：语言/显式模型）：236–247、489–511 行保留原错误和无额外读/扣费约束。465–485 行把原成功例扩为 en/zh-CN，仍要求含 MARA leans over the dough 且不含对白 LINE。新增快照报价用例使用 synthetic imageConfigurationFixture；不把此处 Mock 的 requireCredits 写成真实钱包证明。

运行边界：29–44 行 price/preflight/配置加载为 Mock，scoped-db 为 stub；无 createTestDb。 归档记录：passed，18 个用例；未重跑。

### BD-A18：静帧预览触发

真实路径：[src/shots/server/shot-preview.test.ts](../../../../../src/shots/server/shot-preview.test.ts)；inventory 第 99 行。

B blob：`76ef5e2191143bce1b77f5819f0446ada4b0b84a`；当前 blob：`24817ed02080cede4a731c5375b3ae2e120e0bd3`。

| 编号     | B 行与原表达式                                                                                                                                                                                                         | 当前行与对应表达式                                                                                                                                                                                                                                            | 判定                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| BD-A18.1 | 53：`expect(mocks.trigger).toHaveBeenCalledWith('/image',expect.objectContaining({prompt:buildPreviewPrompt(MOTION,[]),model:SHOT_PREVIEW_IMAGE_MODEL,shotId:'shot-1',frameId:'frame-1',skipStorage:true}),undefined)` | 77：`expect(mocks.trigger).toHaveBeenCalledWith('/image',expect.objectContaining({prompt:buildPreviewPrompt(MOTION,[]),model:SHOT_PREVIEW_IMAGE_MODEL,shotId:'shot-1',frameId:'frame-1',skipStorage:true}),{modelConfiguration:DEFAULT_MODEL_CONFIGURATION})` | 必要契约适配：第三实参 undefined → 精确默认模型配置；原图像载荷字段保留。 |

对照结论（必要适配：运行配置快照）：77–87 行仍检查 buildPreviewPrompt(MOTION,[])、SHOT_PREVIEW_IMAGE_MODEL、shot/frame 和 skipStorage=true。选项从无配置变为必须携带默认快照，是模型配置接口变化，非丢弃载荷保障。129–155 行验报价与触发同一配置；159–187、260–289 行验工作流继承父快照且不读更新配置。

运行边界：12–26 行配置、trigger、价源为 Mock；context scoped-db 和 liveRead 为 stub。estimateImageCost 使用真实函数/spy，但无 D1 或真实生成。 归档记录：passed，10 个用例；未重跑。

### BD-A19：更新任务通知

真实路径：[src/shots/server/update-stale-run.test.ts](../../../../../src/shots/server/update-stale-run.test.ts)；inventory 第 104 行。

B blob：`a494205a4480a648e9096c2c7e00845857611990`；当前 blob：`46bb87c16e787f97bfb007a46a6403eff802ba93`。

| 编号     | B 行与原表达式                                                                                                                                               | 当前行与对应表达式                                                                                                                                                                     | 判定                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| BD-A19.1 | 37：``expect(launchUpdateStale({userId:'u',organizationId:'t',sequenceId,plan:asStub<UpdateStalePlan>({}),runKey:`${sequenceId}-1`})).resolves.toBe(runId)`` | 37：``expect(launchUpdateStale({promptLocale:'en'as const,userId:'u',organizationId:'t',sequenceId,plan:asStub<UpdateStalePlan>({}),runKey:`${sequenceId}-1`})).resolves.toBe(runId)`` | 保留入队后返回 runId 及相邻 sequence-channel emit 断言。          |
| BD-A19.2 | 54：``expect(launchUpdateStale({userId:'u',organizationId:'t',sequenceId,plan:asStub<UpdateStalePlan>({}),runKey:`${sequenceId}-1`})).resolves.toBe(runId)`` | 55：``expect(launchUpdateStale({promptLocale:'en'as const,userId:'u',organizationId:'t',sequenceId,plan:asStub<UpdateStalePlan>({}),runKey:`${sequenceId}-1`})).resolves.toBe(runId)`` | 保留 announce 抛 DO down 仍返回 runId；不让通知故障抹掉成功入队。 |

对照结论（必要适配：语言/显式模型）：37–64 行两个 resolves.toBe(runId) 与原 runKey/plan/id 保留；事件与运行状态查询为替身。

运行边界：5–17 行 trigger/realtime/history/run-outcome 为 Mock；合成 UpdateStalePlan，无 D1/DO 或真实 Workflows。 归档记录：passed，4 个用例；未重跑。

### BD-A20：更新计划生成引用覆盖（BD-ASSERT-UPDATE-STALE）

真实路径：[src/shots/server/workflows/update-stale-plan-run.test.ts](../../../../../src/shots/server/workflows/update-stale-plan-run.test.ts)；inventory 第 106 行。

B blob：`e69c1655cb08bf83f43a19ba9d44855e13c4ed7a`；当前 blob：`fc7a3f0b5ecb51a4b2aa9ef9f8c41e47868b8e29`。

| 编号     | B 行与原表达式                                                                                                                                                                                                                                                                                                                                                                                      | 当前行与对应表达式                                                                                                                                                                                                                                                                                                                                                                                                                    | 判定                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| BD-A20.1 | 1166：`expect(prepareShotImageWorkflowInput).toHaveBeenCalledWith(expect.objectContaining({refs:expect.objectContaining({characters:[expect.objectContaining({id:'maya',sheetImageUrl:'https://x/new-maya.png',selectedSheetVersionId:'new-maya-version'})],locations:[expect.objectContaining({id:'hall',referenceImageUrl:'https://x/new-hall.png',selectedReferenceVersionId:'lrv-hall'})]})}))` | 1181：`expect(prepareShotImageWorkflowInput).toHaveBeenCalledWith(expect.objectContaining({modelConfiguration:workflowModels,refs:expect.objectContaining({characters:[expect.objectContaining({id:'maya',sheetImageUrl:'https://x/new-maya.png',selectedSheetVersionId:'new-maya-version'})],locations:[expect.objectContaining({id:'hall',referenceImageUrl:'https://x/new-hall.png',selectedReferenceVersionId:'lrv-hall'})]})}))` | 必要适配：modelConfiguration=workflowModels 加入预期；全部原引用版本与URL保留。 |

对照结论（必要适配：运行配置快照）：B 1122–1186 对应当前 1137–1202；failures=[] 仍在 1180，1181–1201 保留 Maya/new-maya.png/new-maya-version 和 hall/new-hall.png/lrv-hall。新增配置要求准备 still 沿用本次模型/路由；referenceImages 提取常量后 imageReferenceCount 用相同列表长度，不把实时指针读取当成等价实现。

运行边界：36–42、72–89、143–145 行 claim/preflight/prepare/spawn 为 Mock；183–190 行 scoped-db stub。验证引用传播，非 SQL 晋升或真实预占捕获。 归档记录：passed，25 个用例；未重跑。

## 已闭合事项与未覆范围

清单限定的 20 个 BD 文件、43 个原变更表达式已全部列出原→当前对应，未发现无法追踪的删除。三处有意替换分别是 Google 专用凭证 fixture（BD-A04）、launcher 选项包含匹配（BD-A13）和风格 library 返回配置（BD-A14）；后两处原“不得有额外字段”的精确性约束确实退出，以已实现的模型快照/本地化配置契约及配套断言替代。其余所列业务返回值、拒绝、参数/次数约束均保留或增加，结论不外推为全部业务不变量的证明。

隔离 D1 边界出现在 BD-A05（上传权利）、BD-A10（导出）、BD-A12（生成操作）和 BD-A14（风格）；BD-A12 的 planner/计费/启动器仍是 Mock，不能因数据库真实就把整条业务链写成真实计费。其它节是纯逻辑或运行边界替身；全部都不证明供应商效果/账单、远程 D1、Cloudflare Workflows 重启与生产 isolate 内存。

72 份差异筛查之外的逐断言语义、AST 未改变表达式的 fixture/可达性变化、其余新增测试，以及完整 309 路径的所有状态未在本补充全证。若后续提出新具体反例，最小动作是沿此处的路径、blob、B/当前行定位补证；本轮没有扩展测试套件。

Continue 来源门禁见 [CONTINUE-LLM-SOURCE](deferred-decisions.json#CONTINUE-LLM-SOURCE)：用户于 2026-11-09 决定暂缓，待禁止用户 BYOK 时统一处理；未修复、不计为已修复项、本轮不阻断。当前组织无可用 fal Key 的用户给定前提不进入已复现的组织 Key 豁免分支；遗留可用组织 Key 仍是条件。本补充未查询组织密钥，也不声称 BYOK 已禁止。
