import type { Locale } from '../../core/owner/i18n/locale.js';

/**
 * The navigation block (2026-11-25): Reports is its own area, and its views (Sales, the assistant, the monthly report,
 * ad spend) are the section sidebar's entries (sections.ts). The page draws no tab row of its own.
 */
export const renderResultsTabs = (_locale: Locale, _current: 'sales' | 'assistant' | 'setup' | 'month'): string => '';
