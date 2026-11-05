/** A return is presentation only; it can name a Customers list, never another origin or command. */
export function customerReturnHref(raw:string|undefined):string {
 if(!raw||!raw.startsWith('/')||raw.startsWith('//'))return '/app/customers';
 try {const url=new URL(raw,'https://local.invalid');if(url.origin!=='https://local.invalid'||!['/app/customers','/app/customers/orders'].includes(url.pathname))return '/app/customers';
 const query=new URLSearchParams();for(const key of ['q','label','client','state','after','before']){const value=url.searchParams.get(key);if(value)query.set(key,value);}
 const hash=/^#(?:customer|order)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.hash)?url.hash:'';
 return url.pathname+(query.size?`?${query}`:'')+hash;
 }catch{return '/app/customers';}
}
