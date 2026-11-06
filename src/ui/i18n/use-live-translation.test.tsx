import type { i18n as I18n, TFunction } from 'i18next';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { expect, it } from 'vitest';
import { createApplicationI18n } from './runtime';
import { useLiveTranslation } from './use-live-translation';

function captureTranslator(instance: I18n) {
  const captured: TFunction<'shots'>[] = [];
  function Capture() {
    captured.push(useLiveTranslation('shots'));
    return null;
  }
  renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <Capture />
    </I18nextProvider>
  );
  const translate = captured[0];
  if (!translate) throw new Error('Test did not capture a translator');
  return translate;
}

it('keeps its identity across real language wrapper replacements', () => {
  const instance = createApplicationI18n();
  const calls: {
    translate: TFunction<'shots'>;
    wrapper: I18n;
    text: string;
  }[] = [];
  function Probe() {
    const translate = useLiveTranslation('shots');
    const { i18n: wrapper } = useTranslation('shots');
    const [step, setStep] = useState(0);
    calls.push({
      translate,
      wrapper,
      text: translate('Music track uploaded'),
    });
    // Render-phase updates retain real hook state without a DOM dependency.
    if (step < 2) {
      void instance.changeLanguage(step === 0 ? 'en' : 'zh-CN');
      setStep(step + 1);
    }
    return null;
  }
  renderToStaticMarkup(
    <I18nextProvider i18n={instance}>
      <Probe />
    </I18nextProvider>
  );
  expect(calls.map(({ text }) => text)).toEqual([
    '配乐已上传',
    'Music track uploaded',
    '配乐已上传',
  ]);
  expect(calls[1]?.wrapper).not.toBe(calls[0]?.wrapper);
  expect(calls[2]?.wrapper).not.toBe(calls[1]?.wrapper);
  expect(calls[1]?.translate).toBe(calls[0]?.translate);
  expect(calls[2]?.translate).toBe(calls[0]?.translate);
});

it('uses the completion language for an event registered before the switch', async () => {
  const instance = createApplicationI18n();
  const translate = captureTranslator(instance);
  const completions: Array<() => void> = [];
  const pending = new Promise<void>((resolve) => completions.push(resolve));
  const notification = pending.then(() => translate('Music track uploaded'));
  expect(translate('Music track uploaded')).toBe('配乐已上传');
  await instance.changeLanguage('en');
  completions.forEach((complete) => complete());
  expect(await notification).toBe('Music track uploaded');
});

it('isolates retained callbacks between SSR request instances', async () => {
  const chinese = createApplicationI18n();
  const english = createApplicationI18n('en');
  const translateChinese = captureTranslator(chinese);
  const translateEnglish = captureTranslator(english);
  expect(translateChinese('Music track uploaded')).toBe('配乐已上传');
  expect(translateEnglish('Music track uploaded')).toBe('Music track uploaded');
  await english.changeLanguage('zh-CN');
  await chinese.changeLanguage('en');
  expect(translateChinese('Music track uploaded')).toBe('Music track uploaded');
  expect(translateEnglish('Music track uploaded')).toBe('配乐已上传');
});

it('refreshes the translator when the requested namespace changes', () => {
  const callbacks: unknown[] = [];
  function Probe() {
    const [namespace, setNamespace] = useState<'shots' | 'cast'>('shots');
    callbacks.push(useLiveTranslation(namespace));
    if (namespace === 'shots') setNamespace('cast');
    return null;
  }
  renderToStaticMarkup(
    <I18nextProvider i18n={createApplicationI18n()}>
      <Probe />
    </I18nextProvider>
  );
  expect(callbacks).toHaveLength(2);
  expect(callbacks[1]).not.toBe(callbacks[0]);
});
