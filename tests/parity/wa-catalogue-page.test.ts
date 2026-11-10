import { WA_CATALOGUE_CSS } from '../../src/api/web/waCatalogueStyle.js';
import { describe,expect,it } from 'vitest';
import { renderCatalogue,renderCatalogueReview } from '../../src/api/web/waCatalogue.js';
import { tickedLines } from '../../src/api/web/waCatalogueRoutes.js';
import { saidFlash } from '../../src/api/web/flash.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import type { CatalogueRow,CatalogueReview } from '../../src/db/waCatalogue.js';
const product:CatalogueRow={id:'product',name:'Linen shirt',active:true,findable:true,amount:'24.50',currency:'GBP',workspaceCurrency:'GBP',
  tiered:false,vetted:true,explicitlyVetted:true,pricesToOwner:false,practice:false,description:'Linen',link:'https://shop.example/shirt',
  availability:'in stock',brand:'Shop',condition:'new',imageId:'image',imageVersion:'photo',itemId:'item',retailerId:'retailer',state:'not_submitted',error:null,
  acceptedFingerprint:null,acceptedCatalog:null,acceptedAccount:null,photoId:'image',photoToken:'photo',fingerprint:'hash',reasons:[]};
const review:CatalogueReview={id:'batch',account_id:'account',catalog_id:'12345',state:'preview',handle:null,error:null,
  items:[{id:'line',item_id:'item',operation:'CREATE',fingerprint:'hash',snapshot:product,selected:false,result:'preview',error:null,warning:null}]};
describe('WhatsApp catalogue owner pages',()=>{
  it('keeps isolated grid labels and checkbox names aligned with the page direction',()=>{
    expect(WA_CATALOGUE_CSS).toContain('text-align:match-parent');
    expect(WA_CATALOGUE_CSS).toContain('[dir="rtl"] .wa-catalogue .wc-words:dir(ltr)');
    expect(WA_CATALOGUE_CSS).toContain('[dir="rtl"] .wc-check bdi:dir(ltr)');
  });
  for(const locale of ['en','ar'] as const){
    it(`${locale}: uses the existing action hierarchy and isolates new fallback words`,()=>{
      const html=renderCatalogue(locale,[product],true,false,null);
      expect(html).toContain('Update the WhatsApp catalogue');
      expect(html).toContain('name="availability"');
      expect(html).toContain('name="imageId"');
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html.match(/class="btn send"/g)).toHaveLength(1);
      expect(html).toContain('<bdi lang="en" dir="ltr"');
      expect(html).not.toMatch(/<span[^>]*dir="auto"[^>]*>\s*<bdi/);
      expect(buttonsAndDoors(html)).toEqual([]);
    });
    it(`${locale}: no review checkbox starts checked`,()=>{
      const html=renderCatalogueReview(locale,review,true);
      expect(html).toContain('type="checkbox"');expect(html).not.toMatch(/\schecked(?:[\s=>])/);
      expect(html).toContain('name="line:line"');expect(html).not.toContain('name="selected"');expect(html).toContain('Add to WhatsApp');
      expect(buttonsAndDoors(html)).toEqual([]);
    });
    it(`${locale}: every line is its own field, so ticking several keeps them all (C04)`,()=>{
      const ids=['1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed','6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b','a2c4e6f8-0b1d-4f3e-8a5c-7e9b1d3f5a7c'];
      const many={...review,items:ids.map(id=>({...review.items[0]!,id}))};
      const html=renderCatalogueReview(locale,many,true);
      const names=[...html.matchAll(/<input type="checkbox" name="([^"]+)"/g)].map(m=>m[1]);
      expect(names).toEqual(ids.map(id=>'line:'+id));
      expect(new Set(names).size).toBe(ids.length);
    });
    it(`${locale}: the count submitted is said in English, isolated, never "the ticked changes"`,()=>{
      for(const [key,n,words] of [['waCatalog.flash.submitted.one',1,'change was submitted'],['waCatalog.flash.submitted.other',3,'changes were submitted']] as const){
        const html=renderCatalogueReview(locale,{...review,state:'pending'},true,saidFlash(locale,key,{n}));
        expect(html).toMatch(new RegExp(`<bdi lang="en" dir="ltr" class="wc-words">\\u2068?${n}\\u2069? ${words}`));
        expect(html).not.toContain('The ticked changes were submitted');
      }
    });
    it(`${locale}: staff and Practice have no write controls`,()=>{
      for(const html of [renderCatalogue(locale,[product],false,false,null),renderCatalogue(locale,[product],true,true,null),renderCatalogueReview(locale,review,false)]){
        expect(html).not.toMatch(/<form\b|<button\b/);
      }
    });
  }
  describe('tickedLines — what the review form submits (C04)',()=>{
    const [a,b,c]=['1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed','6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b','a2c4e6f8-0b1d-4f3e-8a5c-7e9b1d3f5a7c'];
    const asBrowser=(...ids:string[])=>Object.fromEntries(new URLSearchParams(ids.map(id=>['line:'+id,'on'])));
    it('two and three ticks are two and three lines, in order',()=>{
      expect(tickedLines(asBrowser(a,b))).toEqual([a,b]);
      expect(tickedLines(asBrowser(a,b,c))).toEqual([a,b,c]);
    });
    it('none ticked is no lines; other fields are not lines',()=>{
      expect(tickedLines({})).toEqual([]);
      expect(tickedLines({other:'x'})).toEqual([]);
    });
    it('a malformed line, a doubled value, or the old shared field refuses the whole form',()=>{
      expect(tickedLines({'line:not-an-id':'on'})).toBeNull();
      expect(tickedLines({['line:'+a]:['on','on']})).toBeNull();
      expect(tickedLines({selected:a})).toBeNull();
      expect(tickedLines({selected:a,['line:'+b]:'on'})).toBeNull();
    });
  });
});
