/** UI correction, Block 9 (the cross-cutting finish): the shared filter bar (F07), long lists (F09), records (F10) and
 * the states (F47). Every catalogue is written here, all five, so no word on these pages falls back to English. The
 * non-English lines are listed for a native read in docs/NATIVE-REVIEW-UI.md under "Block 9". */
export const UI_FINISH_EN = {
  // F07 — the filter bar: the search stays in view; the other filters open behind this button on a phone.
  'filters.more': 'Filters',
  // F10 — a record reads first: its values in a short list, each part changed on purpose behind its own fold.
  'edit.notGiven': 'Not given yet',
  'edit.change.business': 'Change the business details',
  'edit.change.contact': 'Change the contact details',
  'edit.change.zone': 'Change the time zone',
  'edit.change.zoneCurrency': 'Change the time zone and currency',
  'edit.change.currency': 'Change the currency',
  'edit.change.kind': 'Change the type, country and website',
  'edit.change.ids': 'Change the legal identifiers',
} as const;

type FinishKey = keyof typeof UI_FINISH_EN;
/** A language's Block 9 words, and its translation of existing keys that were English only (F09: the customers list's
 * and orders lists' column words, customerArea.ts). */
type Pack = Record<FinishKey, string> & { readonly [key: string]: string };

export const UI_FINISH_ZH: Pack = {
  'filters.more': '筛选',
  // F10 — a record reads first: its values in a short list, each part changed on purpose behind its own fold.
  'edit.notGiven': '还没填写',
  'edit.change.business': '修改业务信息',
  'edit.change.contact': '修改联系方式',
  'edit.change.zone': '修改时区',
  'edit.change.zoneCurrency': '修改时区和货币',
  'edit.change.currency': '修改货币',
  'edit.change.kind': '修改业务类型、国家和网站',
  'edit.change.ids': '修改法定识别号',
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
  // F10 — a record reads first: its values in a short list, each part changed on purpose behind its own fold.
  'edit.notGiven': 'لم يُذكر بعد',
  'edit.change.business': 'تغيير بيانات النشاط',
  'edit.change.contact': 'تغيير بيانات التواصل',
  'edit.change.zone': 'تغيير المنطقة الزمنية',
  'edit.change.zoneCurrency': 'تغيير المنطقة الزمنية والعملة',
  'edit.change.currency': 'تغيير العملة',
  'edit.change.kind': 'تغيير نوع النشاط والبلد والموقع',
  'edit.change.ids': 'تغيير المعرّفات القانونية',
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
  // F10 — a record reads first: its values in a short list, each part changed on purpose behind its own fold.
  'edit.notGiven': 'Aún sin indicar',
  'edit.change.business': 'Cambiar los datos del negocio',
  'edit.change.contact': 'Cambiar los datos de contacto',
  'edit.change.zone': 'Cambiar la zona horaria',
  'edit.change.zoneCurrency': 'Cambiar la zona horaria y la moneda',
  'edit.change.currency': 'Cambiar la moneda',
  'edit.change.kind': 'Cambiar el tipo, el país y el sitio web',
  'edit.change.ids': 'Cambiar los identificadores legales',
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
  // F10 — a record reads first: its values in a short list, each part changed on purpose behind its own fold.
  'edit.notGiven': 'Pas encore indiqué',
  'edit.change.business': 'Modifier les informations de l’entreprise',
  'edit.change.contact': 'Modifier les coordonnées',
  'edit.change.zone': 'Modifier le fuseau horaire',
  'edit.change.zoneCurrency': 'Modifier le fuseau horaire et la devise',
  'edit.change.currency': 'Modifier la devise',
  'edit.change.kind': 'Modifier le type, le pays et le site web',
  'edit.change.ids': 'Modifier les identifiants légaux',
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
