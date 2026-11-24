/** UI correction, Block 9 (the cross-cutting finish): the shared filter bar (F07), long lists (F09), records (F10) and
 * the states (F47). Every catalogue is written here, all five, so no word on these pages falls back to English. The
 * non-English lines are listed for a native read in docs/NATIVE-REVIEW-UI.md under "Block 9". */
export const UI_FINISH_EN = {
  // F07 — the filter bar: the search stays in view; the other filters open behind this button on a phone.
  'filters.more': 'Filters',
} as const;

type FinishKey = keyof typeof UI_FINISH_EN;

export const UI_FINISH_ZH: Record<FinishKey, string> = {
  'filters.more': '筛选',
};

export const UI_FINISH_AR: Record<FinishKey, string> = {
  'filters.more': 'التصفية',
};

export const UI_FINISH_ES: Record<FinishKey, string> = {
  'filters.more': 'Filtros',
};

export const UI_FINISH_FR: Record<FinishKey, string> = {
  'filters.more': 'Filtres',
};
