import type { ComponentDef } from './types.js';
import { textSlam } from './text-slam.js';
import { keywordPop } from './keyword-pop.js';
import { strikeChecklist } from './strike-checklist.js';
import { lowerThird } from './lower-third.js';
import { iconCards } from './icon-cards.js';
import { stepCard } from './step-card.js';
import { endCard } from './end-card.js';
import { captionTrack } from './caption-track.js';
import { numberCounter } from './number-counter.js';
import { whipTransition } from './whip-transition.js';
import { glowSweep } from './glow-sweep.js';

export const COMPONENTS: Record<string, ComponentDef> = {
  'text-slam': textSlam,
  'keyword-pop': keywordPop,
  'strike-checklist': strikeChecklist,
  'lower-third': lowerThird,
  'icon-cards': iconCards,
  'step-card': stepCard,
  'end-card': endCard,
  'caption-track': captionTrack,
  'number-counter': numberCounter,
  'whip-transition': whipTransition,
  'glow-sweep': glowSweep,
};
