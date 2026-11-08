# 2026-11-07 上游更新逐提交合入评估

状态：评估完成，尚未合入。本文不替代合入后的类型、测试、构建或浏览器验收，也不更新已合入基线。

2026-11-08 新增的两项上游提交另见 [补充评估](upstream-merge-assessment-20261108.md)；本文保留截至 `d2e36d736` 的原始评估范围和结论。

## 1. 固定范围与结论

- 本轮二开快照：`develop` = `92986ba7a0004434a4732a418cf56e7bf026420b`。
- 已合入上游基线：`003e2df7c4986fc236ea9a1c67c3f18089874d48`，对应二开合入提交 `3b203b3b6`。
- 本轮重新 fetch 后的上游终点：`d2e36d736b6ea0b0ae2998af3296c875b7773e44`。
- 新增 14 个主线节点，展开支线历史共 34 个提交；上游净差异为 142 文件、9382 行新增、3893 行删除。
- 工作开始时工作区干净。评估期间按用户明确要求修订四份业务文档，取消管理员默认不浏览作品的规划；此更正不是上游代码合入。
- 结束前 `develop` 与 `origin/develop` 均为 `92986ba7a`。开始时观察到的 ahead 4 已不再适用，本轮未提交或推送。

建议保留这 14 项上游更新，按主线顺序逐个合入、逐项验证。模型、语言上下文、即时报价与配置图片计划需要人工适配；不把“自动合并成功”当作语义兼容证据。没有发现本次新增数据库迁移、schema 或 `wrangler.jsonc` 差异，不要求迁移或改造钱包。

用户于本轮明确取消“管理员默认不浏览用户作品”的二开规划。管理员作品访问沿用实际合入的上游权限机制，`62471ecc9` 不再因该旧规划而被阻断；它实际扩大的读写及生成范围仍须核验。

## 2. 14 个主线节点的逐项结论

以下风险是合入与回归风险，不是已经复现的生产事故。统计为每个节点相对第一父提交的净变化，不能相加作为全程净差异。

| 顺序 | 主线节点    | 上游更新与范围                                    | 风险 | 建议                                                              |
| ---- | ----------- | ------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| 1    | `335362f4b` | Claude Action 1.0.252 → 1.0.266；1 文件，1 行替换 | 低   | 可原样合入；GitHub 实际运行待验证                                 |
| 2    | `1a367f1a3` | GPT Image 2.5 → 2.6；10 文件                      | 中低 | 合入，解决模型类型桥接冲突并保留管理员绑定                        |
| 3    | `5935ea022` | Omni Flash 1.1 → 1.2、时长及生成 schema；23 文件  | 中高 | 整体合入目录、端点、能力与 schema，核对 native 成本及 Studio 时长 |
| 4    | `a31b524be` | video-export 容器依赖升级；2 文件                 | 中   | 可沿用上游；独立验证容器构建与媒体处理                            |
| 5    | `3a8f6ca11` | stitch 0.3.1 → 0.4.0 发布元数据；5 文件           | 低   | 可原样合入，不重复计算既有功能                                    |
| 6    | `7ce57c312` | OpenTelemetry 3 整组升级，另含 unpdf 2；4 文件    | 中   | 依赖和调用代码一并合入，追加 PDF 附件回归                         |
| 7    | `84e7d00ab` | Worker 日志关联 PostHog 会话及用户；7 文件        | 中   | 合入，人工合并中间件并保留语言上下文                              |
| 8    | `6296dcdff` | 三组编辑 E2E、Mock 夹具及 CI；58 文件             | 中   | 保留，分开记录运行条件、fixme 和覆盖率边界                        |
| 9    | `62471ecc9` | 系统管理员 osk_ Key 跨组织 MCP 访问；5 文件       | 高   | 保留上游权限能力；补语言测试上下文和读写、生成隔离验证            |
| 10   | `f57b20cb1` | 测试用户角色、地点清理；4 文件                    | 低   | 可沿用上游清理顺序，保留本地限流测试 helper                       |
| 11   | `de097cda1` | 调整时长使上传视频过期；5 文件                    | 中低 | 合入，同时同步依赖图中英文标签                                    |
| 12   | `574780f71` | 对白变化实时刷新优化提示预览；9 文件              | 中   | 合入，保留 promptLocale、已有翻译并更新文档整表翻译键             |
| 13   | `7af636281` | 地点编辑测试及 unknown/untracked 区分；5 文件     | 中低 | 合入，保留无哈希与比较异常的不同语义                              |
| 14   | `d2e36d736` | 视频分辨率价卡、控件及即时估价；12 文件           | 高   | 适配二开规划/报价链和翻译后合入                                   |

