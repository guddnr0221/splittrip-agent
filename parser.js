(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SplitTripParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  // These expressions describe receipt roles, not one particular receipt layout.
  // Ambiguous lines are intentionally discarded: a missed item is safer than a
  // phone number or payment total silently becoming a shared expense.
  const META_WORDS=/사업자|사업장|대표자|등록번호|주소|도로명|전화|연락처|승인번호|승인일시|카드번호|거래번호|주문번호|영수증|매장명|테이블|인원수|판매원|계산원|포스|고객|문의|교환|환불|감사합니다|merchant|address|phone|tel\b|fax\b|cashier|register|table|guest|receipt|invoice|transaction|approval|auth(?:orization)?|card\s*(?:no|number)|order\s*(?:no|number)|thank\s*you|店舗|店名|住所|電話|担当|係員|レジ|客数|人数|伝票|領収書|レシート|取引|承認|カード番号|注文番号|谢谢|地址|电话|收银员|订单号|发票/i;
  const SUMMARY_WORDS=/공급가|과세|면세|부가세|세액|소계|합계|총액|총\s*결제|결제\s*금액|받은\s*금액|거스름|잔돈|할인|현금|신용카드|체크카드|subtotal|grand\s*total|amount\s*due|balance|total|tax|vat|discount|payment|tender|cash|change|credit|debit|小計|合計|総額|消費税|内税|外税|課税|免税|値引|割引|お預かり|お釣り|現金|クレジット|カード|売上|点数|合计|小计|税额|折扣|支付|现金|找零|信用卡/i;
  const SUBTOTAL_OR_TAX=/공급가|과세|면세|부가세|세액|소계|subtotal|tax|vat|小計|消費税|内税|外税|課税|免税|税額|小计|税额/i;
  const PAYMENT_ONLY=/받은\s*금액|거스름|잔돈|현금|신용카드|체크카드|payment|tender|cash|change|credit|debit|お預かり|お釣り|現金|クレジット|カード|支付|现金|找零|信用卡/i;
  const FINAL_TOTAL=/최종\s*(?:합계|금액)|총\s*(?:합계|금액|결제액?)|총액|결제\s*금액|^\s*합계|grand\s*total|amount\s*due|balance\s*due|net\s*total|^\s*total\b|総合計|総額|お支払(?:い)?額|請求額|^\s*合計|总计|应付|^\s*合计/i;
  const HEADER_WORDS=/품명|품목|상품명|수량|단가|금액|item|description|product|qty|quantity|unit\s*price|amount|品名|商品|数量|単価|金額|项目|商品名|数量|单价|金额/i;
  const DATE_TIME=/(?:19|20)\d{2}\s*[./年-]\s*\d{1,2}\s*[./月-]\s*\d{1,2}(?:日)?|\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*(?:\d{2}|\d{4})|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b(?:19|20)\d{2}[01]\d[0-3]\d\b/;
  const PHONE=/(?:\+?\d{1,3}[\s.-]?)?(?:\(?0\d{1,3}\)?[\s.-]?)?\d{2,4}[\s.-]\d{2,4}[\s.-]\d{3,4}/;
  const WEB_OR_ID=/https?:|www\.|@\w|[A-Z0-9]{8,}[-_/][A-Z0-9-_/]{3,}|(?:no|id|code|ref)[.:#\s-]*[A-Z0-9-]{5,}/i;
  // Do not treat digits embedded in product codes (UU03, M2, AB-100) as money.
  const MONEY=/(?<![\p{L}\p{N}])(?:[₩￦¥￥$€£]|KRW|JPY|USD|EUR|GBP|CNY|RMB)?\s*[-+]?\d[\d,.]*(?![\p{L}\p{N}])/giu;
  const CURRENCY_MARK=/(?:[₩￦¥￥$€£]|\b(?:KRW|JPY|USD|EUR|GBP|CNY|RMB)\b)/i;

  function detectCurrency(text){
    if(/[₩￦]|\bKRW\b|\d\s*원/i.test(text))return'KRW';
    if(/€|\bEUR\b/i.test(text))return'EUR';
    if(/£|\bGBP\b/i.test(text))return'GBP';
    if(/\bCNY\b|\bRMB\b|人民币|合计/.test(text))return'CNY';
    if(/[¥￥]|\bJPY\b|円|消費税|合計/.test(text))return'JPY';
    if(/\$|\bUSD\b/i.test(text))return'USD';
    return'KRW';
  }

  function numberValue(raw){
    let value=raw.replace(/[₩￦¥￥$€£\s]|KRW|JPY|USD|EUR|GBP|CNY|RMB/gi,'');
    if(value.includes(',')&&value.includes('.'))value=value.lastIndexOf('.')>value.lastIndexOf(',')?value.replace(/,/g,''):value.replace(/\./g,'').replace(',','.');
    else if(/,\d{1,2}$/.test(value))value=value.replace(',','.');
    else value=value.replace(/,/g,'');
    return Number(value);
  }

  function normalize(line){return String(line||'').replace(/[|_]{2,}/g,' ').replace(/[\t\u00a0]+/g,' ').replace(/\s+/g,' ').trim()}
  function semanticMatch(pattern,line){
    const clean=normalize(line);if(pattern.test(clean))return true;
    // OCR often inserts spaces between label glyphs: 小 計, 合 計, T O T A L.
    const compact=clean.replace(/[\s:：|_]+/g,'');
    if(pattern.test(compact))return true;
    if(pattern===FINAL_TOTAL)return /^(?:최종합계|최종금액|총합계|총금액|총결제액?|총액|결제금액|GRANDTOTAL|AMOUNTDUE|BALANCEDUE|NETTOTAL|TOTAL|総合計|総額|お支払(?:い)?額|請求額|合計|总计|应付|合计)/i.test(compact);
    return false;
  }
  function amountsIn(clean){
    return[...clean.matchAll(MONEY)].map(m=>({raw:m[0],value:numberValue(m[0]),index:m.index,end:m.index+m[0].length,marked:CURRENCY_MARK.test(m[0]),decimal:/[.,]\d{1,2}\s*$/.test(m[0])})).filter(x=>Number.isFinite(x.value)&&x.value>=0);
  }
  const closeEnough=(a,b)=>Math.abs(a-b)<=Math.max(1,Math.abs(b)*.035);
  function compactDateNumber(n){
    const s=String(Math.trunc(n));
    if(/^20\d{2}$/.test(s))return true;
    if(/^20\d{2}(?:0[1-9]|1[0-2])$/.test(s))return true;
    return /^20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(s);
  }
  function hasUsefulName(name){
    const letters=(name.match(/[\p{L}]/gu)||[]).length;
    const latinOnly=/^[A-Za-z\s&+().'\-/]+$/.test(name);
    if(letters<2||name.length<2)return false;
    if(latinOnly&&letters<3)return false;
    if(/^(?:get|set|no|id|code|item|qty|ea|pcs?)$/i.test(name.replace(/[^A-Za-z]/g,'')))return false;
    return true;
  }
  function cleanName(raw){
    return raw
      .replace(/^[-*#•·:;]+\s*/,'')
      .replace(/^\d{3,10}\s*/,'')
      .replace(/^(?:[O0U]{2,}\d{1,4})\s*/i,'')
      .replace(/\s+(?:x|×|\*)\s*\d{1,2}\s*$/i,'')
      .replace(/[^\p{L}\p{N}\s&+().'’\-/]/gu,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function parsePriceDetailLine(line){
    const clean=normalize(line),match=clean.match(/(?:단가|単価?|@)?\s*([¥￥₩￦$€£]?\s*\d[\d,.]*)\s*[x×*]\s*(\d{1,2})\s*(?:개|個|点|ea|pcs?)?.*?([¥￥₩￦$€£]?\s*\d[\d,.]*)\s*$/i);
    if(!match)return null;
    const unit=numberValue(match[1]),qty=Number(match[2]),total=numberValue(match[3]);
    if(!Number.isFinite(unit)||!Number.isFinite(total)||qty<1||qty>50||unit<=0||!closeEnough(unit*qty,total))return null;
    return{qty,price:Math.round(unit*100)/100,total};
  }

  function productNameCandidate(line){
    const clean=normalize(line);
    if(!clean||semanticMatch(META_WORDS,clean)||semanticMatch(SUMMARY_WORDS,clean)||semanticMatch(HEADER_WORDS,clean)||DATE_TIME.test(clean)||PHONE.test(clean)||WEB_OR_ID.test(clean))return'';
    const name=cleanName(clean);
    return hasUsefulName(name)?name.slice(0,45):'';
  }

  function parseLine(line,options={}){
    const clean=normalize(line),currency=options.currency||'KRW';
    if(!clean||semanticMatch(META_WORDS,clean)||semanticMatch(SUMMARY_WORDS,clean)||semanticMatch(HEADER_WORDS,clean)||DATE_TIME.test(clean)||PHONE.test(clean)||WEB_OR_ID.test(clean))return null;

    const nums=amountsIn(clean);
    if(!nums.length||nums.length>5)return null;
    const total=nums[nums.length-1];
    if(total.value<=0||total.value>100000000)return null;
    if(compactDateNumber(total.value)&&!total.marked&&!total.decimal)return null;

    let qty=1,unit=total.value,cut=total.index,structured=false;
    const beforeTotal=clean.slice(0,total.index);
    const explicit=beforeTotal.match(/(?:x|×|\*)\s*(\d{1,2})\s*$|(?:수량|数量|qty)\s*[:x×]?\s*(\d{1,2})\s*(?:개|個|点|ea|pcs?)?\s*$|(\d{1,2})\s*(?:点|ea|pcs?)\s*$/i);
    if(explicit){
      qty=Number(explicit[1]||explicit[2]||explicit[3]);unit=total.value/qty;cut=explicit.index;structured=true;
    }else if(nums.length>=3){
      const a=nums[nums.length-3],b=nums[nums.length-2];
      if(Number.isInteger(a.value)&&a.value>=1&&a.value<=50&&closeEnough(a.value*b.value,total.value)){qty=a.value;unit=b.value;cut=a.index;structured=true}
      else if(Number.isInteger(b.value)&&b.value>=1&&b.value<=50&&closeEnough(a.value*b.value,total.value)){qty=b.value;unit=a.value;cut=a.index;structured=true}
    }else if(nums.length===2){
      const possibleQty=nums[0];
      if(Number.isInteger(possibleQty.value)&&possibleQty.value>=1&&possibleQty.value<=50&&cleanName(clean.slice(0,possibleQty.index)).length>=2){qty=possibleQty.value;unit=total.value;cut=possibleQty.index;structured=true}
    }

    const name=cleanName(clean.slice(0,cut));
    if(!hasUsefulName(name)||semanticMatch(META_WORDS,name)||semanticMatch(SUMMARY_WORDS,name)||qty<1||qty>50||unit<=0)return null;

    // A bare 1–31/49 is more likely a day, count or reference than a price in
    // integer-heavy currencies. Decimal/currency-marked values remain valid.
    if(!structured&&!total.marked&&!total.decimal&&['KRW','JPY','CNY'].includes(currency)&&total.value<50)return null;

    const digitCount=(name.match(/\d/g)||[]).length;
    const letterCount=(name.match(/[\p{L}]/gu)||[]).length;
    if(digitCount>letterCount*1.25)return null;

    return{name:name.slice(0,45),qty,price:Math.round(unit*100)/100};
  }

  function parseOCR(text,peopleCount=0){
    const currency=detectCurrency(text),lines=String(text||'').replace(/\r/g,'').split('\n').map(normalize).filter(Boolean);
    const items=[],seen=new Set();
    let foundItem=false,summaryReached=false,pendingName='';
    const addItem=item=>{
      const key=`${item.name.toLowerCase()}|${item.qty}|${item.price}`;
      if(seen.has(key))return;
      seen.add(key);foundItem=true;
      items.push({...item,id:Math.random().toString(36).slice(2,9),alloc:Array(peopleCount).fill(0)});
    };
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(semanticMatch(SUMMARY_WORDS,line)){
        if(foundItem)summaryReached=true;
        continue;
      }
      // Once a real item section has ended, payment/footer numbers cannot be items.
      if(summaryReached)continue;
      const detail=parsePriceDetailLine(line);
      if(detail&&pendingName){addItem({name:pendingName,qty:detail.qty,price:detail.price});pendingName='';continue}
      let item=parseLine(line,{currency});

      // Support receipts where OCR separates a product name and its amount onto
      // adjacent lines, but only when the second line is purely numeric/money.
      if(!item&&i+1<lines.length&&!amountsIn(line).length&&hasUsefulName(cleanName(line))&&!semanticMatch(META_WORDS,line)&&!semanticMatch(HEADER_WORDS,line)){
        const next=lines[i+1],nextWithoutMoney=next.replace(MONEY,'').replace(/[\s:;|]/g,'');
        if(amountsIn(next).length&&nextWithoutMoney===''){
          item=parseLine(`${line} ${next}`,{currency});
          if(item)i++;
        }
      }
      if(item){addItem(item);pendingName='';continue}
      const candidate=productNameCandidate(line);
      if(candidate&&!/^\d+$/.test(candidate))pendingName=candidate;
    }
    return items.slice(0,30);
  }

  function findStatedTotal(text){
    const lines=String(text||'').replace(/\r/g,'').split('\n').map(normalize).filter(Boolean);
    let best=null;
    lines.forEach((line,index)=>{
      if(!semanticMatch(FINAL_TOTAL,line)||semanticMatch(SUBTOTAL_OR_TAX,line)||semanticMatch(PAYMENT_ONLY,line))return;
      const nums=amountsIn(line),amount=nums.length?nums[nums.length-1].value:NaN;
      if(!Number.isFinite(amount)||amount<=0||amount>100000000)return;
      const priority=/최종|총액|총\s*(?:합계|금액|결제)|grand\s*total|amount\s*due|balance\s*due|総合計|総額|お支払|請求額|总计|应付/i.test(line)?3:2;
      if(!best||priority>best.priority||(priority===best.priority&&index>best.index))best={amount,priority,index,label:line.slice(0,60)};
    });
    return best;
  }

  function analyzeOCR(text,peopleCount=0){
    const currency=detectCurrency(text),items=parseOCR(text,peopleCount),summary=findStatedTotal(text);
    const calculatedTotal=Math.round(items.reduce((sum,item)=>sum+item.qty*item.price,0)*100)/100;
    const statedTotal=summary?summary.amount:null;
    const difference=statedTotal==null?null:Math.round((calculatedTotal-statedTotal)*100)/100;
    const tolerance=statedTotal==null?0:Math.max(1,Math.abs(statedTotal)*.01);
    return{
      currency,items,calculatedTotal,statedTotal,difference,
      totalMatches:statedTotal==null?null:Math.abs(difference)<=tolerance,
      totalLabel:summary?summary.label:''
    };
  }
  return{detectCurrency,parseOCR,parseLine,analyzeOCR,findStatedTotal};
});
