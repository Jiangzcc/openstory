# 上游 main 更新与 develop 合并评估

评估日期：2026-11-05（Asia/Shanghai）。本文保留合入前的 Git 预演与静态评估；其中分支、索引和“尚未实际合并”等描述均为评估时状态。后续实际合入、适配与验证见 [实施记录](upstream-merge-implementation-20261105.md)。

## 1. 结论与建议

按用户于 2026-11-05 补充明确的目标，本次同步以尽可能保持与上游 main 一致为优先。“每用户独立空间与余额”等商业功能尚未开始开发，本次不以这些后续规划裁剪上游组织切换、成员邀请、角色权限及共享行为；人民币计价、卡密结算和凭证管控等后续需求另行实施。

建议完整合入这批上游更新，沿用上游组织/认证体系，并对已实现的国际化、管理员模型配置和文本渠道做最小兼容适配。技术风险仍较高，主要来自数据迁移、接口适配和回归验证。

已执行 Git 的三方合并预演，结果为 56 个文件、86 处文本冲突。消除这些冲突后，仍需检查自动合并的二开模块是否继续使用已移除的接口。不能根据 Git 自动合并成功推断业务兼容。

此次评估只更新了 upstream 远程跟踪引用并生成 Git 预演对象，没有切换分支、修改索引、合并或修改业务代码；本文件是新增评估文档。未执行数据库迁移、部署、推送、真实模型调用或真实邮件发送。

## 2. 已核验的比较范围

| 项目             | Git 事实                                                              |
| ---------------- | --------------------------------------------------------------------- |
| 二开分支         | develop，df55c35a4a4a3a357f80f82b097fc3e466989d4c                     |
| 最近共同基线     | 1999cb15816bd9f3317b5d7ae2121685ef338663，与现有二开说明记录一致      |
| 上游 main        | 6c0e82b2f72ad3ad7369c59dd3698dd454696da7                              |
| 上游最新提交时间 | 2026-11-05 12:28:11，北京时间                                         |
| 本地 main        | 已指向与上游最新相同的提交；develop 尚未合入                          |
| 二开独有提交     | 3 个                                                                  |
| 上游独有提交     | 34 个，含功能分支提交及合并提交；主线归纳为 9 项变更                  |
| 上游变更规模     | 780 个文件条目，158,810 行增加、8,023 行删除                          |
| 上游源码相关规模 | src、packages、scripts 共 709 个文件条目，11,177 行增加、7,603 行删除 |
| 二开变更规模     | 608 个文件条目，41,752 行增加、6,984 行删除                           |
| 双方共同触及     | 150 个文件条目，按 Git 重命名前后路径匹配                             |
| 合并预演         | 56 个冲突文件、86 处冲突块；53 个代码/测试文件和 3 个架构文档         |
| 上游新增迁移     | 10 份 migration.sql，各自附 snapshot.json                             |

上游新增的 10 份数据库快照贡献 146,847 行，因此不能把 15.9 万行总增加量理解为同等规模的新业务逻辑。另一方面，组织改名确实穿过大量源码，不能只把它理解成几个文件名变化。

develop 的 3 个独有提交：

- 190bbf555：默认中文及全站中英文切换。
- 23bde5064：管理员模型配置和第三方文本渠道。
- df55c35a4：项目开发规则、Codex 配置与检查脚本。

二开已实现的是国际化、管理员默认模型配置和文本渠道接入等源码能力；人民币销售价/充值结算、完整卡密规则、全面禁止 BYOK、默认私有素材及生产部署仍应按原文档标记为规划或待验证。

## 3. 上游这次实际更新了什么

