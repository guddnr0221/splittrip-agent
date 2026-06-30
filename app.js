const COLORS=['#dff5b2','#d9ebff','#ffe0d3','#eadcff','#d5f2e8','#fff0b9','#f7d8e7','#d8e4db'];
const CURRENCIES={KRW:{symbol:'₩',name:'대한민국 원'},JPY:{symbol:'¥',name:'일본 엔'},USD:{symbol:'$',name:'미국 달러'},EUR:{symbol:'€',name:'유로'},GBP:{symbol:'£',name:'영국 파운드'},CNY:{symbol:'¥',name:'중국 위안'}};
const STORAGE_KEY='splittrip-state-v2';
const state={people:[],receipts:[],activeReceipt:0};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const {detectCurrency,parseOCR:parseReceiptText}=window.SplitTripParser;
const money=(n,c='KRW')=>`${CURRENCIES[c]?.symbol||''}${Math.round(n||0).toLocaleString('ko-KR')}`;
const uid=()=>Math.random().toString(36).slice(2,9);

function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function load(){try{const s=JSON.parse(localStorage.getItem(STORAGE_KEY));if(s&&Array.isArray(s.people)&&Array.isArray(s.receipts))Object.assign(state,s)}catch(e){}}
function toast(msg){$('#toast p').textContent=msg;$('#toast').classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').classList.remove('show'),2600)}
function initials(name){return name.trim().slice(0,1).toUpperCase()}
function renderPeople(){
  $('#peopleCount').textContent=state.people.length;
  $('#peopleList').innerHTML=state.people.length?state.people.map((p,i)=>`<div class="person-chip"><span class="avatar" style="background:${COLORS[i]}">${initials(p)}</span><b>${esc(p)}</b><button data-remove-person="${i}" aria-label="${esc(p)} 삭제">×</button></div>`).join(''):'<div class="people-empty"><span>＋</span><p><b>첫 참여자를 추가해 주세요</b><small>아래 입력창에 여행 멤버의 이름을 적어주세요.</small></p></div>';
  $$('[data-remove-person]').forEach(b=>b.onclick=()=>{if(state.receipts.length&&state.people.length<=2)return toast('영수증이 있을 때는 최소 2명이 필요해요.');const removed=+b.dataset.removePerson;state.people.splice(removed,1);state.receipts.forEach(r=>{if(r.payer===removed)r.payer=0;else if(r.payer>removed)r.payer--;r.items.forEach(x=>x.alloc=x.alloc.filter((_,idx)=>idx!==removed))});save();renderAll()});
}
function addPerson(){const input=$('#personInput'),name=input.value.trim();if(!name)return toast('이름을 입력해 주세요.');if(state.people.length>=8)return toast('참여자는 최대 8명까지 추가할 수 있어요.');if(state.people.includes(name))return toast('같은 이름이 이미 있어요.');state.people.push(name);state.receipts.forEach(r=>r.items.forEach(x=>x.alloc.push(0)));input.value='';save();renderAll()}

async function preprocessReceipt(file){
  const bitmap=await createImageBitmap(file),longest=Math.max(bitmap.width,bitmap.height),scale=Math.min(2,2200/longest),canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const image=ctx.getImageData(0,0,canvas.width,canvas.height),data=image.data,hist=new Uint32Array(256);
  for(let i=0;i<data.length;i+=4){const gray=Math.round(data[i]*.299+data[i+1]*.587+data[i+2]*.114);hist[gray]++}
  const pixels=data.length/4,edge=pixels*.015;let low=0,high=255,sum=0;while(low<245&&(sum+=hist[low])<edge)low++;sum=0;while(high>10&&(sum+=hist[high])<edge)high--;
  const range=Math.max(40,high-low);for(let i=0;i<data.length;i+=4){let gray=data[i]*.299+data[i+1]*.587+data[i+2]*.114;gray=Math.max(0,Math.min(255,(gray-low)*255/range));gray=gray>242?255:Math.pow(gray/255,.9)*255;data[i]=data[i+1]=data[i+2]=gray}
  ctx.putImageData(image,0,0);return new Promise(resolve=>canvas.toBlob(blob=>resolve(blob||file),'image/jpeg',.92));
}
function sampleReceipt(){
  if(state.people.length<2)return toast('참여자를 먼저 2명 이상 추가해 주세요.');
  const r={id:uid(),name:'도쿄 저녁 식사',currency:'JPY',payer:Math.min(2,state.people.length-1),image:'',items:[
    ['미소 라멘',2,980],["돈코츠 라멘",1,1150],['교자',2,580],['생맥주',3,650],['우롱차',1,320]
  ].map(([name,qty,price])=>({id:uid(),name,qty,price,alloc:Array(state.people.length).fill(0)}))};
  state.receipts.push(r);state.activeReceipt=state.receipts.length-1;save();renderAll();toast('샘플 영수증을 불러왔어요. 품목을 바로 배분해 보세요.');$('#receiptEditor').scrollIntoView({behavior:'smooth',block:'center'});
}
async function scanFiles(files){
  if(state.people.length<2)return toast('참여자를 먼저 2명 이상 추가해 주세요.');
  const valid=files.filter(file=>{
    if(file.size>10*1024*1024){toast(`${file.name}: 10MB 이하 사진만 가능해요.`);return false}
    if(file.type&&!file.type.startsWith('image/')){toast(`${file.name}: 이미지 파일만 올릴 수 있어요.`);return false}
    return true
  });
  if(!valid.length)return;
  $('#scanStatus').classList.remove('hidden');
  let worker;
  try{
    if(!window.Tesseract?.createWorker)throw new Error('OCR library unavailable');
    let current=0;
    worker=await Tesseract.createWorker('kor+eng+jpn',1,{
      workerPath:'./vendor/ocr-worker.js',
      workerBlobURL:false,
      corePath:'./vendor/core',
      langPath:'./vendor/lang',
      logger:m=>{if(m.progress){const p=Math.round(((current+m.progress)/valid.length)*100);$('#scanPercent').textContent=Math.min(100,p)+'%';$('#scanText').textContent=m.status==='recognizing text'?`${current+1}번째 영수증의 품목과 가격을 찾는 중...`:'OCR 엔진을 준비하는 중...'}}
    });
    await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
    for(const file of valid){
      let text='';
      try{const prepared=await preprocessReceipt(file),result=await worker.recognize(prepared);text=result.data.text||''}
      catch(e){toast(`${file.name}: 글자를 충분히 읽지 못해 직접 입력 화면을 열었어요.`)}
      const parsed=parseReceiptText(text,state.people.length);
      state.receipts.push({id:uid(),name:file.name.replace(/\.[^.]+$/,''),currency:detectCurrency(text),payer:0,image:URL.createObjectURL(file),items:parsed.length?parsed:[{id:uid(),name:'품목명을 입력하세요',qty:1,price:0,alloc:Array(state.people.length).fill(0)}]});
      state.activeReceipt=state.receipts.length-1;current++;
    }
  }catch(e){
    valid.forEach(file=>state.receipts.push({id:uid(),name:file.name.replace(/\.[^.]+$/,''),currency:'KRW',payer:0,image:URL.createObjectURL(file),items:[{id:uid(),name:'품목명을 입력하세요',qty:1,price:0,alloc:Array(state.people.length).fill(0)}]}));
    state.activeReceipt=state.receipts.length-1;toast('OCR 엔진을 시작하지 못해 직접 입력 화면을 열었어요.');
  }finally{
    if(worker)await worker.terminate();$('#scanStatus').classList.add('hidden');save();renderAll();
  }
}
function renderReceipts(){
  $('#receiptTabs').innerHTML=state.receipts.map((r,i)=>`<button class="receipt-tab ${i===state.activeReceipt?'active':''}" data-tab="${i}">영수증 ${i+1} · ${esc(r.name)}</button>`).join('');
  $$('[data-tab]').forEach(b=>b.onclick=()=>{state.activeReceipt=+b.dataset.tab;renderReceipts()});
  const r=state.receipts[state.activeReceipt];
  if(!r){$('#receiptEditor').innerHTML='';return}
  $('#receiptEditor').innerHTML=`<div class="editor"><div class="editor-meta"><div class="field"><label>영수증 이름</label><input data-meta="name" value="${esc(r.name)}"></div><div class="field"><label>자동 인식 통화</label><select data-meta="currency">${Object.entries(CURRENCIES).map(([k,v])=>`<option value="${k}" ${r.currency===k?'selected':''}>${v.symbol} ${k}</option>`).join('')}</select></div><div class="field"><label>결제한 사람</label><select data-meta="payer">${state.people.map((p,i)=>`<option value="${i}" ${r.payer===i?'selected':''}>${esc(p)}</option>`).join('')}</select></div></div><div class="item-table-head"><span>품목</span><span>수량</span><span>개당 가격</span><span></span></div><div id="editorItems">${r.items.map((x,i)=>itemRow(x,i,r.currency)).join('')}</div><div class="editor-footer"><button id="addItemBtn">＋ 품목 추가</button><span class="editor-total">영수증 합계 <b>${money(receiptTotal(r),r.currency)}</b></span></div></div>`;
  $$('[data-meta]').forEach(el=>el.onchange=()=>{r[el.dataset.meta]=el.dataset.meta==='payer'?+el.value:el.value;save();renderAll()});
  $$('[data-item-field]').forEach(el=>el.onchange=()=>{const x=r.items[+el.dataset.index],field=el.dataset.itemField;x[field]=field==='name'?el.value:Math.max(field==='qty'?1:0,+el.value||0);if(field==='qty'){x.alloc=x.alloc.map(v=>Math.min(v,x.qty))}save();renderAll()});
  $$('[data-remove-item]').forEach(b=>b.onclick=()=>{r.items.splice(+b.dataset.removeItem,1);save();renderAll()});
  $('#addItemBtn').onclick=()=>{r.items.push({id:uid(),name:'새 품목',qty:1,price:0,alloc:Array(state.people.length).fill(0)});save();renderAll()};
}
function itemRow(x,i,c){return `<div class="item-row"><input data-item-field="name" data-index="${i}" value="${esc(x.name)}"><input type="number" min="1" data-item-field="qty" data-index="${i}" value="${x.qty}"><input type="number" min="0" data-item-field="price" data-index="${i}" value="${x.price}" aria-label="가격"><button data-remove-item="${i}" aria-label="품목 삭제">×</button></div>`}
function receiptTotal(r){return r.items.reduce((s,x)=>s+x.qty*x.price,0)}

function renderAllocation(){
  const list=[];state.receipts.forEach((r,ri)=>r.items.forEach((x,xi)=>{while(x.alloc.length<state.people.length)x.alloc.push(0);const used=x.alloc.reduce((a,b)=>a+b,0),done=used===x.qty;list.push(`<div class="alloc-card ${done?'complete':''}"><div class="alloc-top"><span class="alloc-icon">${['🍜','☕','🍺','🥟','🛍️'][(ri+xi)%5]}</span><div class="alloc-name"><b>${esc(x.name)}</b><small>영수증 ${ri+1} · ${money(x.price,r.currency)} × ${x.qty}개</small></div><span class="alloc-state">${done?'✓ 배분 완료':`${used} / ${x.qty}개`}</span></div><div class="alloc-controls">${state.people.map((p,pi)=>`<div class="person-qty"><span class="mini-avatar" style="background:${COLORS[pi]}">${initials(p)}</span><span>${esc(p)}</span><div class="qty-control"><button data-qty="-1" data-r="${ri}" data-i="${xi}" data-p="${pi}">−</button><span>${x.alloc[pi]||0}</span><button data-qty="1" data-r="${ri}" data-i="${xi}" data-p="${pi}">＋</button></div></div>`).join('')}</div></div>`)}));
  $('#allocationList').innerHTML=list.join('');
  $$('[data-qty]').forEach(b=>b.onclick=()=>changeQty(+b.dataset.r,+b.dataset.i,+b.dataset.p,+b.dataset.qty));
  const has=state.receipts.length>0;$('#allocation').classList.toggle('hidden-section',!has);$('#result').classList.toggle('hidden-section',!has);
}
function changeQty(ri,xi,pi,d){const x=state.receipts[ri].items[xi],used=x.alloc.reduce((a,b)=>a+b,0),next=(x.alloc[pi]||0)+d;if(next<0)return;if(d>0&&used>=x.qty)return toast(`“${x.name}”은(는) ${x.qty}개까지만 배분할 수 있어요.`);x.alloc[pi]=next;save();renderAllocation();updateSummary()}
function allocationsValid(){return state.receipts.flatMap(r=>r.items.map(x=>({name:x.name,ok:x.alloc.reduce((a,b)=>a+b,0)===x.qty}))).filter(x=>!x.ok)}
function calculate(){
  if(state.people.length<2)return toast('참여자를 먼저 2명 이상 추가해 주세요.');if(!state.receipts.length)return toast('먼저 영수증을 추가해 주세요.');const invalid=allocationsValid();if(invalid.length){$('#modalText').textContent=`${invalid.slice(0,3).map(x=>'“'+x.name+'”').join(', ')}${invalid.length>3?' 외 '+(invalid.length-3)+'개':''} 품목의 수량을 확인해 주세요.`;$('#modal').classList.remove('hidden');return}
  renderResults();$('#result').classList.remove('hidden-section');$$('.step').forEach((x,i)=>x.classList.toggle('active',i===3));$('#result').scrollIntoView({behavior:'smooth'});
}
function renderResults(){
  const html=[];
  state.people.forEach((p,pi)=>{
    const outgoing={},incoming={};
    state.receipts.forEach(r=>r.items.forEach(x=>state.people.forEach((_,consumer)=>{
      const amount=(x.alloc[consumer]||0)*x.price;if(!amount||consumer===r.payer)return;
      if(consumer===pi){const key=`${r.payer}|${r.currency}`;outgoing[key]=(outgoing[key]||0)+amount}
      if(r.payer===pi){const key=`${consumer}|${r.currency}`;incoming[key]=(incoming[key]||0)+amount}
    })));
    const outEntries=Object.entries(outgoing),inEntries=Object.entries(incoming),paid=inEntries.length>0;
    const headline=outEntries.length?Object.entries(outEntries.reduce((a,[k,n])=>{const c=k.split('|')[1];a[c]=(a[c]||0)+n;return a},{})).map(([c,n])=>money(n,c)).join(' + '):paid?'받을 금액 있음':'0원';
    const detail=[...outEntries.map(([k,n])=>`${state.people[+k.split('|')[0]]}에게 ${money(n,k.split('|')[1])}`),...inEntries.map(([k,n])=>`${state.people[+k.split('|')[0]]}에게 받을 금액 ${money(n,k.split('|')[1])}`)].join('<br>')||'추가 송금 내역이 없어요.';
    html.push(`<div class="result-card ${paid&&!outEntries.length?'payer':''}"><div class="result-person"><span class="avatar" style="background:${COLORS[pi]};color:#17231f">${initials(p)}</span><b>${esc(p)}</b></div><small>${outEntries.length?'총 보낼 금액':paid?'결제자 정산':'정산 금액'}</small><strong>${headline}</strong><p>${detail}</p></div>`)
  });$('#resultCards').innerHTML=html.join('');updateSummary();
}
function updateSummary(){const all=state.receipts.flatMap(r=>r.items),done=all.filter(x=>x.alloc.reduce((a,b)=>a+b,0)===x.qty).length;$('#receiptCount').textContent=state.receipts.length+'장';const totals={};state.receipts.forEach(r=>totals[r.currency]=(totals[r.currency]||0)+receiptTotal(r));$('#grandTotal').textContent=Object.entries(totals).map(([c,n])=>money(n,c)).join(' + ')||'—';$('#doneItems').textContent=`${done} / ${all.length}`;$('#actionHint').textContent=state.people.length<2?`참여자를 ${2-state.people.length}명 더 추가해 주세요`:state.receipts.length?`${all.length}개 품목 중 ${done}개 배분 완료`:'영수증을 추가해 정산을 시작하세요'}
function renderAll(){renderPeople();renderReceipts();renderAllocation();updateSummary();const ready=state.people.length>=2;$('#sampleBtn').disabled=!ready;$('#fileInput').disabled=!ready;$('#dropzone').classList.toggle('disabled',!ready);$('#dropzone').setAttribute('aria-disabled',String(!ready));$$('.step').forEach((s,i)=>s.classList.toggle('active',i===(state.receipts.length?2:0)))}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

$('#addPersonBtn').onclick=addPerson;$('#personInput').onkeydown=e=>{if(e.key==='Enter')addPerson()};$('#sampleBtn').onclick=sampleReceipt;$('#fileInput').onchange=e=>scanFiles([...e.target.files]);
const dz=$('#dropzone');['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.add('drag')}));['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.remove('drag')}));dz.addEventListener('drop',e=>scanFiles([...e.dataTransfer.files]));
$('#calculateBtn').onclick=calculate;$('#modalClose').onclick=()=>$('#modal').classList.add('hidden');$('#modal').onclick=e=>{if(e.target.id==='modal')e.currentTarget.classList.add('hidden')};
$$('.step').forEach(s=>s.onclick=()=>$('#'+s.dataset.target).scrollIntoView({behavior:'smooth',block:'start'}));
$('#resetBtn').onclick=()=>{if(confirm('현재 정산 내용을 모두 지울까요?')){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem('splittrip-state');location.reload()}};
load();renderAll();
document.documentElement.dataset.ocrReady=window.Tesseract?.createWorker?'true':'false';
