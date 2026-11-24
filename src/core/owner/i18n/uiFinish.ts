/** UI correction, Block 9 (the cross-cutting finish): the shared filter bar (F07), long lists (F09), records (F10) and
 * the states (F47). Every catalogue is written here, all five, so no word on these pages falls back to English. The
 * non-English lines are listed for a native read in docs/NATIVE-REVIEW-UI.md under "Block 9". */
export const UI_FINISH_EN = {
  // F07 — the filter bar: the search stays in view; the other filters open behind this button on a phone.
  'filters.more': 'Filters',
} as const;

type FinishKey = keyof typeof UI_FINISH_EN;
/** A language's Block 9 words, and its translation of existing keys that were English only (F09: the customers list's
 * and orders lists' column words, customerArea.ts). */
type Pack = Record<FinishKey, string> & { readonly [key: string]: string };

export const UI_FINISH_ZH: Pack = {
  'filters.more': '筛选',
  // F09 — the customers list's column words.
  'customers.orderValue': '订单金额',
  'customers.standingOrders': '订单',
  'customers.lastContact': '最近联系',
  'customers.labels': '标签',
  // F09 — the orders list's column words.
  'customers.product': '产品',
  'customers.amount': '金额',
  'customers.created': '创建时间',
  'customers.stateAt': '状态记录时间',
};

export const UI_FINISH_AR: Pack = {
  'filters.more': 'التصفية',
  // F09 — the customers list's column words.
  'customers.orderValue': 'قيمة الطلبات',
  'customers.standingOrders': 'الطلبات',
  'customers.lastContact': 'آخر تواصل',
  'customers.labels': 'التصنيفات',
  // F09 — the orders list's column words.
  'customers.product': 'المنتج',
  'customers.amount': 'المبلغ',
  'customers.created': 'تاريخ الإنشاء',
  'customers.stateAt': 'وقت تسجيل الحالة',
};

export const UI_FINISH_ES: Pack = {
  'filters.more': 'Filtros',
  // F09 — the customers list's column words.
  'customers.orderValue': 'Valor de los pedidos',
  'customers.standingOrders': 'Pedidos',
  'customers.lastContact': 'Último contacto',
  'customers.labels': 'Etiquetas',
  // F09 — the orders list's column words.
  'customers.product': 'Producto',
  'customers.amount': 'Importe',
  'customers.created': 'Creado',
  'customers.stateAt': 'Estado registrado',
};

export const UI_FINISH_FR: Pack = {
  'filters.more': 'Filtres',
  // F09 — the customers list's column words.
  'customers.orderValue': 'Valeur des commandes',
  'customers.standingOrders': 'Commandes',
  'customers.lastContact': 'Dernier contact',
  'customers.labels': 'Étiquettes',
  // F09 — the orders list's column words.
  'customers.product': 'Produit',
  'customers.amount': 'Montant',
  'customers.created': 'Créée',
  'customers.stateAt': 'État enregistré',
};
