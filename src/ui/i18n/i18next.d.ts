import 'i18next';
import type { applicationResources } from './resources';

type ApplicationNamespaces = (typeof applicationResources)['en'];

declare module 'i18next' {
  interface ResourceNamespaceMap extends ApplicationNamespaces {}
}
