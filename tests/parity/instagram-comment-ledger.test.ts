import { it, expect } from 'vitest';
import { ledgerLinesNotice } from '../../src/db/erasureMail.js';
import { erasureNotice } from '../../src/api/web/erasure.js';
// @ts-expect-error The operator tool is plain JavaScript, as in the existing replay tests.
import { ledgerLine, parseLedgerLine } from '../../tools/replay-erasures.mjs';
const id='11111111-1111-4111-8111-111111111111';
const digest={digest:'a'.repeat(64),state:'erased',expires_at:'2027-01-20T00:00:00.000Z'};
const line={id,kind:'comment',business_id:id,customer_id:null,comment_ids:[id],comment_digests:[digest],at:'2027-01-12T00:00:00.000Z',via:'owner',by_who:'owner',counts:{}};
it('both immediate and scheduled ledger mail keep internal ids and remove expiring digests',()=>{
 for(const mail of [ledgerLinesNotice([line]),erasureNotice('customer',[line])]){
  expect(mail.text).toContain('"comment_ids"');expect(mail.text).toContain(id);
  expect(mail.text).not.toContain('comment_digests');expect(mail.text).not.toContain(digest.digest);
 }
});
it('ledger files carry ids after expiry, validate subjects, and accept the ids-only mailed line',()=>{
 expect(parseLedgerLine(JSON.stringify(line))).toMatchObject({ok:true,line:{kind:'comment',comment_ids:[id]}});
 const {comment_digests:_,...mailed}=line;
 expect(parseLedgerLine(JSON.stringify(mailed)).ok).toBe(true);
 expect(ledgerLine({...line,kind:'customer',customer_id:id}).comment_ids).toEqual([id]);
 for(const bad of [{...line,comment_ids:[]},{...line,comment_ids:['provider-id']},{...line,customer_id:id},{...line,comment_digests:[{...digest,words:'secret'}]}]) expect(parseLedgerLine(JSON.stringify(bad)).ok).toBe(false);
});
