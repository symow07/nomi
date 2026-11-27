/** The settings overhaul (the owner's decision, 2026-11-27; rule 104): ONE Settings area in five groups, and one page
 * template. These are the words the menu and the template's shared parts add, written in all five languages. The
 * renamed menu labels were changed where they already lived (settingsArea.ts, navigation.ts, messages.ts). */
export const SETTINGS_OVERHAUL_EN = {
  'side.connections': 'Connections',
  'side.shopify': 'Shopify',
  'side.booksInvoices': 'Invoices',
  'side.forAccountant': 'For your accountant',
  'set.needed': 'Needed',
  'set.danger': 'Danger zone',
  'set.search': 'Search this list',
  'set.showMore': 'Show more',
  'set.noMatch': 'Nothing matches this search.',
  'set.pick': 'Type to search',
  'components.settings': 'Settings page parts',
  'components.sample.title': 'A page title',
  'components.sample.act': 'Remove',
  'components.sample.ask': 'Remove this?',
} as const;

type Key = keyof typeof SETTINGS_OVERHAUL_EN;

export const SETTINGS_OVERHAUL_ZH: Record<Key, string> = {
  'side.connections': '连接',
  'side.shopify': 'Shopify',
  'side.booksInvoices': '发票',
  'side.forAccountant': '给你的会计',
  'set.needed': '待填',
  'set.danger': '危险操作',
  'set.search': '搜索此列表',
  'set.showMore': '显示更多',
  'set.noMatch': '没有匹配的结果。',
  'set.pick': '输入以搜索',
  'components.settings': '设置页的组成部分',
  'components.sample.title': '页面标题',
  'components.sample.act': '移除',
  'components.sample.ask': '要移除吗？',
};

export const SETTINGS_OVERHAUL_AR: Record<Key, string> = {
  'side.connections': 'الربط',
  'side.shopify': 'Shopify',
  'side.booksInvoices': 'الفواتير',
  'side.forAccountant': 'لمحاسبك',
  'set.needed': 'مطلوب',
  'set.danger': 'منطقة الخطر',
  'set.search': 'ابحث في هذه القائمة',
  'set.showMore': 'عرض المزيد',
  'set.noMatch': 'لا شيء يطابق هذا البحث.',
  'set.pick': 'اكتب للبحث',
  'components.settings': 'أجزاء صفحة الإعدادات',
  'components.sample.title': 'عنوان الصفحة',
  'components.sample.act': 'إزالة',
  'components.sample.ask': 'هل تريد الإزالة؟',
};

export const SETTINGS_OVERHAUL_ES: Record<Key, string> = {
  'side.connections': 'Conexiones',
  'side.shopify': 'Shopify',
  'side.booksInvoices': 'Facturas',
  'side.forAccountant': 'Para tu contable',
  'set.needed': 'Falta',
  'set.danger': 'Zona de riesgo',
  'set.search': 'Buscar en esta lista',
  'set.showMore': 'Mostrar más',
  'set.noMatch': 'Nada coincide con esta búsqueda.',
  'set.pick': 'Escribe para buscar',
  'components.settings': 'Partes de una página de ajustes',
  'components.sample.title': 'Título de la página',
  'components.sample.act': 'Quitar',
  'components.sample.ask': '¿Quitar esto?',
};

export const SETTINGS_OVERHAUL_FR: Record<Key, string> = {
  'side.connections': 'Connexions',
  'side.shopify': 'Shopify',
  'side.booksInvoices': 'Factures',
  'side.forAccountant': 'Pour votre comptable',
  'set.needed': 'À compléter',
  'set.danger': 'Zone de danger',
  'set.search': 'Rechercher dans cette liste',
  'set.showMore': 'Afficher plus',
  'set.noMatch': 'Aucun résultat pour cette recherche.',
  'set.pick': 'Saisissez pour rechercher',
  'components.settings': 'Éléments d’une page de réglages',
  'components.sample.title': 'Titre de la page',
  'components.sample.act': 'Retirer',
  'components.sample.ask': 'Retirer cet élément ?',
};