### 2.1 `335362f4b`：Claude Action

唯一修改点为 `.github/workflows/claude.yml:35`。固定 SHA 从 `f27be6b65a4652f08a2ba3cff79114829b588967` 改为 `d535f5172dec02b204866b393d6b20b9b2aaf98d`。官方远端的注释标签解引用分别对应 v1.0.252 和 v1.0.266。

工作流触发条件、声明权限和 OAuth token 参数没有变化，应用及二开业务代码没有变化。单独合并模拟返回成功，结果树只改变这一行；没有触发 GitHub Action。

### 2.2 `1a367f1a3`：GPT Image 2.6

内部模型提交为 `8eba5896a`。逻辑模型键仍为 `gpt_image_2`，文生图及编辑 fal 端点、目录名称、种子和测试同步变为 2.6。该主线节点没有新增净 SDK 差异：`003e2df7c..1a367f1a3` 的 `package.json`、`bun.lock`、助手和文本适配器差异为零。

合并时保留 `src/models/models.ts` 中二开的 `BuiltinTextToImageModel` / `ConfiguredImageModelId` 边界，只把内置端点和名称更新为上游版本。不能整块接受上游 `TextToImageModel` 类型而丢失自定义模型的区别。

管理员给内置模型配置的绑定仍按实际 `upstreamModel` 路由，不会随目录名自动修改供应商 ID。`src/models/image-model-catalog.ts` 仍使用内置目录名称，因此可能显示 2.6 而运营绑定指向其他兼容模型；应回归此既有绑定优先行为，不凭展示名称推断能力。自定义模型名称测试中的 “GPT Image 2.5” 用于证明不能按名称猜能力，不能机械全局替换。

验证目录、绑定及解绑、文生图/编辑、参考图上限、配置图片价卡和 Studio 约束。种子改端点不表示真实供应商价格已核实。

### 2.3 `5935ea022`：Omni Flash 1.2

内部模型提交为 `b58499f0c`，`454df8367` 为分支同步。需一起采用 `gemini-native.ts`、模型目录、motion endpoint map、时长能力、Studio 和三份生成文件。

模型一般时长从 3–10 秒扩为 3–15 秒；fal Studio frames 路径带结束帧时仍限制到 10 秒，无结束帧可以保留 15 秒。核对 UI 报价、任务历史、实际送出时长及结算记录，不能把预检高估直接当作供应商多扣费。

上游 `src/models/gemini-native.ts` 自身注明：新输出费率来自 SDK metadata，Google 官方费率当时未确认，输入费率沿用 1.1。这属于继承的成本估算，实际供应商费率仍待核实。

生成 schema 不能全部归为格式变化：语义比较除 Omni 更新外，还包含 Kling4 可选中间关键帧、reference 结束帧/voice IDs，H3 reference 的 `target_audio_url`，以及 Seedance draft 有效期描述变化。这些可选字段不表示本项目 UI 已提供对应能力。应运行 motion transform、端点、时长和能力一致性测试。

继续保持 via stamp 决定轮询、任务模型快照和不跨供应商回退的契约。只做 Mock 验证，不通过录制调用真实服务。

### 2.4 `a31b524be`：video-export 容器依赖

内部提交为 `750ada4ac`，只改 `containers/video-export/package.json` 与其独立 `bun.lock`。mediabunny / @mediabunny/server 从 1.61.6 升到 1.65.0，并更新 @types/node 补丁。

与本轮二开没有直接文本冲突，可采用上游文件。根项目类型检查和构建不能覆盖独立容器，需容器自身构建，以及多音轨导出、源文件读取、M4A/OGG/FLAC 转 WAV 的可用本地环境冒烟。评估没有启动容器、下载依赖或部署。

### 2.5 `3a8f6ca11`：stitch 发布

内部提交 `3e0b364d8` 更新 stitch 版本与 changelog，并消费三份 changeset。范围读取与 `stitch pull` 实现已在旧基线中，本轮不把它们算作新增功能。

可沿用上游元数据，核对 workspace 版本和包构建即可；本轮不发布 npm 包。