| 上游变更                      | 原有行为 → 新行为                                                                                                      | 对本项目的价值与影响                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| #2226，组织与认证升级         | 自维护 Team 成员/邀请与默认团队 → Better Auth organization 插件、活动组织、owner/admin/member 权限、组织切换和成员管理 | 本次最大变化；可复用更完整的租户权限基础，同时影响认证、中间件、数据库、API/MCP、工作流和 UI |
| #2240，BytePlus 真人素材修复  | 元素/地点图中的真人可能作为普通 URL 送入 Ark → 记录 personInMedia 并在提交前走资产注册                                 | 降低 Seedance 因真人参考素材未注册而拒绝任务的风险；增加识别元数据与迁移                     |
| #2244，D1 读副本              | 读操作主要直接使用原 D1 句柄 → 按请求/工作流建立 D1 session，读请求允许就近副本，写及一致性边界使用对应 session 策略   | 有望降低公网读取延迟；实际效果取决于部署配置和实测，需核对写后读与用户会话隔离               |
| #2241，并发上传确认           | 同时触发真人素材授权确认时可能覆盖等待者 → 用队列组织确认请求并调整元素选择流程                                        | 修复并发上传与授权弹窗的实际交互问题；需要保留二开中文提示                                   |
| #2245，对账/清理扫描索引      | 多种后台扫描缺少适合状态+时间条件的索引 → 增加相应复合/部分索引                                                        | 有利于降低扫描成本和长队列压力；需要应用迁移                                                 |
| #2250，角色/地点改名约束      | 改名可能撞上已有使用中的角色/地点 → 拒绝会导致现有剧集引用冲突的名字                                                   | 保护已有剧集引用的一致性；需核对中文错误提示及编辑失败反馈                                   |
| #2246，剧集页面读取优化       | 多批读取容易顺序等待、逐项读取 → 分块查询批处理并让独立读取并行                                                        | 重点改善页面获取剧集/镜头数据的读取路径；不据源码推断具体提速倍数                            |
| #2253，助手可操作未入剧集角色 | 部分助手/MCP 角色能力依赖剧集上下文 → 可读取和编辑还没有被剧集使用的组织角色                                           | 改善角色库与助手联动；仍要保持组织权限和实体作用域                                           |
| #2225，场景聊天入口           | 聊天按钮主要依赖文字 → 窄布局使用图标、宽布局显示文字                                                                  | 小范围体验改进，但与已国际化的按钮和无障碍名称存在文本冲突                                   |

这些均为上游新增或修复，不能计入本项目二开成果。此次也没有完成本项目的人民币商业闭环。

## 4. 合并风险与必要适配

### 4.1 组织模型和已有任务：高风险

- 上游把主要接口中的 teamId 改为 organizationId，同时修改组织选择、请求上下文、用户离开组织后的活动会话处理、公开 API/OAuth/MCP 和存储命名。应以实际接口逐点适配；部分遥测仍有意同时保留旧/新字段，不能全仓库机械替换所有 team 字符串。
- src/platform/server/workflow/base-workflow.ts 在上游版本直接要求 payload.organizationId 与 userId；提交 12b76c36a 明确删除旧 teamId payload shim。因此旧代码启动且尚未完成的工作流，不能默认跨此次升级继续运行。实际切换前要确认在途任务状态或设计兼容处理。
- 本次沿用上游的组织切换、成员邀请、角色权限及共享行为，不为尚未开发的“每用户独立空间与余额”增加入口限制或另建权限规则。该商业规划不构成本次合并的决策前提。

### 4.2 二开模型配置/文本渠道：高风险

本轮二开配置与渠道存储复用 app_metadata（JSON）；该表在这批上游更新中未改变，二开没有新增 Drizzle schema 或迁移。因此无需重做模型管理功能，也不存在两套新增模型迁移交错的问题。风险集中在桥接调用和来源判别。

