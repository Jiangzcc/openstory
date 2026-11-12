# Codex 项目规则

这些规则由本仓库的 Claude 配置迁移而来，只约束当前项目。现行用户要求和根目录 AGENTS.md 优先；规则文件不会扩大任务范围、执行权限或外部操作授权。

## 代码修改

- 从原始需求和根因出发；有影响实现选择的歧义时先讨论，不自行二选一。
- 页面负责展示，逻辑放在项目现有 service、纯逻辑或 hook 层，请求遵循现有 API / Start server fn 边界；不另建一套调用体系。
- 保持最小 diff；重构保持外部行为，一次只拆一个职责，不顺手优化。
- 不伪造接口、方法或字段；mock 必须标明。测试围绕有意义的行为与风险，遵循本任务的验证要求。
- 类型断言不能替代源类型修复。优先使用真实类型、类型守卫、泛型或 satisfies；原有 as 检查只是文本提醒，不是 TypeScript AST 检查。
- 搜索优先使用 rg；不可用时可使用其他工具。测试使用 bun run test，类型检查使用 bun typecheck（tsgo）。
- Git 提交不添加 AI 或工具署名。迁移本身不构成提交、推送、开 PR 或给他人发送消息的授权。

## D1 与迁移

- D1 不支持 db.transaction() 的交互事务。遵循现有 scoped-db、D1 batch、条件更新和唯一约束模式；普通顺序查询不能冒充原子事务。
- schema / auth schema / SQL / scopedDb 的边界及特殊迁移流程以根 AGENTS.md 为准。
- journal 与 snapshot 由 drizzle-kit 生成，不手工编辑；恢复或删除历史迁移需要明确任务授权，已有授权不重复询问。
- 当前存在的生成命令是 bun db:generate；原 Hookify 文案的 bun db:generate:local 不是当前 package.json 的脚本。
- 生成后只在需要回填时编辑 migration.sql；执行 bun scripts/check-migrations.ts <migration.sql>，并完成对应环境验证。
- 原有 D1 风险 SQL 拒绝规则仍保守匹配相关子查询、DROP TABLE、__new_ 重建等内容。根 AGENTS.md 记载的特殊重建流程不因迁移被删除；确需执行时应按该流程准备证据，并在 Codex 的 Hooks 界面审查自动检查是否适用，不偷偷绕过。
- 远程 D1 写入和部署保留原有拒绝规则，远程只读查询与本地操作不因此被禁止。本任务不执行迁移、部署或真实模型调用。
- Claude 的 allow / ask 列表不会直接变成 Codex 的全局或项目沙箱授权；需要迁移执行时先确认任务授权与当前 Codex 权限，不反复索取已明确给出的授权。

## Hooks 的边界

原 Hookify 的 action: warn 保持提醒语义，action: block 保持拒绝语义。数据库及类型文本检查只针对对应源码或迁移文件，避免把说明文档中的示例当成实际调用。

原 Bash/jq hooks 已改为项目内 Node 脚本，适配 Codex 的 Bash / apply_patch 事件。格式化仅处理本次 patch 涉及的现存 ts/tsx/js/jsx 文件，遵守 .oxfmtrc.json 的忽略项，并复用本地 oxfmt / oxlint，不联网下载工具。

Hook 只解析常见命令引号、分隔符和项目脚本，不是完整 shell/SQL 解释器，也不覆盖通过任意脚本、MCP 或其他文件工具进行的写入；不要把它当成数据库权限隔离。PostToolUse 无法撤销已发生的操作。项目与 hooks 需要受 Codex 信任后才会运行，配置文件存在不等于当前会话已加载。
