import { readFileSync } from 'node:fs';

export function rejectWorkflowTriggers(source: string): string | null {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^["']?on["']?\s*:/.test(line));
  if (start === -1) {
    return "could not locate top-level 'on:' block — unsupported YAML format";
  }
  const block = lines.slice(start, start + 1);
  for (const line of lines.slice(start + 1)) {
    if (/^[a-zA-Z"']/.test(line)) break;
    block.push(line);
  }
  const triggers = block
    .map((line) => line.replace(/[ \t]*#.*$/, ''))
    .join('\n');
  return triggers.includes('pull_request_target')
    ? 'pull_request_target trigger is not allowed in this repo.'
    : null;
}

function main() {
  let violations = 0;
  for (const file of process.argv.slice(2)) {
    try {
      const reason = rejectWorkflowTriggers(readFileSync(file, 'utf8'));
      if (!reason) continue;
      console.error(`ERROR ${file}: ${reason}`);
    } catch (error) {
      console.error(`ERROR ${file}: could not read workflow`, error);
    }
    violations++;
  }
  if (violations > 0) process.exitCode = 1;
}

if (import.meta.main) main();