### 2.6 `7ce57c312`：OpenTelemetry 与 PDF

不能只改依赖号：采用上游完整的一组 exporter、resources、metrics、trace 依赖及代码，将旧 sdk-trace-base 接口切到 sdk-trace 3、TracerProvider 和新 BatchSpanProcessor 参数；结构化 span 属性改为 JSON。

同一提交还把 `unpdf` 从 `^1.9.1` 升到 `^2.1.0`。当前使用点是 `src/assistant/ui/attachments.ts` 的浏览器 PDF 提取。已核对的新版本保留 getDocumentProxy 与 extractText/mergePages API，但重大版本兼容仍要用实际中文、英文及扫描 PDF 附件和浏览器构建验证；不能仅凭 OTel Mock 单测宣称整个提交通过。

OTel 验证包括错误与正常 span、结构属性、flush 和 Workerd 构建；外部采集端实际接收仍待部署账户验证。

### 2.7 `84e7d00ab`：日志上下文

上游通过日志 context 关联浏览器 PostHog distinct/session headers 和服务端鉴权得到的 userId，并同步 Start 与 providers 接入。

`src/platform/middleware.fn.ts` 存在真实文本冲突。正确组合是保留二开的 `promptLocale`：网页从请求语言解析，`/api/v1` 固定外部语言，再把原 `next({ context })` 包入上游 `withContext({ userId }, ...)`。还要保留网页组织中间件的语言注入。

日志关联 header 是观测信息，不能用来鉴权；保留现有脱敏。验证并发请求 context 隔离、匿名请求、API Key、OAuth、网页与外部任务语言，以及日志后端关联。该提交没有替代任务语言/路由快照。

### 2.8 `6296dcdff`：编辑 E2E

新增场景、镜头、对白/角色三个串行 spec、对应 Mock 夹具、CI 和覆盖率脚本调整，MCP 测试连接添加 `connection: close`。这些测试依赖完整流水线开关，不会全部在普通 E2E 中执行。

三个 spec 均调用已有 `authenticateUser`，能复用 develop 的英文 Cookie；默认中文不需要调整。MCP 创建任务仍需保留显式英文 promptLocale。检查 Mock 对生成提示词和新增参考图的匹配，关闭真实录制。

终点共 27 条测试声明，仍有 3 个 fixme：场景地点切换、重新生成静帧后的 spec 状态、对白烧入静帧。后续几个修复依赖本节点新增的测试文件，因此建议按主线顺序合入。

新 spec 自建 browser context/page，绕过 `base.page` 的 `addClientCoverage`；脚本列入 editing spec 不等于客户端覆盖已经采集。回归应分开报告执行成绩、fixme 及实际覆盖率采集。

### 2.9 `62471ecc9`：管理员跨组织 MCP

此项是上游新权限能力，尚未在 develop 实现。原先外部 MCP 生产工具使用调用者组织；现在仅当 `auth.kind === 'api_key'` 且邮箱通过 ADMIN_EMAILS 系统管理员检查时，允许根据 sequenceId 找到所属组织并为本次工具调用重建 ScopedDb。

OAuth token、网页内助手和 `/api/v1` 没有获得这条新通道；普通 API Key 也不会获得。新逻辑不是把浏览器用户传入的组织 ID 当作授权。

必须准确理解范围：`adoptForeignSequence` 在统一 `runTool` 中于 `spec.run` 之前执行，并没有按 readOnlyHint 限制，所以影响带 sequenceId 的读取、编辑、生成计划、执行和导出工具；不能把它描述成只读浏览功能。没有 sequenceId 的独立库接口仍按其原组织上下文工作。

二开兼容点：保留 `ReadToolContext.promptLocale` 和 MCP 的英文语言入口。上游新增 `admin-sequence-access.test.ts` 的 context helper 没有此字段，合入时必须补 `promptLocale: 'en'`，否则不满足 develop 当前的必填类型；这是静态契约检查，尚未运行合入后的 typecheck。

现有上游新测试覆盖管理员身份筛选、非管理员 not-found、跨组织重绑定及同组织不重绑定；尚不能替代外部 MCP 完整链路验收。补矩阵验证管理员 Key / 普通 Key / OAuth / 网页助手 / REST，区分读、写、生成和资源读取。若触发生成，核对任务组织、钱包归属、操作人、审批/计划 token、模型与语言快照及原有去重，不使用真实模型付费调用。

