import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import pg from 'pg';

const suite = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
type Row=Record<string,unknown>;
const refs=[
  ['wa_catalogue_items','product_id',true],['wa_catalogue_items','image_id',false],['wa_catalogue_items','account_id',false],
  ['wa_catalogue_batches','account_id',true],
  ['wa_catalogue_batch_items','batch_id',true],['wa_catalogue_batch_items','item_id',true],
  ['wa_catalogue_images','image_id',true],['wa_catalogue_images','item_id',true],['wa_catalogue_images','batch_item_id',true],
  ['wa_catalogue_sends','outbound_id',true],['wa_catalogue_sends','item_id',true],
  ...['wa_catalogue_items','wa_catalogue_batches','wa_catalogue_batch_items','wa_catalogue_images','wa_catalogue_sends'].map(t=>[t,'business_id',true] as const),
] as const;
suite('Catalogue references (requires DATABASE_URL)',()=>{
  let admin:pg.Client,app:pg.Client;
  const insert=(db:pg.Client,table:string,row:Row)=>db.query(
    `insert into ${table} (${Object.keys(row).join(',')}) values (${Object.keys(row).map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(row));
  async function fixture(){
    const biz=randomUUID(),product=randomUUID(),secondProduct=randomUUID(),image=randomUUID(),secondImage=randomUUID();
    const account=randomUUID(),item=randomUUID(),batch=randomUUID(),secondBatch=randomUUID(),batchItem=randomUUID(),outbound=randomUUID();
    await insert(admin,'businesses',{id:biz,name:'Reference shop'});
    for(const id of [product,secondProduct]) await insert(admin,'products',{id,business_id:biz,sku:id,name:'Shirt',unit:'item'});
    for(const [id,product_id] of [[image,product],[secondImage,secondProduct]]) await insert(admin,'product_images',{id,product_id,url:'https://example.test/photo'});
    await insert(admin,'whatsapp_accounts',{id:account,business_id:biz,waba_id:'12345',phone_number_id:String(randomInt(100000,999999999)),token_ciphertext:'v1.test',fingerprint:'012345abcdef',connected_by:'owner'});
    await insert(admin,'wa_catalogue_items',{id:item,business_id:biz,product_id:product,image_id:image,account_id:account});
    for(const id of [batch,secondBatch]) await insert(admin,'wa_catalogue_batches',{id,business_id:biz,account_id:account,catalog_id:'12345',created_by:'owner'});
    await insert(admin,'wa_catalogue_batch_items',{id:batchItem,business_id:biz,batch_id:batch,item_id:item,operation:'CREATE',fingerprint:'fixture',snapshot:'{}'});
    const customer=randomUUID(),conversation=randomUUID();
    await insert(admin,'clients',{id:customer,business_id:biz});
    await insert(admin,'conversations',{id:conversation,business_id:biz,client_id:customer,channel:'whatsapp'});
    await insert(admin,'outbound_messages',{id:outbound,business_id:biz,conversation_id:conversation,seq:1,body:'Fixture'});
    return {biz,rows:{
      wa_catalogue_items:{id:randomUUID(),business_id:biz,product_id:secondProduct,image_id:secondImage,account_id:account},
      wa_catalogue_batches:{id:randomUUID(),business_id:biz,account_id:account,catalog_id:'12345',created_by:'owner'},
      wa_catalogue_batch_items:{id:randomUUID(),business_id:biz,batch_id:secondBatch,item_id:item,operation:'CREATE',fingerprint:'fixture',snapshot:'{}'},
      wa_catalogue_images:{id:randomUUID(),business_id:biz,item_id:item,batch_item_id:batchItem,image_id:image,image_version:'fixture',token:randomBytes(32).toString('base64url'),state:'submitted',pending_until:new Date('2031-01-01')},
      wa_catalogue_sends:{outbound_id:outbound,business_id:biz,item_id:item,catalog_id:'12345',retailer_id:'fixture',name:'Shirt',price:'12',currency:'GBP',fingerprint:'fixture'},
    } as Record<string,Row>};
  }
  beforeAll(async()=>{admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});app=new pg.Client({connectionString:process.env['DATABASE_URL']});await admin.connect();await app.connect();});
  afterAll(async()=>{await app?.end();await admin?.end();});
  it.each(refs)('%s.%s refuses a foreign INSERT and UPDATE, accepting its own reference',async(table,column,required)=>{
    const own=await fixture(),foreign=await fixture(),row=own.rows[table]!,bad=foreign.rows[table]!;
    await app.query('begin');
    try{
      await app.query("select set_config('app.business_id',$1,true)",[own.biz]);
      await app.query('savepoint candidate');
      await expect(insert(app,table,{...row,[column]:bad[column]})).rejects.toMatchObject({code:expect.stringMatching(/^(23503|42501)$/)});
      await app.query('rollback to candidate');
      if(required){
        const missing={...row};delete missing[column];
        for(const value of [missing,{...row,[column]:null}]){
          await expect(insert(app,table,value)).rejects.toMatchObject({code:expect.stringMatching(/^(23502|23503|42501)$/)});
          await app.query('rollback to candidate');
        }
      }
      expect((await insert(app,table,row)).rowCount).toBe(1);
      const key=table==='wa_catalogue_sends'?'outbound_id':'id';
      await app.query('savepoint changed');
      await expect(app.query(`update ${table} set ${column}=$1 where ${key}=$2`,[bad[column],row[key]])).rejects.toMatchObject({code:expect.stringMatching(/^(23503|42501)$/)});
      await app.query('rollback to changed');
      if(required){
        await expect(app.query(`update ${table} set ${column}=null where ${key}=$1`,[row[key]])).rejects.toMatchObject({code:expect.stringMatching(/^(23502|23503|42501)$/)});
        await app.query('rollback to changed');
      }
      expect((await app.query(`update ${table} set ${column}=$1 where ${key}=$2`,[row[column],row[key]])).rowCount).toBe(1);
    }finally{await app.query('rollback');}
  });
  it('only item image_id and account_id are nullable parent references',async()=>{
    const f=await fixture(),row=f.rows['wa_catalogue_items']!;
    await app.query('begin');
    try{
      await app.query("select set_config('app.business_id',$1,true)",[f.biz]);
      expect((await insert(app,'wa_catalogue_items',{...row,image_id:null,account_id:null})).rowCount).toBe(1);
    }finally{await app.query('rollback');}
  });
});
