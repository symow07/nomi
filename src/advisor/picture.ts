/**
 * THE PICTURE OF AN ANSWER (the owner, 2026-11-26: "whenever you ask it about something according to your business
 * it makes a schema / graph … instead of the stacked text"). A read may hand its sheet a picture of the SAME facts
 * its lines carry — drawn by the page from this data, never by the model. Four shapes:
 *
 *   flow    where things stand, as boxes joined in the order they happen (the period's customers, prices, orders);
 *   trend   one amount over the days of a period against the same days before (this month, last month);
 *   people  the customers an answer names, each with the one thing said of them, around the reader;
 *   week    dated things, on the days they fall.
 *
 * THE RULES, held by tests/parity/ask-picture.test.ts and tests/integration/ask-picture.test.ts:
 *   · every figure and every name a picture shows is in the sheet's lines — the picture adds no fact;
 *   · a figure Nomi does not record is `null`, drawn as its fixed words, never as 0 and never as an empty mark;
 *   · the words stay: the same answer's lines are one press away, and are what a screen reader is given.
 * This module is data only: it imports nothing and reaches nothing.
 */

export type FlowNode = {
  readonly id: string;
  /** What the box counts, in the reader's language. */
  readonly label: string;
  /** The figure as the sheet's line says it; null: not on record. */
  readonly value: string | null;
  /** Where on the grid: a column from the start, and the upper row (0), the lower (1), or between them ('mid'). */
  readonly col: number;
  readonly row: 0 | 1 | 'mid';
  /** `waits`: something here waits for the reader (the accent's wash). */
  readonly tone?: 'waits';
  /** The page that shows the same thing. */
  readonly href?: string;
};

export type FlowPicture = {
  readonly kind: 'flow';
  readonly nodes: readonly FlowNode[];
  /** From one box to the next, by id. `waits`: the branch that ends in something waiting. */
  readonly links: readonly { readonly from: string; readonly to: string; readonly tone?: 'waits' }[];
};

export type TrendPicture = {
  readonly kind: 'trend';
  /** The running total at the end of each day, oldest first: the same length for both, at least two. Drawn, never printed. */
  readonly now: readonly number[];
  readonly then: readonly number[];
  /** The two totals as the sheet's lines say them. */
  readonly nowLabel: string;
  readonly thenLabel: string;
  /** The first and the last day drawn, as the reader's dates. */
  readonly from: string;
  readonly to: string;
};

export type PeoplePicture = {
  readonly kind: 'people';
  readonly people: readonly {
    readonly name: string;
    /** The one thing said of them, as their line says it. */
    readonly what: string;
    /** Something of theirs waits for the reader's own tap. */
    readonly waits: boolean;
    readonly href?: string;
  }[];
  /** "…and N more", when the sheet names more than are drawn. */
  readonly more?: string;
};

export type WeekPicture = {
  readonly kind: 'week';
  readonly days: readonly {
    /** The weekday and the day of the month, in the reader's language. */
    readonly label: string;
    readonly today: boolean;
    readonly items: readonly { readonly text: string; readonly late: boolean }[];
  }[];
};

export type Picture = FlowPicture | TrendPicture | PeoplePicture | WeekPicture;

/** The most boxes of people a picture draws; the rest are counted in `more`. */
export const PEOPLE_DRAWN = 8;
