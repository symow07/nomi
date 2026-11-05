/** Only Books lists and reports can be used as return destinations. These never authorize a command. */
export function safeBooksReturn(raw:unknown):string|null {
 if(typeof raw!=='string'||raw.length>16000||!raw.startsWith('/')||raw.startsWith('//'))return null;
 try{
  const u=new URL(raw,'https://books.invalid');if(u.origin!=='https://books.invalid'||!['/app/books','/app/books/spending','/app/books/bank','/app/books/reports','/app/books/reports/cash','/app/books/reports/profit','/app/books/reports/suppliers','/app/books/reports/suppliers/entries','/app/books/advanced/entries'].includes(u.pathname))return null;
  const q=new URLSearchParams(),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for(const key of ['cash','payable','transfer'])for(const value of [...new Set(u.searchParams.getAll(key))].slice(0,200))if(uuid.test(value))q.append(key,value);
  for(const key of ['account','party','line']){const value=u.searchParams.get(key);if(value&&uuid.test(value))q.set(key,value);}
  const page=Number(u.searchParams.get('page'));if(Number.isSafeInteger(page)&&page>1)q.set('page',String(page));
  const state=u.searchParams.get('state');if(state&&['pending','unread','problem','ready','draft','posted','set_aside','history','review','external','transfer'].includes(state))q.set('state',state);
  if(u.searchParams.get('view')==='unmatched')q.set('view','unmatched');if(u.searchParams.get('unassigned')==='1')q.set('unassigned','1');
  const hash=/^#(?:entry|line|paper|bank-line)-[0-9a-f-]{36}$/i.test(u.hash)?u.hash:'';
  return u.pathname+(q.size?'?'+q:'')+hash;
 }catch{return null;}
}
