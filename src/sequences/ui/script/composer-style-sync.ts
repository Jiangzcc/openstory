export type ComposerStyleLocation = {
  style?: string;
  prefill?: 'style';
};

export type ComposerStyleSync = {
  target: string;
  source: ComposerStyleLocation | null;
};

export function resolveComposerStyleSync(
  sync: ComposerStyleSync | null,
  location: ComposerStyleLocation
): { isSelfSync: boolean; sync: ComposerStyleSync | null } {
  if (!sync) return { isSelfSync: false, sync: null };
  if (location.style === sync.target && location.prefill === 'style') {
    return { isSelfSync: true, sync: { ...sync, source: null } };
  }
  if (
    sync.source &&
    location.style === sync.source.style &&
    location.prefill === sync.source.prefill
  ) {
    return { isSelfSync: true, sync };
  }
  return { isSelfSync: false, sync: null };
}
