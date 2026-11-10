import type { MetaFetch } from './messaging.js';
import { metaPostCaption } from './posts.js';
export type CommentRead = { createdAt: Date | null; caption: string | null; postUrl: string | null; failed: boolean };
type J = Record<string, unknown>;
const object = (x: unknown): J => x && typeof x === 'object' && !Array.isArray(x) ? x as J : {};
const failed = (): CommentRead => ({createdAt:null,caption:null,postUrl:null,failed:true});

/** The account's own Page token, bound comment/author/media, then CH7's existing caption reader. */
export async function readInstagramComment(cfg: {accountId:string;token:string;graphVersion:string;fetchImpl:MetaFetch},event:{commentId:string;authorId:string;mediaId:string}):Promise<CommentRead> {
  const read = async (id: string, fields: string): Promise<J> => {
    const url=`https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(id)}?${new URLSearchParams({fields})}`;
    const r=await cfg.fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${cfg.token}`},signal:AbortSignal.timeout(5000)});
    if(r.status<200||r.status>=300)return {};
    const text=await r.text();return text.length>100000?{}:object(JSON.parse(text));
  };
  try {
    const c=await read(event.commentId,'id,timestamp,from,media');
    if(c['id']!==event.commentId||object(c['from'])['id']!==event.authorId||object(c['media'])['id']!==event.mediaId)return failed();
    const p=await read(event.mediaId,'id,owner,permalink,media_product_type');
    if(p['id']!==event.mediaId||object(p['owner'])['id']!==cfg.accountId||p['media_product_type']==='LIVE')return failed();
    const date=typeof c['timestamp']==='string'?new Date(c['timestamp']):null;
    const createdAt=date&&Number.isFinite(date.getTime())?date:null;
    let postUrl: string|null=null;
    if(typeof p['permalink']==='string') {
      const u=new URL(p['permalink']);
      if(u.protocol==='https:'&&['instagram.com','www.instagram.com'].includes(u.hostname)&&!u.username&&!u.password)postUrl=u.href;
    }
    const caption=await metaPostCaption({accessToken:cfg.token,graphVersion:cfg.graphVersion,fetchImpl:cfg.fetchImpl})(event.mediaId);
    return {createdAt,caption,postUrl,failed:createdAt===null||caption===null};
  } catch { return failed(); }
}
