import { readEvent, report, reportFailure } from './hook-utils.mjs';
import { evaluatePreToolUse } from './policies.mjs';

async function main() {
  const result = evaluatePreToolUse(await readEvent());
  report('PreToolUse', result.warnings, result.denial);
}

main().catch(reportFailure);