| 证据（M 为预演树，U 为固定上游）                                                          | 已确认事实                                                                         | 合并要求                                                                                               |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| M:src/models/server/llm-key-routing.ts:17,43,59；U:src/models/server/db/api-keys.ts:65–78 | 无冲突合入的新路由模块仍返回 source=team；上游合法来源已改为 organization/platform | 统一组织凭证来源值，保持平台兼容渠道为 source=platform、via=compatible                                 |
| M:src/billing/server/preflight.ts:62–69                                                   | 无冲突合入的 llmSources.every 仍判断 team                                          | 同步余额预检；只修改路由输出会破坏原有组织自带凭证的预检豁免                                           |
| M:src/platform/server/workflow/llm-auth-failure-source.ts:11–12,69–75                     | 新增 401 来源解析只接受 team/platform                                              | 接受组织来源；保留按实际失败调用归因，防止平台渠道故障误伤组织 Key                                     |
| M:src/models/server/db/api-keys.ts:403,427–428                                            | 上游方法已经变为 organizationGatewayKey，二开冲突块仍调用 teamGatewayKey           | 组合组织作用域与二开 resolveLlmKey(model,routingSnapshot)、textChannels 和缓存；不能直接选某一侧整文件 |
| M:src/platform/server/workflow/base-workflow.ts:201–207                                   | 同一冲突同时涉及 organizationId 和 modelConfiguration 快照                         | 创建组织 scopedDb 时保留任务配置快照参数；保留父子任务快照继承                                         |
| M:src/platform/server/db/scoped.ts:482–488                                                | 管理员模型/渠道组合方法位于冲突块                                                  | 保留二开管理员能力及系统级权限边界                                                                     |

无冲突但需要同步的测试实例：

- src/models/server/db/configured-text-routing.test.ts：仍导入 teams、teamApiKeys，写入旧 schema 夹具并期望 team 来源。
- src/platform/server/workflow/client.test.ts、src/platform/server/db/scoped-workflow-models.test.ts、src/models/ai-model-configuration.test.ts：仍使用 teamId 请求或上下文。
- src/sequences/server/workflows/scene-split-output-budget.test.ts：显式工作流输入仍写 teamId。
- src/models/server/watch-clip.test.ts：仍调用 watchClipForTeam；实际生产导出已为 watchClipForOrganization。

上述测试不能通过恢复旧表导出或添加旧字段来迁就；应跟随真实组织接口。未发现这些新增核心配置生产模块在无冲突区直接残留 teamId，生产模块的隐性问题主要是旧 team 来源判别值。

新增配置接口仍使用 systemAdminMiddleware；上游系统管理员继续基于 ADMIN_EMAILS。组织 owner/admin 与平台管理员权限需要区分，不能让组织管理员因此获得平台渠道密钥或全局模型配置写权限。原先二开测试通过的记录不能作为此次合入后的验证证据。

依据对象：M=9e6ce21807c2156c209c18db226e5bc5b7ae0831（含冲突标记，仅作静态检查）；U=6c0e82b2f72ad3ad7369c59dd3698dd454696da7。表内行号属于这些 Git 对象，不是当前工作树。

### 4.3 数据库与 D1 session：高风险

上游 10 组迁移的 snapshot 前驱链连续接上共同基线；未发现本批 SQL 通过重建长期父表重演历史级联清空问题。这个静态结论不等于实际 D1 数据升级通过。

| 迁移目录（drizzle/migrations/ 下）                      | 实际操作                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 20261101153728_rename_teams_to_organization             | 原位重命名 teams 表及业务表的组织列；没有复制重建父表                  |
| 20261102074031_organization_plugin_tables               | 新建 invitation/member，添加组织扩展字段、活动组织和唯一约束           |
| 20261102074046_backfill_member_from_team_members        | 用 user_id 作为 member.id 回填旧成员；joined_at 从秒转毫秒             |
| 20261102134839_active_organization_on_sessions_and_keys | 回填 session.active_organization_id 和 API Key metadata.organizationId |
| 20261103083545_drop_viewer_role                         | 将新旧成员/邀请中的 viewer 改为 member                                 |
| 20261103084207_device_grant_organizations               | 新增设备授权对应组织表                                                 |
| 20261103214907_drop_team_members_and_invitations        | 删除旧邀请和旧成员表                                                   |
| 20261103215701_rename_team_tables_and_indexes           | 重命名组织供应商密钥/账单设置表及相关索引                              |
| 20261104225034_person_in_media                          | 给地点参考图及元素加 personInMedia 标记                                |
| 20261105012604_round_ogun                               | 调整 reconcile 状态/时间索引                                           |

