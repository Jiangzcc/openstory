import type { StyleConfig } from '@/look/style-config';

export const AUTO_STYLE_FALLBACKS_ZH_CN = {
  look: {
    mood: '质朴、自然',
    artStyle: '写实真人影像',
    lighting: '符合场景光源的自然光线',
    colorGrading: '中性、忠于真实',
  },
  motion: { camera: '稳定、经典的镜头覆盖' },
} satisfies {
  look: Pick<
    StyleConfig['look'],
    'mood' | 'artStyle' | 'lighting' | 'colorGrading'
  >;
  motion: Pick<StyleConfig['motion'], 'camera'>;
};
