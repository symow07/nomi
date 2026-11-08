import type { PgBoss } from 'pg-boss';
import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { liveMetaAccount } from '../db/metaAccounts.js';
import { commentsEnabled, instagramComment, finishCommentRead } from '../db/instagramComments.js';
import { metaAccountToken } from '../channels/meta/connect.js';
import type { MetaFetch } from '../channels/meta/messaging.js';
import { readInstagramComment } from '../channels/meta/commentReader.js';
import { catalogueNames } from '../db/productAliases.js';
import { matchCaption } from '../core/conversation/sharedPost.js';
import { QUEUES } from '../queue/boss.js';
import { txDatabase } from '../worker/appErrors.js';
import { sendAlert } from './notify.js';
import { isPracticeCopy } from '../db/practice.js';

export async function processInstagramComment(deps: {db:Db;boss:Pick<PgBoss,'send'>;key:Buffer;fetchImpl:MetaFetch;graphVersion:string},job:{businessId:string;commentId:string}):Promise<void> {
  const bid=parseBusinessId(job.businessId);if(!bid.ok)return;
  const found=await withTenantTx(deps.db,bid.value,async tx=>{
    if(await isPracticeCopy(tx,bid.value))return null;
    const comment=await instagramComment(tx,bid.value,job.commentId);
    if(!comment||!comment.asking||comment.enriched_at||!await commentsEnabled(tx,bid.value,comment.meta_account_id))return null;
    const account=await liveMetaAccount(tx,bid.value);
    if(!account||account.id!==comment.meta_account_id||account.igAccountId!==comment.account_id||account.needsAttention)return null;
    return {comment,account};
  });
  if(!found)return;
  const token=metaAccountToken(found.account,deps.key);if(!token)return;
  // No transaction is held across a provider read; all capabilities are injected for offline tests.
  const result=await readInstagramComment({accountId:found.comment.account_id,token,graphVersion:deps.graphVersion,fetchImpl:deps.fetchImpl},
    {commentId:found.comment.comment_id,authorId:found.comment.identity,mediaId:found.comment.media_id});
  await withTenantTx(deps.db,bid.value,async tx=>{
    const match=matchCaption(result.caption,await catalogueNames(tx,bid.value));
    if(await finishCommentRead(tx,bid.value,job.commentId,{createdAt:result.createdAt,match,postUrl:result.postUrl,failed:result.failed})) {
      await sendAlert(deps.boss,{businessId:bid.value,kind:'comment_asking',conversationId:null,commentId:job.commentId},{db:txDatabase(tx)});
    }
  });
}

export async function registerInstagramCommentWorkers(deps:{db:Db;boss:PgBoss;key:Buffer;fetchImpl:MetaFetch;graphVersion:string}):Promise<void> {
  await deps.boss.work<{businessId:string;commentId:string}>(QUEUES.instagramComments,async jobs=>{
    for(const job of jobs)await processInstagramComment(deps,job.data);
  });
  await deps.boss.schedule(QUEUES.igCommentSweep,'23 3 * * *',{});
  await deps.boss.work(QUEUES.igCommentSweep,async()=>{await sql`select ig_comment_sweep()`.execute(deps.db);});
}
