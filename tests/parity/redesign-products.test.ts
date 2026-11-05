import { describe, expect, it } from 'vitest';
import { renderProductList, renderProductDetail, renderAddForm, type ProductDetail, type ProductListItem } from '../../src/api/web/products.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { productArea } from '../../src/api/web/productArea.js';
import { renderPriceRules, type PriceRulesView } from '../../src/api/web/priceRules.js';
import { usd } from '../../src/core/types/money.js';

const id = '11111111-1111-4111-8111-111111111111';
const item: ProductListItem = { id, name:'Canvas tote', nameZh:null, sku:'TOTE', unit:'item', moq:null, entryQty:1, entryPrice:usd('20'), learned:true, status:'learned', imageMatchable:true, isActive:true };
const detail: ProductDetail = { ...item, currency:'USD', category:null, customizable:false, leadTimeDays:null, tiers:[{minQty:1,maxQty:null,unitPrice:usd('20')}], aliases:['Canvas tote'], images:[], recentQuotes:[], businessKind:'retail' };
const staff = {...OWNER_VIEW,isOwner:false};
const source = '/app/products?q=canvas&page=3';
const from = source+'#p-'+id;

describe('Products area presentation',()=>{
 it('shows native section choices and current state, with owner controls absent for staff',()=>{
  const html=productArea('<h1>Products</h1>','en','limits');
  expect(html).toContain('<details class="area-chooser pa-chooser"><summary>Price limits</summary>');
  expect(html.match(/href="\/app\/products\/price-limits" aria-current="page"/g)).toHaveLength(2);
  expect(html).toContain('href="/app/products/add"');
  const limited=productArea('<h1>Products</h1>','en','all',staff);
  expect(limited).not.toContain('/app/products/add');expect(limited).not.toContain('/app/products/price-limits');
  expect(productArea('', 'fr', 'all')).toContain('All products');
 });
 it('keeps search, page and row anchor through the product record',()=>{
  const html=renderProductList([item],'en',null,OWNER_VIEW,null,{page:{items:[item],q:'canvas',total:121,page:3,pageSize:50,next:null,prev:'/app/products?q=canvas&page=2'},returnHref:source});
  expect(html).toContain('method="get" action="/app/products"');
  expect(html).toContain('name="q" value="canvas"');
  expect(html).toContain(`id="p-${id}"`);
  expect(html).toContain(`?from=${encodeURIComponent(from)}`);
  expect(html).toContain('href="/app/products?q=canvas&amp;page=2"');
  expect(html).toContain('101–121 of 121');
 });
 it('distinguishes no search matches from an empty product list',()=>{
  const html=renderProductList([],'en',null,OWNER_VIEW,null,{page:{items:[],q:'absent',total:0,page:1,pageSize:50,next:null,prev:null}});
  expect(html).toContain('No products match');
  expect(html).toContain('name="q" value="absent"');
  expect(html).not.toContain('No products yet');
 });
 it('uses a stored photo only, independently of image matching',()=>{
  const html=renderProductList([{...item,imageMatchable:false,photoToken:'stored-token'}, {...item,id:'22222222-2222-4222-8222-222222222222',photoToken:null}],'en');
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).toContain('src="/media/stored-token"');
  expect(html).toContain('Not recognizable by photo yet');
 });
 it('retains the explicit list context on every edit/photo/name form, but not external destinations',()=>{
  const html=renderProductDetail({...detail,aliases:['Canvas tote','shop tote'],photo:{token:'stored'}},'en',null,{}, {},OWNER_VIEW,new Date(),{returnHref:from});
  expect(html).toContain('href="/app/products?q=canvas&amp;page=3#p-'+id+'"');
  for(const suffix of ['edit','photo','photo/remove','names/remove']) {
   const form=html.match(new RegExp(`<form[^>]+action="/app/products/${id}/${suffix}"[^>]*>[\\s\\S]*?</form>`))?.[0];
   expect(form,suffix).toContain('name="from" value="/app/products?q=canvas&amp;page=3#p-'+id+'"');
  }
  expect(renderProductDetail(detail,'en',null,{}, {},OWNER_VIEW,new Date(),{returnHref:'https://evil.test/'})).not.toContain('evil.test');
 });
 it('keeps optional controls in the same form and retains a refused unchecked offering',()=>{
  const html=renderProductDetail(detail,'en',null,{price:'not_a_number'},{price:'oops',isActive:'',moq:'',leadTime:'9'},OWNER_VIEW);
  const form=html.match(/<form[^>]+action="[^"]+\/edit"[^>]*>[\s\S]*?<\/form>/)?.[0]??'';
  for(const name of ['name','customerNames','options','price','moq','unit','leadTime','isActive'])expect(form).toContain(`name="${name}"`);
  expect(form).toContain('name="leadTime" inputmode="numeric" value="9"');
  expect(form).toContain('value="oops"');
  expect(form).not.toMatch(/name="isActive"\s+checked/);
  expect(form).toContain('class="product-optional" open');
 });
 it('keeps staff read-only and separate import POST boundaries',()=>{
  expect(renderProductDetail(detail,'en',null,{}, {},staff)).not.toContain('<form');
  expect(renderAddForm('en',staff)).not.toContain('<form');
  const html=renderAddForm('en');
  for(const action of ['/app/products/add/review','/app/products/add/photo','/app/products/add/store','/app/products/add/file','/app/products/prices-to-me'])expect(html).toContain(`action="${action}"`);
  expect(html).not.toContain('action="/app/products/add/confirm"');
 });
 it('folds unused quantity controls without disabling or dropping their submitted fields',()=>{
  const html=renderProductDetail(detail,'en');
  const optional=html.match(/<details class="product-optional">[\s\S]*?<\/details>/)?.[0]??'';
  expect(optional).toContain('name="moq"');expect(optional).toContain('name="leadTime"');
  expect(optional).not.toMatch(/disabled|type="hidden"/);
  expect(html.match(/name="isActive"/g)).toHaveLength(1);
  const configured=renderProductDetail({...detail,moq:12,leadTimeDays:5},'en');
  expect(configured).toContain('<details class="product-optional" open>');
  expect(configured).toContain('value="12"');
 });
 it('uses canonical price-limit links while refused forms keep their original POST and fragment',()=>{
  const rules={floor:usd('10'),maxDiscountPct:8,askAbovePct:5};
  const view:PriceRulesView={currency:'USD',unanswered:0,businessDefault:rules,products:[{productId:id,isActive:true,name:'Canvas tote',nameZh:null,sku:'TOTE',listPrice:usd('20'),own:rules,inheritsDefault:false}],volume:[]};
  const html=renderPriceRules(view,'en',null,{floor:'not_a_number'},{productId:id,values:{floor:'oops',maxDiscountPct:'8',askAbovePct:'5'}});
  expect(html).toContain(`href="/app/products/price-limits#p-${id}"`);
  const form=html.match(new RegExp(`<form[^>]+action="/app/business/prices#p-${id}"[^>]*>[\\s\\S]*?</form>`))?.[0]??'';
  expect(form).toContain('value="oops"');expect(form).toContain('aria-invalid="true"');expect(form).toContain('autofocus');
  expect(html.match(/id="pr-err-floor"/g)).toHaveLength(1);
  expect(html).toContain('action="/app/business/prices/volume#volume"');
 });

});
