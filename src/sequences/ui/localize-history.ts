import type { i18n as I18n } from 'i18next';
import { translateStaticLabel } from '@/platform/i18n/labels';
import { HISTORY_SUMMARY_TEMPLATES } from './history-summary-templates';
import type { HistorySummaryKey } from './history-summary-templates';

const PARAMETER = /({{value\d+}})/g;
const escapePattern = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compileTemplate(template: HistorySummaryKey) {
  const parameters: string[] = [];
  const pattern = template
    .split(PARAMETER)
    .map((part) => {
      if (!part.startsWith('{{')) return escapePattern(part);
      parameters.push(part.slice(2, -2));
      return '(.*?)';
    })
    .join('');
  return {
    template,
    parameters,
    pattern: new RegExp(`^${pattern}$`, 's'),
    greedyPattern: new RegExp(`^${pattern.replaceAll('(.*?)', '(.*)')}$`, 's'),
  };
}

const templates = new Map(
  Object.entries(HISTORY_SUMMARY_TEMPLATES).map(([kind, sources]) => [
    kind,
    sources.map(compileTemplate),
  ])
);

function matchSummary(
  candidate: ReturnType<typeof compileTemplate>,
  summary: string
) {
  const match = candidate.pattern.exec(summary);
  if (!match) return undefined;
  const greedy = candidate.greedyPattern.exec(summary);
  return match.every((value, index) => value === greedy?.[index])
    ? match
    : undefined;
}

function localizeSingleSummary(i18n: I18n, kind: string, summary: string) {
  for (const candidate of templates.get(kind) ?? []) {
    const match = matchSummary(candidate, summary);
    if (!match) continue;
    const values = Object.fromEntries(
      candidate.parameters.map((name, index) => [name, match[index + 1] ?? ''])
    );
    if (
      (kind === 'run.failed' && candidate.template === '{{value1}} failed') ||
      candidate.template === 'Changed where generation stops to {{value1}}'
    ) {
      values.value1 = translateStaticLabel(
        i18n,
        'history',
        values.value1 ?? ''
      );
    }
    return i18n.t(candidate.template, { ns: 'history', ...values });
  }
  return undefined;
}

export function localizeHistorySummary(
  i18n: I18n,
  kind: string,
  summary: string
) {
  if (kind !== 'sequence.settings-changed') {
    return localizeSingleSummary(i18n, kind, summary) ?? summary;
  }
  const sentences = summary.split(
    /\. (?=Changed (?:the (?:style|image model|video model|music model|analysis model)|aspect ratio|where generation stops))/
  );
  const localized = sentences.map((sentence) =>
    localizeSingleSummary(i18n, kind, sentence)
  );
  if (localized.some((sentence) => sentence === undefined)) return summary;
  return localized.reduce<string>(
    (previous, next) =>
      previous
        ? i18n.t('{{previous}}. {{next}}', { ns: 'history', previous, next })
        : (next ?? ''),
    ''
  );
}

export function localizeHistoryTarget(i18n: I18n, label: string) {
  const shot = /^Shot (\d+)$/.exec(label);
  if (shot)
    return i18n.t('Shot {{number}}', { ns: 'history', number: shot[1] });
  const scene = /^Scene (\d+)$/.exec(label);
  if (scene)
    return i18n.t('Scene {{number}}', { ns: 'history', number: scene[1] });
  return translateStaticLabel(i18n, 'history', label);
}
