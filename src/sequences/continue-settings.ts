import type { GenerationStage } from './pipeline';

export type ContinueSettings = {
  generationStopAt: GenerationStage;
  generateStartFrames: boolean;
  generateVoices: boolean;
  draftMotion: boolean;
};