用户已取消旧的管理员默认不浏览作品规划，本评估建议保留该上游能力；该决定不自动赋予普通用户跨组织权限，也不表示上游代码已经合入。

### 2.10 `f57b20cb1`：测试清理

内部提交 `465f0080d` 复用领域既有 `deleteCharactersStatements` 等清理语句，涵盖未绑定某剧集的组织角色；地点清理先捕获 ID，避免先删 bible 后子查询失去目标。

保留 develop 的 `extendTestApiKeyRateLimitWindow` 及其身份保护。`AGENTS.md` 和 `.oxlintrc.json` 的上游调整与本地内容合并，不能覆盖现有二开说明或扩大例外。

仅在隔离测试库验证父子清理顺序、角色造型/地点/对白和其他组织不受影响。测试清理不是正式删除/供应商音色释放规则的替代，不需新增 SQL 或迁移。

### 2.11 `de097cda1`：上传视频时长失效

内部提交 `0261380ca` 修复 user-upload 不在有效模型目录时过早返回的问题。上传视频使用采用时的精确毫秒比较；生成模型仍按各自时长网格比较。

保留架构文档和交互图的同步更改。`src/ui/docs/dependency-graph.ts` 的两条英文标签变化需要同步 `src/ui/i18n/locales/en/labels.json` 与 `zh-CN/labels.json`；只合上游会使中文图出现英文回退。

验证原时长 fresh、变更后 stale、恢复原时长 fresh，以及视觉/动态提示词不因纯时长调整误失效。没有新增供应商调用或历史数据改写。

### 2.12 `574780f71`：对白实时预览

内部提交 `4668afe16` 新增 dialogue-lines 实时事件。服务端在对白写入后广播，客户端失效相关查询和镜头下所有优化预览键；广播失败记录日志，不把成功写入反转为保存失败。

保留 develop 的 `DialogueEditContext.promptLocale`、saveShotPrompt 的语言参数、后续载荷透传，以及 dialogue-lines.tsx 的翻译 hooks。这里无文本冲突也仍需语义复核。

`docs/developer-guide/workflow.md` 的 realtime 事件表发生变化，而文档国际化把整张表作为原文键，必须同步 en/guide.json 与 zh-CN/guide.json 的整表键和中文内容。

验证跨页或跨标签修改/恢复对白后预览自动刷新、同一镜头不同预览参数均失效、语言继承，以及广播失败时写入保持成功。本提交不直接修改现有场景标题缓存桥接。

### 2.13 `7af636281`：失效比较错误语义

内部提交 `eb0b2cff0` 把整体比较失败或缺失 anchor 的结果改为 unknown；没有生成哈希的空白镜头仍为 untracked。E2E 相应区分被地点编辑影响的镜头和新增空白镜头。

这不是“修复所有地点失效问题”。保留批量与单镜头异常契约，运行 shot-staleness-batch 回归并区分无跟踪、不可比较、已过期三种状态。

### 2.14 `d2e36d736`：分辨率计价与即时报价

此项改善 USD 供应商成本预估和现有余额预检：所选分辨率有明确价卡时优先使用该档位，避免混合分辨率观测中位数影响估算；无明确档位时仍遵循原有拒绝或中位数路径。实际供应商结算继续使用现有用量与单位价格机制。

它没有实现人民币售价、汇率、利润或新钱包。

必须适配的三点：

1. 上游估价 handler 使用 `estimateContinueCost`，develop 已换成 `prepareContinueEstimate`，后者负责管理员模型配置快照、配置图片计划及价卡。保留二开调用、promptLocale、userId 和 imageSource，把上游“请求参数覆盖已保存选项”接到现有入口。
2. 不能只把新 resolution 合到 handler 的 sequence：`prepareContinueEstimate` 内部 computePlan 会再读 D1，保存未落地时仍可能按旧图片规格报价。既有 `FreshPlanSequenceOverrides` 已支持 imageModel、videoModel、resolution，直接把覆盖透传到计划；音乐估价仍从合并后的序列读取。无需扩展表或数据结构。将 sequenceModelsSchema 移到上游要求的定义位置，同时保留二开自定义 analysisModel 校验并增加 resolution 字段。
3. 新 MotionResolutionPicker 有四处硬编码英文，需要接入现有翻译机制和双语资源。它写的是全剧集 `sequence.resolution`，也会影响后续图片规格和配置图片报价；不能称为独立视频分辨率。

