import { eventEdits, projectPath } from './hook-utils.mjs';
import { commandWarnings, isRemoteCommand } from './command-policy.mjs';
import { shellCommands } from './shell-commands.mjs';

const SOURCE_FILE = /\.(?:ts|tsx|js|jsx)$/;
const MIGRATION_SQL = /^drizzle\/migrations\/.+\/migration\.sql$/;
const MIGRATION_METADATA =
  /^drizzle\/migrations\/(?:meta\/|.+\/snapshot\.json$)/;
const SQL_UPDATE_SCAN_CHARACTERS = 600;
const SQL_COALESCE_SCAN_CHARACTERS = 400;
const UNSAFE_SQL = [
  /\b(?:NOT\s+)?EXISTS\s*\(\s*SELECT/i,
  /\bDROP\s+TABLE\b/i,
  /__new_/i,
  new RegExp(
    '\\bUPDATE[^;]{0,' + SQL_UPDATE_SCAN_CHARACTERS + '}=\\s*\\(\\s*SELECT',
    'i'
  ),
  new RegExp(
    '\\bCOALESCE\\s*\\([^;]{0,' +
      SQL_COALESCE_SCAN_CHARACTERS +
      '}\\(\\s*SELECT',
    'i'
  ),
];
export const MIGRATION_CHECK_REMINDER =
  '生成迁移后，运行 bun scripts/check-migrations.ts <新迁移的 migration.sql>，检查 D1 安全性；这不代表迁移已应用。';

function editPolicy(edit, cwd) {
  const file = projectPath(edit.path, cwd);
  if (!file) return { warnings: [], denial: undefined };
  const text = edit.added.join('\n');
  const warnings = [];
  if (MIGRATION_METADATA.test(file.relative)) {
    warnings.push(
      '不要手工改写迁移 journal/snapshot；使用 bun db:generate 生成。'
    );
  }
  if (edit.deleted) return { warnings, denial: undefined };
  if (SOURCE_FILE.test(file.relative) && /\.transaction\s*\(/.test(text)) {
    return {
      warnings,
      denial:
        'D1 不支持 db.transaction() 交互事务；使用现有 scoped-db 的 D1 batch/条件写入模式。',
    };
  }
  if (
    MIGRATION_SQL.test(file.relative) &&
    UNSAFE_SQL.some((pattern) => pattern.test(text))
  ) {
    return {
      warnings,
      denial:
        '迁移 SQL 命中原有 D1 风险规则；检查相关子查询、DROP TABLE 或 __new_ 重建，并阅读 AGENTS.md 的 D1 迁移约定。',
    };
  }
  if (SOURCE_FILE.test(file.relative) && /\bas\s+\w/.test(text))
    warnings.push(
      '新增内容含 as：检查是否为绕过类型检查的断言，优先修正源类型或使用 satisfies/类型守卫。'
    );
  return { warnings, denial: undefined };
}

export function evaluatePreToolUse(event) {
  if (event.tool_name === 'Bash') {
    const commands = shellCommands(event.tool_input.command);
    return {
      warnings: [
        ...new Set(
          commands.flatMap((words) => commandWarnings(words, event.cwd))
        ),
      ],
      denial: commands.some((words) => isRemoteCommand(words))
        ? '原项目规则禁止智能体直接写远程 D1 或执行远程部署；只读查询和本地操作可继续。'
        : undefined,
    };
  }
  const results = eventEdits(event).map((edit) => editPolicy(edit, event.cwd));
  return {
    warnings: [...new Set(results.flatMap((result) => result.warnings))],
    denial: results.find((result) => result.denial)?.denial,
  };
}
