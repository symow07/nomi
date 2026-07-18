import { TERM } from './vocabulary.js';
import { joinLines, joinSections } from './components.js';
import { formatDateZh } from './format.js';

/**
 * M5 — 员工档案: the longitudinal trust record. Reads like an employee file:
 * summaries with meaning, not event dumps. Every authority change answers
 * the five questions (what / why / evidence / can now / still supervised) —
 * the entry TYPE requires them, so an incomplete story cannot render.
 */

export type CapabilityChangeEntry = {
  readonly at: Date;
  readonly whatZh: string;         // 「报价」晋升 / 「谈价」退回试用
  readonly whyZh: string;          // one line
  readonly evidenceZh: string;     // countable: 28次无修改、抽查3次通过
  readonly canNowZh: string;
  readonly stillSupervisedZh: string;
};

export type PersonnelFileInput = {
  readonly employeeName: string;
  readonly hireDate: Date;
  readonly roleZh: string;
  readonly trainingZh: readonly string[];        // e.g. 产品目录 12 个产品
  readonly languagesZh: readonly string[];
  readonly scheduleZh: string;                   // 全天在岗，夜班 22:00–07:00
  readonly capabilityHistory: readonly CapabilityChangeEntry[];
  readonly correctionsCount: number;             // owner edits recorded as training
  readonly incidents: readonly { readonly at: Date; readonly whatZh: string; readonly repairedZh: string }[];
  readonly reviews: readonly { readonly at: Date; readonly outcomeZh: string }[];
  readonly trendZh: string;                      // e.g. 修改率连续两周下降
};

export function renderPersonnelFile(p: PersonnelFileInput): string {
  const header = joinLines([
    `【${p.employeeName} · ${TERM.personnelFile}】`,
    `入职：${formatDateZh(p.hireDate)} ｜ ${p.roleZh}`,
    `语言：${p.languagesZh.join('、')} ｜ ${p.scheduleZh}`,
    `完成培训：${p.trainingZh.join('、')}`,
  ]);

  const history = p.capabilityHistory.length
    ? joinSections([
        '职责变化：',
        ...p.capabilityHistory.slice(-3).map((c) => joinLines([
          `${formatDateZh(c.at)} ${c.whatZh}`,
          `　为什么：${c.whyZh}`,
          `　依据：${c.evidenceZh}`,
          `　现在：${c.canNowZh}`,
          `　仍需${TERM.approval}：${c.stillSupervisedZh}`,
        ])),
      ])
    : '职责变化：还没有——一切都在学习中。';

  const corrections = `培训记录：你的修改已积累 ${p.correctionsCount} 条，会先用你的表达。`;

  const incidents = p.incidents.length
    ? joinLines([
        '重要事件：',
        ...p.incidents.slice(-2).map((i) =>
          `· ${formatDateZh(i.at)} ${i.whatZh}——${i.repairedZh}`),
      ])
    : null;

  const reviews = p.reviews.length
    ? joinLines([
        '历次审查：',
        ...p.reviews.slice(-3).map((r) => `· ${formatDateZh(r.at)} ${r.outcomeZh}`),
      ])
    : null;

  const trend = `近期趋势：${p.trendZh}`;

  return joinSections([header, history, corrections, incidents, reviews, trend]);
}
