# 2026-11-08 新增两项上游更新评估

状态：只读源码评估完成，尚未合入。本文补充 [前次逐提交评估](upstream-merge-assessment-20261107.md)，不改写此前的固定范围和已合入基线。

## 1. 固定范围与建议

- `develop` / `origin/develop`：`92986ba7a0004434a4732a418cf56e7bf026420b`。
- 已实际合入的上游基线仍为 `003e2df7c4986fc236ea9a1c67c3f18089874d48`。
- 上次评估终点：`d2e36d736b6ea0b0ae2998af3296c875b7773e44`。
- 本次 fetch 后上游终点：`9fa05fcfc7e33af354cf2c22b0e1bb45507e4ff8`。
- 新增恰好两个直接主线提交，没有额外支线提交；两项合计净变化 20 个文件，850 行新增、913 行删除。
- 全部待合入范围现为 16 个主线节点、36 个提交。先前文档、取消管理员默认不浏览作品规划的修改仍在工作区，本次保留。

建议两项均纳入，接在先前 14 项之后，各自单独合入和验证。第一项是开发工具及本地运行时升级，第二项同时涉及认证、组织界面和大量生产依赖，不能仅凭补丁或次版本号判定低风险。

| 顺序 | 提交        | 变化                                                                            | 风险 | 建议                                                       |
| ---- | ----------- | ------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| 15   | `a7c4ea3ec` | 31 项直接开发依赖、lint 注释位置、文档缩进、Worker 类型及 sourcemap 上传配置    | 中高 | 合入，适配锁文件、生成类型和两段帮助翻译键，单独验证工具链 |
| 16   | `9fa05fcfc` | 35 项直接生产依赖，Better Auth 全套对齐、组织邀请查询隔离、率卡 schema 导入修复 | 高   | 合入，保留二开依赖与国际化，独立验收认证和业务调用         |

两项没有直接修改模型 ID、供应商路由、任务语言、二开模型/价卡快照、钱包或销售计价算法。第 16 项没有再次升级 TanStack AI SDK；不能把本次依赖变化描述成新模型能力或二开新增功能。

## 2. 第 15 项：`a7c4ea3ec`

