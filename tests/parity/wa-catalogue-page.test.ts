import { WA_CATALOGUE_CSS } from '../../src/api/web/waCatalogueStyle.js';
import { describe,expect,it } from 'vitest';
import { renderCatalogue,renderCatalogueReview } from '../../src/api/web/waCatalogue.js';
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
      expect(html).toContain('value="line"');expect(html).toContain('Add to WhatsApp');
      expect(buttonsAndDoors(html)).toEqual([]);
    });
    it(`${locale}: staff and Practice have no write controls`,()=>{
      for(const html of [renderCatalogue(locale,[product],false,false,null),renderCatalogue(locale,[product],true,true,null),renderCatalogueReview(locale,review,false)]){
        expect(html).not.toMatch(/<form\b|<button\b/);
      }
    });
  }
});
