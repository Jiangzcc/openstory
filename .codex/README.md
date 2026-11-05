# OpenStory 的 Codex 项目配置

2026-11-05 将本仓库 .claude 下的角色、技能、规则与编辑后检查转换为 Codex 项目配置。原 .claude 仅作为只读来源，未搬走、修改或删除；所有新增配置只放在本仓库，不写入用户全局目录。

本次只改变开发助手配置，没有实施或验证新的业务能力。

## 入口与作用范围

- 根 AGENTS.md：沿用项目架构和二开约定，增加本目录入口，并把 React 的旧 suspense: true 表述与迁移技能同步为 useSuspenseQuery。
- .codex/config.toml：只将项目指令预算设为 65536 字节。根 AGENTS.md 原来约 56 KiB，超过默认的 32 KiB；不改模型、沙箱、审批、MCP 或全局配置。
- .codex/project-rules.md：迁移规则的可读说明，含现行用户质量要求与数据库边界。
- .codex/agents/*.toml：7 个项目自定义智能体，继承父会话的模型、推理配置和权限。
- .agents/skills/*/SKILL.md：项目技能的标准发现位置。
- .codex/hooks.json 与 .codex/hooks/*.mjs：项目生命周期检查。
- .codex/rules/project.rules：命令规则，禁止使用 bun tsc / bun run tsc，提示使用 tsgo。

## 智能体

| 名称                    | 分工                           |
| ----------------------- | ------------------------------ |
| product-lead            | 需求、业务范围与验收条件       |
| engineering-lead        | 跨领域任务拆分、集成与工程交付 |
| backend-tech-lead       | 服务端架构、数据与工作流边界   |
| backend-engineer        | 服务端功能、根因修复与相关验证 |
| frontend-architect      | 前端分层、路由、状态与组件边界 |
| frontend-react-engineer | 现有 UI 的实现、修复与交互验证 |
| qa-lead-tester          | 风险分析、测试执行与验收证据   |

例如可以要求 Codex：“让 backend-engineer 检查这个接口，再让 qa-lead-tester 验证修复。”智能体仍受当前任务授权及其明确写范围约束；不因角色存在就强制使用七个智能体。

原角色中的 2 个 model: inherit 和 5 个 model: sonnet 统一改为继承 Codex 父会话，不绑定新的模型。

原角色中旧的 Next.js / PostgreSQL / Supabase / Prettier 偏好已替换为本项目实际的 TanStack Start、Workerd、D1、Drizzle、scopedDb、oxlint、oxfmt 与 Vitest 边界；移除了不适用的无条件 TDD、每函数测试和顺手优化要求。

## 技能

| 技能                  | 来源与处理                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| react-patterns        | 从 .claude/skills/react-patterns 迁移，核对现行 React 与 TanStack Query 调用                                             |
| update-model-versions | 从 .claude/skills/update-model-versions 迁移，核对当前路径、脚本与工具能力                                               |
| sd25-pe               | 原 .claude/skills/sd25-pe 指向 ../../.agents/skills/sd25-pe；目标本来就在 Codex 项目技能目录，直接复用，不重复复制或修改 |

可通过 $react-patterns、$update-model-versions、$sd25-pe 明确调用，也允许 Codex 根据技能描述自动选择。技能不会默认运行付费模型探测、提交、推送或远程部署。

## 规则与 hooks 映射

| 原配置                                     | Codex 处理                                                            |
| ------------------------------------------ | --------------------------------------------------------------------- |
| hooks/check-ripgrep.sh                     | PreToolUse 提醒优先 rg，保留工具不可用时的替代方式                    |
| hooks/format-lint.sh                       | PostToolUse 从 apply_patch 提取文件，调用本地 oxfmt 与 oxlint --fix   |
| block-remote-db-ops                        | PreToolUse 拒绝匹配的远程写入/部署；保留远程 SELECT 与本地操作        |
| block-db-transaction                       | 拒绝在源码新增 .transaction( 调用，遵循 D1 约束                       |
| block-d1-unsafe-migration-sql              | 拒绝迁移文件新增匹配的风险 SQL                                        |
| block-migration-edits                      | 提醒不要手改 journal/snapshot，保持原 action: warn                    |
| block-migration-bash                       | 提醒 shell 中的元数据改写/迁移目录删除，补充 PowerShell 形式          |
| no-as-casts                                | 提醒源码中的 as 文本，保持提醒而非无条件拒绝                          |
| warn-run-check-migrations-after-generate   | 生成命令之后提醒运行现有 check-migrations.ts                          |
| settings.json 的 deny: bun tsc             | 转为项目 .rules 命令拒绝规则                                          |
| settings.json 的 allow / ask / defaultMode | 不照搬为 Codex 权限；迁移命令的授权约定写入项目规则，继承当前会话权限 |

Hooks 使用 Node.js（本机验证为 22.22.2；matchesGlob 需要 22.20 或更高版本）、Git 与已经安装的项目依赖，不依赖 Bash/jq。启动路径通过 Git 根目录解析，在子目录打开会话也能找到脚本。所有脚本和调用均位于当前项目；不需要设置 CODEX_HOME。

原 hooks 的双次读取 stdin、只识别 Write/Edit.file_path、Bash 特定调用方式不能直接用于 Codex，因此做了协议与运行时适配。命令按引号与分隔符拆分，将参数关联到实际程序，并读取当前 package.json 中的脚本别名；SQL 检查仍是保守文本启发式，不是完整 shell/SQL 解释器；其他文件写入工具、任意脚本封装不保证会被拦截，PostToolUse 也无法撤销操作。

原远程规则把 drizzle.config.d1.ts 的普通读取或本地生成也当作远程写入；当前仅对实际 migrate/push 使用该配置的命令拒绝。本地 generate、远程 SELECT 中的普通字符串、搜索或输出脚本名称不会因此被误判。复合命令逐条检查，Windows 的 .exe/.cmd 入口统一识别；元数据相对路径按事件 cwd 解析。

远程 D1 的 SQL 检查按顶层语句和 CTE 后的主操作区分读写，SELECT 中的 REPLACE()、引号内容和注释不会当作写入；多语句中的实际写入仍会被拒绝。Windows 路径比较先规范化等价的扩展盘符和 UNC 路径，仓库外路径仍会被排除。

## 生效方式

1. 在这个仓库重新打开 Codex 会话，使新的项目配置、智能体和技能被发现。
2. 若项目配置层被标记为未信任，在 Codex 正常项目提示中信任当前仓库。
3. 在 Codex 的 Review hooks / 设置中的 Hooks，或 CLI 的 /hooks，查看并信任这两个项目 hook。非托管 hook 未经信任会跳过；脚本自测通过不代表桌面会话已经启用。
4. 按任务需要调用技能或角色，规则仍以现行用户要求、AGENTS.md 和实际会话权限为准。

不修改 Codex 的信任记录，不自动信任其他项目或用户全局 hooks。

## 启动配置与 MCP 的差异

.claude/launch.json 的启动命令为 bun dev，应用端口为 3000。Codex 的项目本地环境可在桌面设置中创建一个运行 bun dev 的 action。官方页面未提供可据此验证的 launch.json 等价文件结构，本次不臆造可自动加载的启动文件；可直接在项目终端执行 bun dev。该命令会初始化环境并进行本地迁移/seed，本次未执行。

settings.json 中出现的 Context7、Chrome DevTools、fal 工具名称只是 Claude 权限条目，没有提供可迁移的 MCP 服务器地址、认证或实现。技能使用当前会话可用的文档搜索、浏览器和模型服务能力；未创建虚假 MCP 注册，也没有扩大外部操作授权。

## 验证

从仓库根目录执行：

```powershell
bun run test --config .codex/hooks/vitest.config.mjs
codex execpolicy check --pretty --rules .codex/rules/project.rules -- bun tsc --noEmit
codex execpolicy check --pretty --rules .codex/rules/project.rules -- bun typecheck
```

测试覆盖远程写入拒绝、远程只读/本地命令放行、迁移 SQL 与交互事务、元数据提醒、重命名/删除、忽略文件、子目录路径、目录外路径、复合命令、脚本名只读搜索、Windows 启动器、环境变量前缀和真实本地格式化/lint。测试只在项目内创建并清理自己的临时夹具，不执行其中表示的数据库或部署命令。

本次实际验证结果：

- Hooks 的 122 项 Vitest 测试通过，其中包含真实本地 oxfmt/oxlint 与 Windows 子目录启动链路。
- 项目 TOML、7/7 智能体字段与 hooks JSON 结构通过；两个迁移技能均通过 quick_validate.py（Windows 使用 python -X utf8）。
- 迁移文件的 oxfmt 检查通过；10 个 hook JavaScript 文件的 oxlint 检查为 0 条诊断。
- Codex execpolicy 引擎确认 bun tsc 被拒绝，bun typecheck 无本项目拒绝规则命中。
- 原 .claude 的 21 个文件及既有 sd25-pe 的 SHA-256 未变；迁移开始时已存在的 97 个受 Git 跟踪改动文件内容未变。
- 新增脚本 AST 检查：最大函数 34 行、圈复杂度 10、嵌套 2 层，符合本项目限制。
- CLI 的 app-server --strict-config --print-startup-config 探测在项目目录和父目录基线均返回 startup configuration unavailable，因此没有把它记作运行时加载验证通过。

配置格式、技能结构和原 .claude 内容校验与这些测试一起执行。桌面新会话的实际发现与 hook 信任仍待在用户界面确认；没有运行全应用构建、业务测试、模型请求、数据库迁移或部署。

## 上游同步

新增内容主要在独立的 .codex 与 .agents/skills 目录；根 AGENTS.md 仅加入迁移入口和 React 规则的一处同步修正。合入上游时保留这些接入点，比较原 .claude 角色/技能的新变化，再按实际需要更新 Codex 副本；本次没有建立自动双向同步。

## 官方依据

- https://learn.chatgpt.com/docs/agent-configuration/subagents
- https://learn.chatgpt.com/docs/agent-configuration/agents-md
- https://learn.chatgpt.com/docs/hooks
- https://learn.chatgpt.com/docs/agent-configuration/rules
- https://learn.chatgpt.com/docs/environments/local-environment
- https://developers.openai.com/api/reference/cli
