/** A comment is its own event, never evidence of an inbound direct message. */
export type InstagramCommentEvent = {
  readonly kind: 'comment'; readonly eventId: string; readonly dedupKey: string;
  readonly phoneNumberId: string; readonly occurredAt: Date; readonly createdAt: Date | null;
  readonly authorId: string; readonly username: string | null; readonly text: string; readonly mediaId: string;
};
type J = Record<string, unknown>;
const obj = (v: unknown): J => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as J : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const id = (v: unknown): string | null => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v) ? v : null;

export function parseInstagramComments(payload: unknown): InstagramCommentEvent[] {
  const result: InstagramCommentEvent[] = [];
  for (const root of Array.isArray(payload) ? payload : [payload]) {
    const p = obj(root);
    if (p['object'] !== 'instagram') continue;
    for (const rawEntry of arr(p['entry'])) {
      const entry = obj(rawEntry); const account = id(entry['id']);
      const time = entry['time'];
      if (!account || typeof time !== 'number' || !Number.isFinite(time) || time <= 0) continue;
      const occurredAt = new Date(time * 1000);
      if (!Number.isFinite(occurredAt.getTime())) continue;
      for (const rawChange of arr(entry['changes'])) {
        const change = obj(rawChange);
        if (change['field'] !== 'comments') continue;
        const v = obj(change['value']); const from = obj(v['from']); const media = obj(v['media']);
        const first = id(v['comment_id']); const alternate = id(v['id']);
        if (v['comment_id'] != null && !first || v['id'] != null && !alternate || first && alternate && first !== alternate) continue;
        const comment = first ?? alternate; const author = id(from['id']); const post = id(media['id']);
        if (!comment || !author || !post || author === account || media['media_product_type'] === 'LIVE') continue;
        const rawTime = v['timestamp'];
        const made = typeof rawTime === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(rawTime) ? new Date(rawTime) : null;
        result.push({ kind: 'comment', eventId: comment, dedupKey: `ig-comment:${account}:${comment}`,
          phoneNumberId: account, occurredAt, createdAt: made && Number.isFinite(made.getTime()) ? made : null,
          authorId: author, username: typeof from['username'] === 'string' ? from['username'].slice(0, 100) : null,
          text: typeof v['text'] === 'string' ? v['text'].slice(0, 4000) : '', mediaId: post });
      }
    }
  }
  return result;
}

/** Comment details belong only to their erasable inbox, even in a mixed DM webhook. */
export function withoutInstagramComments(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(withoutInstagramComments);
  const root=obj(payload);
  if(root['object']!=='instagram'||!Array.isArray(root['entry']))return payload;
  return {...root,entry:root['entry'].map(raw=>{
    const entry=obj(raw);if(!Array.isArray(entry['changes']))return raw;
    return {...entry,changes:entry['changes'].filter(change=>!['comments','live_comments'].includes(String(obj(change)['field'])))};
  })};
}