验证 720/1080/4K、大小写及 768P 映射、未知价卡、无档位价卡、draft/fixed 模式。二开专项用真实内存 D1 检查保存延迟或失败时的即时估价、内置与配置图片混合计划、报价与启动快照一致、余额不足和调价后的旧任务回放。

## 3. 合并模拟与人工处理点

逐个将固定 develop 与 14 个上游前缀节点执行 `git merge-tree --write-tree --name-only`，未改变工作区、索引或分支。模拟生成的树对象只供分析，含冲突标记的树不用于执行或交付。

| 最早出现节点 | 文件                            | 冲突块数 | 处理原则                                             |
| ------------ | ------------------------------- | -------- | ---------------------------------------------------- |
| `1a367f1a3`  | `src/models/models.ts`          | 1        | 保留内置/配置模型类型边界，采用 2.6 内置端点         |
| `84e7d00ab`  | `src/platform/middleware.fn.ts` | 1        | withContext 与 promptLocale 同时保留                 |
| `d2e36d736`  | `src/sequences/sequences.fn.ts` | 3        | 合并 import、报价 handler、schema 定义位置及二开校验 |

终点模拟为 3 个文件、5 处冲突。其余前缀重复已有冲突，不代表每个提交新增冲突。

自动合并仍须补：管理员测试的 promptLocale、新控件及依赖图标签翻译、工作流文档整表翻译，以及报价参数进入配置图片计划的覆盖。不能用只解决上述 5 处标记代替兼容适配。

## 4. 支线历史的 34 项检查索引

支线 SDK 升级和同步 merge 在 Git 中尚未全部作为祖先出现，但其最终依赖内容已经在当前基线中体现。按主线 merge 保留关系即可，不重复应用旧升级 patch。

| 序号 | 提交        | 所属主线节点 | 已核对的职责或关系                                   |
| ---- | ----------- | ------------ | ---------------------------------------------------- |
| 1    | `335362f4b` | 同名         | CI Action 单行升级                                   |
| 2    | `e0321896c` | `1a367f1a3`  | TanStack AI 1.0.1 历史升级，终点无新增净 SDK 差异    |
| 3    | `55d95c07f` | `1a367f1a3`  | SDK 分支合 main 同步                                 |
| 4    | `440b934ae` | `1a367f1a3`  | SDK 分支再次同步 main                                |
| 5    | `031d882d5` | `1a367f1a3`  | SDK 1.1.0 历史升级，终点无新增净 SDK 差异            |
| 6    | `20c67706f` | `1a367f1a3`  | SDK 分支同步 main                                    |
| 7    | `ab5d86315` | `1a367f1a3`  | SDK 1.2.0 历史升级，终点无新增净 SDK 差异            |
| 8    | `8eba5896a` | `1a367f1a3`  | GPT Image 2.6 模型实际修改                           |
| 9    | `f98ab67e6` | `1a367f1a3`  | 另一条 1.0.1 升级历史，不重复应用                    |
| 10   | `2f933c93e` | `1a367f1a3`  | 另一条 1.2.0 升级历史，不重复应用                    |
| 11   | `69b9e6ecf` | `1a367f1a3`  | Gemini/OpenRouter 适配器历史更新，当前基线已有净内容 |
| 12   | `c21440b7a` | `1a367f1a3`  | 模型分支合 SDK 分支                                  |
| 13   | `a26138214` | `1a367f1a3`  | 模型分支同步 main，核对主线净差异                    |
| 14   | `1a367f1a3` | 同名         | 汇入 GPT 模型分支，保留二开模型类型                  |
| 15   | `b58499f0c` | `5935ea022`  | Omni Flash 1.2 实际模型/schema/时长变更              |
| 16   | `454df8367` | `5935ea022`  | Omni 分支同步 main                                   |
| 17   | `5935ea022` | 同名         | 汇入 Omni 模型分支                                   |
| 18   | `750ada4ac` | `a31b524be`  | 容器三项依赖更新                                     |
| 19   | `a31b524be` | 同名         | 汇入容器依赖分支                                     |
| 20   | `3e0b364d8` | `3a8f6ca11`  | stitch 版本、changelog、changeset 消费               |
| 21   | `3a8f6ca11` | 同名         | 汇入包版本分支                                       |
| 22   | `7ce57c312` | 同名         | OTel 整组 API/依赖与 unpdf 2                         |
| 23   | `84e7d00ab` | 同名         | 日志会话及用户 context                               |
| 24   | `6296dcdff` | 同名         | 编辑 E2E、夹具与 CI                                  |
| 25   | `62471ecc9` | 同名         | 系统管理员 osk_ 跨组织 MCP                           |
| 26   | `465f0080d` | `f57b20cb1`  | 组织角色与地点测试清理修复                           |
| 27   | `f57b20cb1` | 同名         | 汇入测试清理分支                                     |
| 28   | `0261380ca` | `de097cda1`  | 上传视频精确时长比较                                 |
| 29   | `de097cda1` | 同名         | 汇入时长失效修复                                     |
| 30   | `4668afe16` | `574780f71`  | 对白实时事件和预览失效                               |
| 31   | `574780f71` | 同名         | 汇入实时预览修复                                     |
| 32   | `eb0b2cff0` | `7af636281`  | unknown/untracked 语义和地点测试                     |
| 33   | `7af636281` | 同名         | 汇入地点编辑修复                                     |
| 34   | `d2e36d736` | 同名         | 分辨率价卡、UI 与即时估价                            |

