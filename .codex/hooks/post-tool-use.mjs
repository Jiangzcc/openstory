import { formatEditedFiles } from './format-files.mjs';
import { readEvent, report, reportFailure } from './hook-utils.mjs';
import { MIGRATION_CHECK_REMINDER } from './policies.mjs';
import { isGenerateCommand } from './command-policy.mjs';
import { shellCommands } from './shell-commands.mjs';

async function main() {
  const event = await readEvent();
  if (event.tool_name === 'Bash') {
    const warnings = shellCommands(event.tool_input.command).some(
      isGenerateCommand
    )
      ? [MIGRATION_CHECK_REMINDER]
      : [];
    report('PostToolUse', warnings);
    return;
  }
  formatEditedFiles(event);
  report('PostToolUse', []);
}

main().catch(reportFailure);
