import { solarSvg } from './icons.js';

/**
 * THE ASSISTANT'S MARK — ONE SLOT (the icons run, 2026-10-04).
 *
 * The owner: "Remove the generic four-point 'sparkle' on the agent entirely.
 * Do NOT replace it with another sparkle or any stock AI cliché. The owner is
 * designing a custom character mark himself; until he delivers it, leave a
 * neutral placeholder from the chosen icon family in the agent's nav slot.
 * Reserve the slot so the character drops in later with no layout change."
 *
 * So this function is the ONE place the assistant is drawn as a mark, and the
 * box it draws is fixed: `size` square, whatever is inside. The character
 * replaces the drawing below — this file, this function — and nothing that
 * calls it moves.
 *
 * Until then the slot holds a user-circle (Solar's since the Solar run; it was
 * Phosphor's): a person, because the assistant works for the business as a
 * person on its staff would; in a circle, because a character's face will sit
 * in a round of about this footprint. Not a sparkle, a star, a robot or a wand:
 * nothing that says "machine". Always the outline.
 *
 * WHERE IT IS DRAWN (the icons run, PART 2): wherever the assistant is shown
 * as a MARK — its entry in the rail, the Inbox row it answered and the row's
 * "it wrote last", the key under the list, Today's heading and its calm line,
 * the at-work line, the calendar's dates it set and its legend, the
 * conversation's panel. Where the assistant LABELS words (its name over what
 * it wrote, the draft card's "Lily drafted", the takeover pill) it is the name
 * tag instead (`.as-tag`, `.as`): its name on its wash, no mark.
 *
 * THE SOLAR RUN (2026-10-05) — the slot is drawn in the product's one family: Solar's user-circle, a
 * line, at every size and never filled (the nav's state is the stylesheet's colour, as on every entry).
 * Its line follows the size it is drawn at, as every icon's does (icons.ts). Still this function, still a
 * fixed `size` box: a character that replaces the drawing drops in here.
 */
export const agentMark = (size: number, className = 'ni'): string =>
  solarSvg(className, 'user-circle', size).replace(' viewBox=', ' data-mark="agent" viewBox=');
