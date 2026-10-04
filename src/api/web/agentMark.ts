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
 */
export type AgentMarkState = 'rest' | 'here';

export const agentMark = (size: number, state: AgentMarkState = 'rest', className = 'ni'): string =>
  `<svg class="${className}" data-mark="agent" viewBox="0 0 256 256" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">`
  + `<path d="${PHOSPHOR['user-circle'][state === 'here' ? 'fill' : 'regular']}"/></svg>`;
