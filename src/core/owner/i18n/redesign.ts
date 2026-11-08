import { SETTINGS_AREA_EN } from './settingsArea.js';
import { ASSISTANT_AREA_EN } from './assistantArea.js';
import { BOOKS_SPENDING_EN } from './booksSpending.js';
import { BOOKS_OVERVIEW_REPORTS_EN } from './booksOverviewReports.js';
import { BOOKS_OWNER_REPORTS_EN } from './booksOwnerReports.js';
import { BOOKS_AREA_EN } from './booksArea.js';
import { BOOKS_DOCUMENTS_EN } from './booksDocuments.js';
import { PRODUCT_AREA_EN } from './productArea.js';
import { PRODUCT_IMPORT_EN } from './productImport.js';
import { COPILOT_EN } from './copilot.js';
import { CUSTOMER_AREA_EN } from './customerArea.js';
import { INBOX_CONVERSATION_EN } from './inboxConversation.js';
import { INBOX_LISTS_EN } from './inboxLists.js';
import { PROCEDURES_EN } from './procedures.js';
import { CASES_EN } from './cases.js';
import { WA_CATALOGUE_EN } from './waCatalogue.js';

/**
 * The approved redesign is English-only. New words still pass through t(),
 * with an explicit English fallback until translations are commissioned.
 * Existing translated keys remain in their original catalogues.
 */
export const REDESIGN_EN = {
  ...SETTINGS_AREA_EN,
  ...ASSISTANT_AREA_EN,
  ...BOOKS_OVERVIEW_REPORTS_EN,
  ...BOOKS_OWNER_REPORTS_EN,
  ...BOOKS_AREA_EN,
  ...BOOKS_SPENDING_EN,
  ...BOOKS_DOCUMENTS_EN,
  ...PRODUCT_AREA_EN,
  ...PRODUCT_IMPORT_EN,
  ...CUSTOMER_AREA_EN,
  ...COPILOT_EN,
  ...INBOX_CONVERSATION_EN,
  ...INBOX_LISTS_EN,
  ...PROCEDURES_EN,
  ...CASES_EN,
  ...WA_CATALOGUE_EN,
  'nav.customers': 'Customers',
  'nav.assistant': 'Assistant',
  'nav.more': 'More',
  'nav.sections': 'Sections',
  'nav.primary': 'Main navigation',
  'nav.results': 'Sales results',
  'nav.getStarted': 'Getting started',
  'area1.setup.title': 'Getting started',
  'area1.setup.intro': 'Set up your business, then check what is ready for customers. Progress comes from your saved information and practice.',
  'area1.setup.help': 'Read the steps',
  'area1.setup.complete': 'Your setup steps are complete.',
  'area1.setup.name.location': 'Find the name confirmation in the checklist below.',
  'area1.results.title': 'Sales results',
  'area1.results.intro': 'Customer activity, quotes and confirmed orders for the selected period.',
  'area1.results.sales': 'Sales',
  'area1.results.assistant': 'Assistant',
  'area1.results.setup': 'Getting started',
  'area1.results.views': 'Results to show',
  'area1.sales.quotesOther.one': '{n} quote in another currency is counted above but excluded from the amount.',
  'area1.sales.quotesOther.other': '{n} quotes in other currencies are counted above but excluded from the amount.',
  'area1.sales.ordersOther.one': '{n} order in another currency is counted above but excluded from the amount.',
  'area1.sales.ordersOther.other': '{n} orders in other currencies are counted above but excluded from the amount.',
  'area1.money.title': 'Income and expenses this month',
  'area1.money.income': 'Income {money}',
  'area1.money.expenses': 'Expenses {money}',
  'area1.calendar.chooseDay': 'Choose a date',
  'area1.calendar.showDay': 'Show agenda',
  'area1.calendar.month': 'Month view',
} as const;
