/**
 * Who provides Nomi: the legal name and the postal address the refund page names (docs/PRE-LAUNCH.md, waiting on the
 * owner). Empty until the owner gives them; while either is empty, no page names anybody — there is no placeholder
 * for a reader to see. Fill both in one commit, and the refund page says them.
 */
export const OPERATOR: { readonly name: string; readonly address: string } = { name: '', address: '' };

export const operatorNamed = (): boolean => OPERATOR.name.trim() !== '' && OPERATOR.address.trim() !== '';