完整提交：`a7c4ea3ec01b5b298dcfa49ff6a0b3147d6f467f`，父提交为上次终点 `d2e36d736`。北京时间 2026-11-08 14:10:28；标题为 Apply Dependabot dev dependency bumps and fix CI (#2320)。净变化 14 文件，541 行新增、617 行删除。

### 开发工具和本地运行时

`package.json` 的 31 项直接 devDependencies 变化，没有稳定版本的直接开发包跨主版本，oxfmt 为 0.x 次版本升级。主要声明版本为：

| 依赖                         | 原声明版本         | 新声明版本         |
| ---------------------------- | ------------------ | ------------------ |
| @cloudflare/vite-plugin      | ^1.62.5            | ^1.67.0            |
| wrangler                     | ^4.147.0           | ^4.157.0           |
| Vite                         | ^8.3.2             | ^8.3.5             |
| @copilotkit/aimock           | ^1.43.0            | ^1.47.0            |
| Vitest / @vitest/coverage-v8 | 5.0.3              | 5.1.0              |
| Playwright                   | ^1.63.0            | ^1.64.1            |
| oxlint / oxlint-tsgolint     | ^1.86.0 / 7.0.2003 | ^1.91.0 / 7.0.2005 |
| oxfmt                        | ^0.71.0            | ^0.76.0            |
| Lefthook                     | ^2.1.16            | ^2.2.2             |
| Knip                         | ^6.39.0            | ^6.44.1            |
| @modelcontextprotocol/client | 2.3.0              | 2.4.0              |

其余变化包括 Storybook、React 插件、开发面板、Tailwind、类型和测试辅助工具。Node/Bun 的 engines 声明未变。

不能根据 devDependencies 分类断言全部不会影响运行产物：MCP client 也在 ai-mcp 的依赖图中。第 15 项会暂时让 client/core 2.4.0 与 server/core 2.3.1 并存，第 16 项再对齐 server；这不是已复现的协议错误，两个节点各自仍要跑真实 SDK 链路测试。

注意锁文件有两套本地运行链：Vite 插件依赖 Miniflare `5.20261101.0-beta` / workerd `1.20261101.1`；根 Wrangler CLI 与生成类型对应 Miniflare `5.20261103.0-beta` / workerd `1.20261103.1`。不能用 CLI 启动成功代替 Vite dev/preview 验证，也不能据生成类型断言两条路径运行完全一致。

`compatibility_date` 仍为 `2026-10-08`，`nodejs_compat`、`enable_request_signal` 及本地绑定策略未改。本次不顺便推进兼容日期。旧 AGENTS.md / 部署文档中“当前 Wrangler 为 4.147.0、workerd 为 1.20261001.1”的描述，合入时应更新或明确作为当时选取日期的历史依据；不能把过时运行时号继续当作当前事实。

### CI 修复的真实范围

- `wrangler.jsonc` 新增 `upload_source_maps: false`。上游提交说明此设置用于避免新 Vite 插件默认生成并上传的 Worker sourcemap 超出其部署上限；本次未构建或部署，未复现该上限错误。合入应保留此配套设置，并验证构建产物中的最终配置。关闭上传会影响线上堆栈映射能力，应作为部署取舍记录。
- 三份测试仅移动 `no-unsafe-type-assertion` 抑制注释，以适配 oxlint 新报告位置，没有放宽断言或修改被测行为。本地二开其他抑制注释也可能需调整，须实际运行新 lint 后按诊断处理，不全局关闭规则。
- 七篇文档改动为续行缩进；该提交没有修改 `.github/workflows/*.yml`。标题中的 fix CI 指这些工具、格式和构建配置适配。
- `worker-configuration.d.ts` 除生成注释和 runtime 版本外，还增加资源模块声明、更新若干 Cloudflare 类型，不能把 166 行差异全当作无效格式变更。没有新增应用 Env 字段。

### 二开必须适配

1. **保留二开锁依赖。** 本节点已使 bun.lock 与 develop 冲突；在采用上游工具版本时，保留 i18next、react-i18next、openai 及它们的必要解析项。不要整文件覆盖或删除锁文件后无约束重新解析。
2. **按项目生成流程处理 Worker 类型。** develop 的原始差异只有类型文件开头临时路径注释；本次该头部与新 runtime 注释发生冲突。采用对应新运行时的完整类型，使用 `scripts/regen-worker-types.ts` 的占位 secret 名录流程复核；不能只保留旧 runtime 声明、删除整个 runtime 区或把真实环境文件内容写入报告。
3. **同步两个公开帮助段落的翻译键。** 文档分段和 `translateStaticLabel` 都按完整原文精确查找。只读分段比对确认 `docs/developer-guide/public-api.md` 的 device-code 段落，以及 `docs/deployment/cloudflare.md` 的 deploy/migrate 列表各改变一个 prose 段。现有 en/zh-CN 的 guide.json 都有旧键、没有新键。应同步两套键及相应内容，否则中文回退英文；架构目录的纯缩进不在公开帮助收集范围。

### 合入后验证

冻结安装并复核锁差异后，运行新版本格式、lint、typecheck、dead-code、应用 Vitest 与覆盖率检查；单独运行 `.codex/hooks/vitest.config.mjs`，验证实际 formatter/linter 和 Windows 提交钩子路径。Playwright 升级还需匹配浏览器二进制。

分别验证 Vite dev、生产构建和 E2E 构建，确认本地 DB/R2、工作流、realtime 断连、源映射最终配置和 Worker 类型生成。aimock 保持 replay，禁用录制；不以新的测试工具作为执行付费录制的授权。中文帮助两段需确认不会回退英文。

## 3. 第 16 项：`9fa05fcfc`

完整提交：`9fa05fcfc7e33af354cf2c22b0e1bb45507e4ff8`，直接父提交为 `a7c4ea3ec`。北京时间 2026-11-08 14:26:21；标题为 fix(#2319): bump the production group and keep Better Auth on 1.7.16 (#2321)。净变化 8 文件，325 行新增、312 行删除。

### 认证版本必须成套

Better Auth 主包、API Key / MCP / passkey 插件从 1.7.7 对齐到 1.7.16，`@better-auth/core` override 从 1.7.6 对齐到 1.7.16，并新增 `@better-auth/oauth-provider: 1.7.16` override。`auth:generate` CLI 从 1.7.2 同步到 1.7.16，相关配置注释同步。

不能只接收主包和插件、遗漏两个 overrides；原有 core/CLI 版本落后问题是该提交明确处理的兼容范围。`oauth-provider.test.ts` 补 `isContinuation: false` 适配回调输入，没有改写生产 OAuth 组织范围。

源码和 Git blob 比对显示，这项没有 schema、migration、auth/config 或角色定义变化。但这不证明新插件生成结构与现有表相同：实施时应用匹配 CLI 在隔离目录按真实配置生成 schema 并比对字段、类型和约束，才能判断是否需要迁移。若有差异，按 Better Auth CLI → 项目 schema → Drizzle 生成流程处理，不手填表结构。本轮不生成表或执行迁移。

### 普通成员组织页修复

此前 `OrganizationPanel` 同时发起成员和邀请两个 Suspense 查询。上游说明 Better Auth 1.7.16 对没有 invitation:create 的邀请查询返回 403；这会影响共同边界内的成员列表显示。

上游把邀请查询与取消操作移到 `PendingInvitations`，仅当 `canInvite` 为真时挂载。现有 member 角色没有 invitation 权限，admin/owner 有 create/cancel；门槛与当前角色表一致。普通成员保留成员列表，邀请/取消能力仍按权限提供，没有裁剪组织能力。

`src/ui/settings/organization-settings.tsx` 存在真实文本冲突。正确处理是采用上游拆分与权限条件，同时把原二开的 `useTranslation('pages')`、`useLabelTranslation('pages')` 及原 JSX 的 t/角色翻译迁入新组件，保留父组件成员角色翻译、操作错误翻译及自身编辑保护。所有移动的 UI 文案键已存在，无需新增语义键或翻译用户邮箱、姓名。

保留二开验证码/邀请邮件的语言上下文、切换组织时清理 QueryClient 的逻辑。依赖升级不能把这些文件回退成上游原版。新 UI 门槛不代替服务端角色授权。

### 生产依赖与率卡修复

35 项直接生产依赖改版，没有直接生产依赖增删；新增的是 OAuth provider override。下面区分声明下限与锁文件的实际解析版本：

| 依赖                           | 父提交实际锁定   | 新实际锁定       | 新声明与关注点                               |
| ------------------------------ | ---------------- | ---------------- | -------------------------------------------- |
| @modelschemas/rate-card        | 0.2.0            | 0.2.2            | ^0.2.2；必须采用 /schema 导入                |
| @modelcontextprotocol/server   | 2.3.1            | 2.4.0            | client/core 对齐，验证 stateless、资源和卡片 |
| @elevenlabs/elevenlabs-js      | 2.71.0           | 2.77.0           | ^2.75.0；语音、声音管理、转写 Mock           |
| @tanstack/react-query          | 5.104.1          | 5.107.1          | ^5.105.3；组织缓存、Suspense、报价失效       |
| @tanstack/react-start          | 1.168.60         | 1.169.5          | ^1.169.4；server fn、SSR 和边界剥离          |
| @tanstack/react-router         | 1.170.41         | 1.170.46         | ^1.170.46；路由、Cookie、OAuth 重定向        |
| @tanstack/markdown / highlight | 1.0.0 / 1.1.0    | 1.2.0 / 1.2.11   | 助手正文、链接和代码块                       |
| Tiptap 五个直接包              | 3.31.4           | 3.33.0           | ^3.32.2；core/pm overrides 仍为 3.31.0       |
| @videojs/media / react         | 10.0.1           | 10.3.0           | SSR 导入和浏览器播放                         |
| mediabunny                     | 1.61.3           | 1.65.2           | ^1.65.1；媒体探测、时长、解码                |
| React / React DOM              | 19.3.0           | 19.3.1           | SSR/hydration、国际化首屏                    |
| Zod                            | 4.6.5            | 4.6.7            | 助手根 JSON Schema 和任务载荷解析            |
| jose                           | 6.2.12           | 6.2.15           | JWT、JWKS、audience 与过期                   |
| posthog-js / node              | 1.438.3 / 5.55.1 | 1.447.3 / 5.63.1 | 声明 ^1.445.1 / ^5.61.2，flush/关联          |
| stripe                         | 23.0.0           | 23.1.0           | 现有支付 Mock / webhook / 去重               |

此外有 Base UI、Radix、LogTape/redaction、react-virtual、PostCSS、Mermaid 和图标等更新。Tiptap 与 overrides 的版本差不直接等于已发现故障；应通过编辑器真实交互验证，不顺便重构。

锁文件还变更了传递依赖，例如 srvx 0.11.22 → 1.0.8，新增 video.js 与部分 @svta 包。需要构建和运行证据，不能凭锁文件总大小推断 Worker 内存是否超限。

本节点所有 `@tanstack/ai*` 版本和 fal/OpenRouter SDK 版本均未变，未改二开适配器源码。继续保留两种文本协议、图片绑定、User-Agent、路由快照和 promptLocale，不重新设计调用体系。

两处 `rateCardSchema` 值导入必须随包升级改为 `@modelschemas/rate-card/schema`：`src/billing/server/fetch-rate-cards.ts` 和前次上游新增的 `src/billing/motion-rate-cards.test.ts`。类型与 evaluator 仍使用 /evaluator。只改锁文件可能漏掉构建修复；没有证据证明新版 evaluator 与旧持久价卡完全一致，需要现有拒绝、解析和分辨率优先回归。该项只调整 schema 导入，不实现人民币售价或新计费规则。

`docs/architecture/media-vias.md` 新增子路径说明，但 architecture 不在公开帮助收集范围，当前 guide 资源也没有对应段落，因此本项没有新增公开帮助翻译键；第 15 项的两个公开段落仍需处理。

### 二开依赖与验证

`package.json` 和锁文件冲突时，保留 `i18next: 26.7.1`、`react-i18next: 17.1.11`、`openai: 7.32.0` 三项二开直接依赖及必要解析项，采用上游本次更新的版本并复核 Bun 解析差异，随后冻结安装。不能采用整份上游包文件而丢失国际化或兼容图片客户端。

优先验证：

1. 匹配版本的 auth schema 隔离生成比对；OTP、Google、passkey、API Key、OAuth consent/token、MCP 身份与限流。邮件走 Mock，核对中文 locale，不发送真实邮件。
2. owner/admin 邀请与取消、member 查看成员但不发邀请列表请求；直接接口越权拒绝、角色变更和最后 owner 保护；切组织后成员/邀请无旧缓存闪现。验证中英文页面。
3. 助手全工具 Schema、lazy discovery 前后、Chat Completions / Responses Mock 请求体：保留 `safeExtend({})` 的根 object/default/$ref 修复。Zod 小版本未变主版本不能代替此回归。
4. 文本和图片渠道 Mock、模型配置/价卡快照、任务语言、语音 Mock、率卡持久解析及分辨率估价；不访问付费供应商。
5. 最终 typecheck/lint/dead-code、应用单测、普通与 E2E 构建；浏览器验证登录/组织切换、中文首屏、剧本 mention/粘贴/撤销/保存、助手 Markdown、播放器和媒体上传。必要时按现有脚本测 Worker heap。

## 4. 更新后的合并冲突

执行 `git merge-tree --write-tree --name-only develop <上游节点>`，没有改工作区、索引或分支。以下是包含此前 14 项在内的累计模拟，并非这两项各自都新增这些冲突：

| 截止节点           | 冲突文件数 | 冲突块数 |
| ------------------ | ---------- | -------- |
| 上次终点 d2e36d736 | 3          | 5        |
| 第 15 项 a7c4ea3ec | 5          | 7        |
| 第 16 项 9fa05fcfc | 7          | 10       |

终点七个文件为：bun.lock（2 块）、package.json（1）、models.ts（1）、middleware.fn.ts（1）、sequences.fn.ts（3）、organization-settings.tsx（1）、worker-configuration.d.ts（1）。

新增四类文件的处理：

- bun.lock、package.json：合并上游依赖与三项二开直接依赖，复核解析；不整文件取一方。
- organization-settings.tsx：采用权限隔离及组件拆分，同时迁入既有翻译。
- worker-configuration.d.ts：冲突在生成头部；保留升级后的完整 runtime 声明并按项目生成器复核。

原有模型类型、promptLocale、Continue 配置图片规划和分辨率报价适配仍按前次报告执行，不能因两项依赖更新而省略。公开帮助翻译键没有 Git 文本冲突，仍属于必要语义适配。

## 5. 实际证据与边界

本轮完成 upstream fetch、固定引用、两个直接提交的全部净差异及锁版本检查、与 develop 二开对照、两个前缀合并模拟、冲突块计数、公开帮助分段与双语资源精确键比对、schema/migration 差异检查，以及本评估文档格式和差异检查。

没有安装或运行目标升级依赖，没有执行合入后的类型检查、业务单测、构建、浏览器流程、schema 生成、数据库迁移、真实邮件、供应商消费或部署。没有合入源码、提交或推送。上游提交说明的 CI 原因及修复不等于本地已经复现和验证；以上版本和行为分析以固定 Git 源码与锁文件为证据，不作额外的供应商或新版 API 兼容承诺。

复现范围：

```powershell
git log --reverse --first-parent --oneline d2e36d736..9fa05fcfc
git diff --stat d2e36d736 9fa05fcfc
git diff d2e36d736 a7c4ea3ec
git diff a7c4ea3ec 9fa05fcfc
git merge-tree --write-tree --name-only 92986ba7a a7c4ea3ec
git merge-tree --write-tree --name-only 92986ba7a 9fa05fcfc
git diff --name-only d2e36d736 9fa05fcfc -- drizzle src/platform/server/db/schema
```

上述 merge-tree 返回 1 为冲突观察结果；生成树对象不是已合入或可运行版本。
