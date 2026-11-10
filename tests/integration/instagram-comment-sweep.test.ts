import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';
import { QUEUES } from '../../src/queue/boss.js';
const d=process.env['DATABASE_URL']&&process.env['MIGRATE_DATABASE_URL']?describe:describe.skip;
d('comment tombstone expiry without any messaging channel configured',()=>{
 let prod:import('../../src/main.js').Production,admin:pg.Client;
 beforeAll(async()=>{
  const business=randomUUID();vi.stubEnv('PILOT_BUSINESS_ID',business);
  for(const name of ['META_SOCIAL_APP_ID','META_SOCIAL_APP_SECRET','META_PAGE_ACCESS_TOKEN','META_PAGE_ID','META_IG_ACCOUNT_ID','META_LOGIN_CONFIG_ID','TELEGRAM_BOT_TOKEN'])vi.stubEnv(name,'');
  admin=new pg.Client({connectionString:process.env['MIGRATE_DATABASE_URL']});await admin.connect();
  await admin.query("insert into businesses(id,name) values($1,'Comment sweep fixture')",[business]);
  const {buildProduction}=await import('../../src/main.js');
  prod=await buildProduction({provider:'disabled',DATABASE_URL:process.env['DATABASE_URL']!,ANTHROPIC_API_KEY:'test-key-not-real-just-shape-valid',META_GRAPH_API_VERSION:'v23.0',WEBHOOK_VERIFY_TOKEN:'fake-verify',CREDENTIAL_KEY:'d'.repeat(64),PORT:0},{models:offlineModels(),logger:false});
 },90000);
 afterAll(async()=>{await prod?.close();await admin?.end();vi.unstubAllEnvs();});
 it('schedules and runs the daily sweep in deployment mode',async()=>{
  const health=await prod.app.inject({url:'/health'});expect(health.json().provider).toBe('disabled');
  expect((await admin.query('select name from pgboss.schedule where name=$1',[QUEUES.igCommentSweep])).rows).toHaveLength(1);
  const expired=randomBytes(32).toString('hex'),fresh=randomBytes(32).toString('hex');
  await admin.query("insert into ig_comment_tombstones(digest,state,expires_at) values($1,'erased',now()-interval '1 day'),($2,'erased',now()+interval '1 day')",[expired,fresh]);
  await prod.boss.send(QUEUES.igCommentSweep,{});
  await expect.poll(async()=>(await admin.query('select digest from ig_comment_tombstones where digest=$1',[expired])).rowCount,{timeout:6000}).toBe(0);
  expect((await admin.query('select digest from ig_comment_tombstones where digest=$1',[fresh])).rowCount).toBe(1);
 },10000);
});
