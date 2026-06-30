(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SplitTripParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const IGNORE=/사업자|사업장|대표자|등록번호|주소|전화|연락처|승인번호|승인일시|카드번호|거래번호|주문번호|영수증|매장명|테이블|인원수|판매원|결제|과세|면세|부가세|공급가|소계|합계|총액|받은금액|거스름|잔돈|현금|신용카드|체크카드|감사합니다|교환|환불|문의|subtotal|grand\s*total|total|tax|vat|payment|receipt|merchant|address|phone|tel\b|card\b|cash|change|order\s*(?:no|number)|invoice|thank\s*you|合計|小計|消費税|領収書|現金|カード|電話|住所|お釣り|お預かり|レシート|谢谢|合计|小计|税额|发票/i;
  const DATE_TIME=/(?:19|20)\d{2}[./-]\s*\d{1,2}[./-]\s*\d{1,2}|\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})|\b\d{1,2}:\d{2}(?::\d{2})?\b/;
  const PHONE=/\b(?:0\d{1,2}-)?\d{3,4}-\d{4}\b/;
  const ADDRESS=/(?:특별시|광역시).*(?:시|군|구)|[가-힣]+(?:시|도|군|구)\s+[가-힣]+(?:로|길|동|읍|면)\b|\b(?:road|street|st\.|avenue|ave\.|city|district)\b/i;
  const MONEY=/(?:₩|¥|\$|€|£)?\s*-?\d[\d,.]*(?:\s*(?:원|엔|円|元))?/g;
  function detectCurrency(text){if(/₩|\bKRW\b|\d\s*원/i.test(text))return'KRW';if(/€|\bEUR\b/i.test(text))return'EUR';if(/£|\bGBP\b/i.test(text))return'GBP';if(/元|\bCNY\b|\bRMB\b/i.test(text))return'CNY';if(/¥|円|\bJPY\b|税込|消費税|合計/.test(text))return'JPY';if(/\$|\bUSD\b/i.test(text))return'USD';return'KRW'}
  function numberValue(raw){let value=raw.replace(/[₩¥$€£원엔円元\s]/g,'');if(value.includes(',')&&value.includes('.'))value=value.lastIndexOf('.')>value.lastIndexOf(',')?value.replace(/,/g,''):value.replace(/\./g,'').replace(',','.');else if(/,\d{1,2}$/.test(value))value=value.replace(',','.');else value=value.replace(/,/g,'');return Number(value)}
  const closeEnough=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(b)*.035);
  function parseLine(line){
    const clean=line.replace(/[|_]{2,}/g,' ').replace(/\s+/g,' ').trim();if(!clean||IGNORE.test(clean)||DATE_TIME.test(clean)||PHONE.test(clean)||ADDRESS.test(clean))return null;
    const nums=[...clean.matchAll(MONEY)].map(m=>({value:numberValue(m[0]),index:m.index})).filter(x=>Number.isFinite(x.value)&&x.value>=0);if(!nums.length)return null;
    const total=nums[nums.length-1];if(total.value<=0||total.value>100000000)return null;
    let qty=1,unit=total.value,cut=total.index;
    const explicit=clean.slice(0,total.index).match(/(?:x|×|\*)\s*(\d{1,2})\s*$|(?:수량\s*)?(\d{1,2})\s*(?:개|ea|pcs?|点|個)\s*$/i);
    if(explicit){qty=Number(explicit[1]||explicit[2]);unit=total.value/qty;cut=explicit.index}
    else if(nums.length>=3){const a=nums[nums.length-3],b=nums[nums.length-2];if(Number.isInteger(a.value)&&a.value>=1&&a.value<=50&&closeEnough(a.value*b.value,total.value)){qty=a.value;unit=b.value;cut=a.index}else if(Number.isInteger(b.value)&&b.value>=1&&b.value<=50&&closeEnough(a.value*b.value,total.value)){qty=b.value;unit=a.value;cut=a.index}}
    let name=clean.slice(0,cut).replace(/^(?:\d{1,3}\s+|[-•·*#]+\s*)/,'').replace(/\s+(?:x|×|\*)?\s*\d{1,2}\s*$/i,'').trim();
    name=name.replace(/[^\p{L}\p{N}\s&+().'’\-/]/gu,' ').replace(/\s+/g,' ').trim();const letters=(name.match(/[\p{L}]/gu)||[]).length;
    if(name.length<2||letters<2||IGNORE.test(name)||qty<1||qty>50||unit<=0)return null;
    return{name:name.slice(0,45),qty,price:Math.round(unit*100)/100};
  }
  function parseOCR(text,peopleCount=0){const items=[],seen=new Set();text.replace(/\r/g,'').split('\n').forEach(line=>{const item=parseLine(line);if(!item)return;const key=`${item.name.toLowerCase()}|${item.qty}|${item.price}`;if(seen.has(key))return;seen.add(key);items.push({...item,id:Math.random().toString(36).slice(2,9),alloc:Array(peopleCount).fill(0)})});return items.slice(0,30)}
  return{detectCurrency,parseOCR,parseLine};
});
