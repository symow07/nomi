import { PHOSPHOR } from './phosphor.js';

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
 * Until then the slot holds Phosphor's user-circle: a person, because the
 * assistant works for the business as a person on its staff would; in a
 * circle, because a character's face will sit in a round of about this
 * footprint. Not a sparkle, a star, a robot or a wand: nothing that says
 * "machine". At rest it is the outline; on the page you are on, the filled
 * drawing, like every other entry in the rail.
 *
 * WHERE IT IS DRAWN (the icons run, PART 2): wherever the assistant is shown
 * as a MARK — its entry in the rail, the Inbox row it answered and the row's
 * "it wrote last", the key under the list, Today's heading and its calm line,
 * the at-work line, the calendar's dates it set and its legend, the
 * conversation's panel. Where the assistant LABELS words (its name over what
 * it wrote, the draft card's "Lily drafted", the takeover pill) it is the name
 * tag instead (`.as-tag`, `.as`): its name on its wash, no mark.
 *
 * `weight` follows the words beside it, as every icon's does (icons.ts): the
 * line at 18 px and under is bold, so a mark at the size of a 13 or 15 px line
 * is not a hairline; larger, regular. A character that replaces the drawing
 * may ignore it.
 */
export type AgentMarkState = 'rest' | 'here';

export const agentMark = (size: number, state: AgentMarkState = 'rest', className = 'ni',
  weight: 'regular' | 'bold' = size <= 18 ? 'bold' : 'regular'): string =>
  `<svg class="${className}" data-mark="agent" viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">`
  + `<path d="${PHOSPHOR['user-circle'][state === 'here' ? 'fill' : weight]}"/></svg>`;
