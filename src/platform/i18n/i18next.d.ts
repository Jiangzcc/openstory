import 'i18next';
import type { resources } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    keySeparator: false;
    nsSeparator: false;
    returnNull: false;
    strictKeyChecks: true;
    resources: (typeof resources)['en'];
  }
}