需要逐项核对的现有数据前提：

1. 成员回填（上游 migration.sql:7–16）明确假设“一用户恰好一个组织”，用 user_id 复用 member.id；旧 schema/teams.ts:56–74 仅约束团队内成员唯一。如果现有数据一人有多个团队，初次回填可能主键冲突；已有该用户任一 member 行时，其他关系会被 NOT EXISTS 跳过。尚未读取目标业务数据库，不能声称当前数据已触发或满足该前提。
2. 旧 team_invitations 直接删除（删除迁移:9–10），没有迁入新 invitation 的 SQL。如果存在旧邀请，升级后不会保留这些邀请。
3. viewer→member（对应迁移:9–15）意味着原只读角色获得成员的创建/编辑权限，见上游 organization-access.ts:18–28。本次沿用该上游角色规则，核对实际用户数据并验证权限变化，不为尚未实施的商业规划另改权限模型。

旧 session 和 osk_ Key 有活动组织/metadata 回填路径，但依赖成员回填完整；不能把它们与旧 OAuth JWT 混为一谈。旧 OAuth team_id 不再被读取，API/MCP 需要新的组织授权；已批准但尚未兑换的旧设备 grant 也需复核。

存储方面，新对象写到 org/<id>/…，上游 keyOwner 同时接受旧 teams/<id>/… 和 <id>/…。源码未要求搬迁全部旧 R2 对象；旧素材的实际访问及授权仍待回归。依据：上游 storage/buckets.ts:25–46、upload-target.ts:63–87。

D1 读副本的实际边界：

- session 通过 getDb() 的代理路由 prepare/batch；二开新增 scopedDb 方法继续复用原 Database handle，无需为渠道配置另建连接。
- Workflows/cron 没有 HTTP session，继续走主库；余额、可用余额、卡密兑换等敏感操作显式使用 onPrimary。HTTP session 内写入由 D1 发到主库。
- 浏览器以 d1_bookmark Cookie 延续自己的读写顺序；API Key/Bearer 请求优先 first-primary。上游文档明确接受浏览器 session/成员/密钥撤权传播可能有副本延迟，不能据“非 GET 不用权限 memo”推断所有认证判断都走主库。
- 二开文本渠道写入继续有旧值匹配的条件更新及 batch，未发现可据此认定静默覆盖配置的证据；跨浏览器刚修改的配置可能在另一浏览器旧读后被固化到工作流快照，生效和撤权时效需在副本环境验证。
- 读副本需要逐数据库开启；关闭时仍走主库。本地 Miniflare 没有真实副本，本地测试不能验证跨区性能与传播延迟。

依据：固定上游 docs/architecture/d1-read-replication.md:10–47,56–63、src/platform/server/db/d1-session.ts:25–52；二开 src/models/server/db/text-channels.ts:81–104,128–145。

### 4.4 国际化：中高风险

- 预演树的 src/routes/_app/settings/route.tsx 已自动加入 Organization 标签并走 translateLabel；现有 pages.json 中英文资源都没有 Organization 键。这是 Git 无冲突但会回退英文的确定实例。
- 新增 src/ui/settings/organization-settings.tsx、src/platform/ui/organization-select.tsx、组织接受邀请页面和 src/platform/server/emails/organization-invitation-email.tsx 使用上游英文文案，需接入现有 namespace、语言持久化及邮件语言隔离流程。
- 角色/地点库的 team-* 文件改为 organization-*；4 个库卡片/列表的重命名后文件也进入冲突列表。要保留上游权限与新参数，同时迁移现有 t(...)、错误提示和加载反馈。
- src/ui/i18n/markdown.ts 用完整英文段落匹配 guide 资源；上游文档将 team 术语改成 organization 并调整链接，新段落与旧键不相同，会回退英文。不能只检查页面 JSX。
- 场景 Chat about this 入口新增图标、可见标签及 aria-label。解决冲突时同时核对可见文字和无障碍文案，不保留重复按钮文字。

