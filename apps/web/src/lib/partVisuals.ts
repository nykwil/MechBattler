import type { PartCategory } from '@mechbattler/sim';

export const CATEGORY_COLOR: Record<PartCategory, string> = {
  reactor: '#e8a23d',
  capacitor: '#c98fd6',
  weapon: '#d64545',
  utility: '#5aa9c7',
  structural: '#7d8493',
};

export const CATEGORY_LABEL: Record<PartCategory, string> = {
  reactor: 'Reactor',
  capacitor: 'Capacitor',
  weapon: 'Weapon',
  utility: 'Utility',
  structural: 'Structural',
};

export const CATEGORY_ORDER: PartCategory[] = ['reactor', 'capacitor', 'weapon', 'utility', 'structural'];
