import type { i18n as I18n } from 'i18next';
import { REFERENCE_PROBLEM_TEMPLATES } from './reference-problem-templates';

const PARAMETER = /({{[a-z]+}})/g;
const escapePattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compileTemplate(
  template: (typeof REFERENCE_PROBLEM_TEMPLATES)[number]
) {
  const parameters: string[] = [];
  const pattern = template
    .split(PARAMETER)
    .map((part) => {
      if (!part.startsWith('{{')) return escapePattern(part);
      const name = part.slice(2, -2);
      const existing = parameters.indexOf(name);
      if (existing >= 0) return '\\' + (existing + 1);
      parameters.push(name);
      return '(.*?)';
    })
    .join('');
  return {
    template,
    parameters,
    pattern: new RegExp('^' + pattern + '$', 's'),
    greedyPattern: new RegExp(
      '^' + pattern.replaceAll('(.*?)', '(.*)') + '$',
      's'
    ),
  };
}

const templates = REFERENCE_PROBLEM_TEMPLATES.map(compileTemplate);

export function localizeReferenceProblem(i18n: I18n, message: string): string {
  for (const candidate of templates) {
    const match = candidate.pattern.exec(message);
    if (!match) continue;
    const greedy = candidate.greedyPattern.exec(message);
    if (!match.every((value, index) => value === greedy?.[index])) continue;
    const values = Object.fromEntries(
      candidate.parameters.map((name, index) => [name, match[index + 1]])
    );
    return i18n.t(candidate.template, { ns: 'motion', ...values });
  }
  return message;
}