### 4.5 项目配置与文档：低至中风险

- 独立 .codex、.agents/skills 和语言资源目录大多可以保留；它们没有为本次上游重命名自动更新。
- 例如 .agents/skills/react-patterns/SKILL.md 仍引用 use-team-locations.ts、team-locations.fn.ts；.codex/agents/qa-lead-tester.toml 仍使用 userId/teamId 测试上下文描述。合入后需同步具体路径和契约。
- 二开 README 与架构文档里的上游基线只在实际完成合并后更新；本次评估继续保持原基线。

## 5. 推荐的处理顺序

1. 从 develop 建独立集成分支/工作树，保留二开提交历史，完整合入上游 main；以继承上游组织、权限和数据模型为原则处理冲突。
2. 优先整合组织认证、中间件、scopedDb、工作流快照与模型凭证调用链，再解决页面和文档冲突。保留二开默认模型/文本渠道能力。
3. 检查 Git 自动合入的二开新增模块、测试和配置，修复旧接口引用；再补新页面、新错误和邀请邮件的中英文资源。
4. 在隔离的本地数据副本核对迁移、数据保留、成员角色映射、余额/账本归属和旧媒体可读性。不得把空数据库启动成功当成已有数据升级通过。
5. 通过类型、lint、格式、边界检查、针对性 Vitest 及构建，再做浏览器与本地工作流回归。
6. 按实际合入 SHA 更新二开基线、侵入接入点和待验收记录；通过对应验收后再安排部署。

当前建议是完整同步上游 main，保留其组织迁移主线和现有产品行为。冲突处理中保留已实现的中英国际化、管理员模型配置和文本渠道扩展，以适配上游接口和薄桥接为主，尽量缩小相对于 main 的功能分歧。

以下单项补丁预演仅作为已完成的技术对比记录，不作为本次同步方案：已用指定父提交作为 merge-base 额外预演两个单项补丁：#2225 的图标调整仍有 3 个文件冲突；#2241 的上传确认修复有 2 个文件冲突（docs/architecture/byteplus-ark.md、src/cast/ui/element/element-selector.tsx）。这只是三方文本适用性评估，未实际 cherry-pick，也未完成这些补丁的类型或行为验证。

## 6. 后续验证范围（本次尚未执行）

| 验证面       | 至少覆盖                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| 数据升级     | 已有数据迁移、FK 完整性、用户/组织/成员、钱包/账本/预占归属、模型配置与文本渠道配置保留      |
| 登录/权限    | 新注册、旧账号、活动组织、移除成员后的会话、普通成员/组织管理员/平台管理员的差异             |
| 二开文本模型 | 默认模型、候选/绑定、Chat Completions/Responses mock、密钥不回显、路由快照、失败路径         |
| 创作工作流   | userId/organizationId、claim、在途任务策略、失败回收、素材写入路径、旧媒体读取               |
| D1 sessions  | 请求内写后读、跨请求 bookmark、组织/用户切换隔离、跨浏览器配置与撤权生效；实际副本可用性另验 |
| 国际化       | 新组织相关路由、切语言/刷新/SSR、邀请邮件 mock、中英文帮助文档、手机与键盘操作               |
| 上游修复     | 并发素材确认、真人素材 Ark 注册 mock、改名拒绝、助手编辑未使用角色、页面读取批处理           |

整体按独立升级任务排期；56 个冲突文件只是可见的文本工作量，后续接口适配与已有数据验收是额外工作。没有实际消除冲突前，不承诺精确工时或完成时间。

## 7. 56 个冲突文件完整清单

以下按预演结果列出；重命名文件使用预演后的上游新路径。

### 文档（3）

```text
docs/architecture/media-vias.md
docs/architecture/oauth-server.md
docs/architecture/public-api-internals.md
```

### 服务端与领域逻辑（18）

