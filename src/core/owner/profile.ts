import { TERM } from './vocabulary.js';
import { joinLines, joinSections, labeled } from './components.js';
import { formatDateZh } from './format.js';

/**
 * M6 — Profile pages, framed as HR files, everything editable by replying.
 * The employee profile is the short card; the full record is 员工档案
 * (personnelFile.ts) and the authority sheet is 工作职责表 (jobSheet.ts).
 */

export function renderBusinessProfile(b: {
  readonly companyName: string;
  readonly incotermZh: string;              // e.g. FOB 宁波
  readonly currencyZh: string;              // e.g. 人民币记账，美元报价
  readonly languagesZh: readonly string[];
  readonly paymentTermsZh: string;
  readonly catalogCount: number;
}): string {
  return joinSections([
    `【公司资料】${b.companyName}`,
    joinLines([
      labeled('报价方式', `${b.currencyZh}，${b.incotermZh}`),
      labeled('接待语言', b.languagesZh.join('、')),
      labeled('付款条件', b.paymentTermsZh),
      labeled('产品', `${b.catalogCount} 个已入册`),
    ]),
    '要改哪项，直接回复说就行。',
  ]);
}

export function renderEmployeeProfile(e: {
  readonly employeeName: string;
  readonly avatar: string;
  readonly hireDate: Date;
  readonly roleZh: string;
  readonly languagesZh: readonly string[];
  readonly promotedCount: number;
  readonly learningCount: number;
}): string {
  return joinSections([
    `${e.avatar}【${e.employeeName} · 员工资料】`,
    joinLines([
      labeled('入职', formatDateZh(e.hireDate)),
      labeled('职位', e.roleZh),
      labeled('语言', e.languagesZh.join('、')),
      labeled('职责', `${e.promotedCount} 项已${TERM.promotion}，${e.learningCount} 项学习中`),
    ]),
    `详细记录看${TERM.personnelFile}，职权范围看${TERM.jobSheet}。`,
  ]);
}