## 5. 推荐实施与验证顺序

按照第 2 节的 14 个节点依次推进。每次仅合入一个上游节点及其必要二开适配，记录当次结果后继续，保留完整上游提交关系。不要把全部 34 条支线历史逐个重复 cherry-pick。

1. Action：差异检查与 GitHub 工作流运行边界。
2. GPT：模型目录、配置图片绑定/解绑、文生图与编辑。
3. Omni：端点、generated schema、duration、capability、Studio 和 native/fal 分流。
4. 容器依赖：容器自身构建及导出/音频转码冒烟。
5. stitch：workspace 包构建及版本一致性。
6. OTel/unpdf：新 API 单测、flush、Workerd 构建及 PDF 附件。
7. 日志：并发隔离、脱敏、身份、网页与外部语言上下文。
8. 编辑 E2E：先保留新用例和已知 fixme，后续修复后执行完整三组。
9. 管理员 MCP：完整身份/接口/读写/生成矩阵，补必填语言。
10. 清理：内存 D1 清理回归及已有测试 API Key helper。
11. 上传时长：fresh/stale 恢复、提示词不误失效及双语依赖图。
12. 对白实时：缓存失效、广播失败、版本恢复、语言和整表翻译。
13. 地点错误语义：unknown/untracked 与单镜头异常契约。
14. 分辨率计价：价卡与规范化测试、真实内存 D1 的即时估价/计划快照回归、双语控件。

每项完成对应检查后，最终执行 `bun typecheck`、`bun lint`、`bun dead-code`、全量 `bun run test`、普通及 E2E 构建，再在隔离本地 D1/R2、aimock、E2E_RECORD=0 下执行完整编辑测试及中文重点流程。容器测试与浏览器云端环境边界另行记录。

## 6. 本轮实际证据与未执行项

已执行：刷新 upstream/main；固定 Git 基线；逐主线和内部提交查看差异及依赖关系；与 develop 二开对照；14 个前缀的 merge-tree 模拟；统计终点 3 文件/5 冲突块；检查新增 schema/迁移/wrangler 差异为空；核对 Action 官方标签与 SHA；业务文档规划更正和文档检查。

本轮没有合并源码、改变已合入基线、迁移数据库、运行真实模型或发送邮件、启动部署、发布包、提交或推送。没有执行合入后的应用类型检查、业务单测、构建或浏览器验收；本文的验证列表均为后续实施要求，不沿用历史通过数量作为本轮成绩。

复现主要范围和模拟：

```powershell
git rev-list --count 92986ba7a..d2e36d736
git log --reverse --first-parent --oneline 003e2df7c..d2e36d736
git log --reverse --topo-order --oneline 92986ba7a..d2e36d736
git diff --stat 003e2df7c d2e36d736
git merge-tree --write-tree --name-only 92986ba7a d2e36d736
git diff --name-only 003e2df7c d2e36d736 -- drizzle src/platform/server/db/schema wrangler.jsonc
```

`merge-tree` 因上述冲突返回 1 属于本次观察结果；不得将其当作合入完成。