```text
src/assistant/server/assistant-chat.ts
src/cast/sequence-elements.fn.ts
src/models/server/db/api-keys.ts
src/models/server/watch-clip.ts
src/platform/server/api-v1/create.ts
src/platform/server/api-v1/input-schema.ts
src/platform/server/auth/config.ts
src/platform/server/db/scoped.ts
src/platform/server/workflow/base-workflow.ts
src/platform/server/workflow/llm-auth-failure.ts
src/sequences/sequences.fn.ts
src/sequences/server/create-sequences.ts
src/sequences/server/script-enhancement.ts
src/sequences/server/smart-retry.ts
src/sequences/server/workflows/scene-split-workflow.ts
src/shots/server/shot-preview.ts
src/studio/server/studio-asset-actions.ts
src/studio/server/studio-prompt-draft.ts
```

### 页面与UI（30）

```text
src/assistant/ui/assistant-panel.tsx
src/cast/ui/character-library/delete-character-button.tsx
src/cast/ui/character-library/organization-character-card.tsx
src/cast/ui/character-library/organization-character-list.tsx
src/cast/ui/element/element-selector.tsx
src/cast/ui/location-library/delete-location-button.tsx
src/cast/ui/location-library/new-location-dialog.tsx
src/cast/ui/location-library/organization-location-card.tsx
src/cast/ui/location-library/organization-location-list.tsx
src/cast/ui/locations/location-picker-dialog.tsx
src/models/ui/pickers/motion-model-selector.tsx
src/routes/_app/admin/moderation.tsx
src/routes/_app/admin/usage.tsx
src/routes/_app/characters/$id.tsx
src/routes/_app/characters/index.tsx
src/routes/_app/device.tsx
src/routes/_app/locations/$locationId.tsx
src/routes/_app/locations/index.tsx
src/routes/_app/oauth/consent.tsx
src/sequences/ui/eval/eval-toolbar.tsx
src/sequences/ui/eval/sequence-gallery.tsx
src/sequences/ui/script/script-view.tsx
src/sequences/ui/theatre/publish-dialog.tsx
src/sequences/ui/use-generation-settings.ts
src/shots/ui/canvas-view-toggle.tsx
src/shots/ui/scene-canvas.tsx
src/shots/ui/scenes-view.tsx
src/ui/settings/api-key-settings.tsx
src/ui/settings/billing-settings.tsx
src/ui/settings/gift-code-settings.tsx
```

### 测试（5）

```text
src/cast/server/talent/analyze-talent-media.test.ts
src/platform/server/workflow/await-child.test.ts
src/sequences/server/script-enhancement.test.ts
src/sequences/server/workflows/analyze-script-workflow.test.ts
src/sequences/smart-retry.test.ts
```

## 8. 复核方法与本次证据

已执行：git fetch upstream --prune；git merge-base；git rev-list --left-right --count；双方 diff/log；git merge-tree --write-tree；上游最新 main 的 ls-remote 复核；对指定 Git 对象读取源文件和迁移。

合并预演命令（对固定提交，避免远程分支后续变化影响复核）：

```powershell
git merge-tree --write-tree df55c35a4a4a3a357f80f82b097fc3e466989d4c 6c0e82b2f72ad3ad7369c59dd3698dd454696da7
```

预演返回码为 1（有冲突）；生成的树对象为 9e6ce21807c2156c209c18db226e5bc5b7ae0831。git merge-tree 写入的仅为 Git 对象，没有创建 merge commit 或修改分支。该树含冲突标记，不能当作可运行的集成版本。

本地原始证据目录：.tmp/upstream-merge-assessment-20261105/。其中保存 facts.json、merge-tree.txt、双方文件清单、上游提交清单与单项补丁预演。该目录属于临时证据，固定提交与上述复核命令才是可复现依据。

按仓库约定执行了 intent list，并加载 drizzle-kit#drizzle；本地安装的指南 revision 为 12，已加载版本也为 12。未更新或生成数据库文件。

没有运行合并后 typecheck、测试、构建、浏览器、Workerd/D1 数据升级、真实供应商或 Cloudflare 部署验收；这些结论仅支持合并规划和风险判断。
