(()=>{
const C=window.CraneCore,{S,cv,stage,$,screenToImg,imgToWorld,draw}=C;
const status=$('status'),coords=$('coords'),hint=$('hint');
let pointers=new Map(),gesture=null,drag=false,last=null,calStep=0,measureStart=null;
function setStatus(t){status.textContent=t}
function show(id){$(id).classList.add('show')}
function hide(id){$(id).classList.remove('show')}
function screenPos(e){const r=cv.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function setMode(m){
 S.mode=m;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
 measureStart=null;S.active=null;S.cross=null;hint.style.display='none';
 const msg={pan:'1本指で移動。2本指でズーム。',measure:'寸法線：始点→終点をタップ。',coord:'座標確認：図上を指でなぞる。',line:'直線：始点から終点までドラッグ。',arrow:'矢印：始点から終点までドラッグ。'}[m];
 setStatus(msg||'');draw()
}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hide(b.dataset.close));
document.querySelectorAll('.sheetback').forEach(s=>s.addEventListener('click',e=>{if(e.target===s)s.classList.remove('show')}));
$('zin').onclick=()=>C.zoomAt(1.3,stage.clientWidth/2,stage.clientHeight/2);
$('zout').onclick=()=>C.zoomAt(.77,stage.clientWidth/2,stage.clientHeight/2);
$('fit').onclick=C.fit;

$('file').onchange=e=>{
 const f=e.target.files&&e.target.files[0];if(!f)return;
 const u=URL.createObjectURL(f),n=new Image();
 n.onload=()=>{S.img=n;S.iw=n.naturalWidth;S.ih=n.naturalHeight;S.objects=[];S.cal={O:null,X:null,Y:null,xm:5,ym:5,ready:false};coords.textContent='未校正';C.fit();URL.revokeObjectURL(u);setStatus('画像OK。次に「校正」を押してください。')};
 n.onerror=()=>setStatus('画像を読めませんでした');
 n.src=u
};

$('calBtn').onclick=()=>show('sheetCal');
$('startCal').onclick=()=>{
 if(!S.img){hide('sheetCal');return setStatus('先に画像を開いてください')}
 S.cal.xm=parseFloat($('calX').value)||5;S.cal.ym=parseFloat($('calY').value)||5;S.cal.O=S.cal.X=S.cal.Y=null;S.cal.ready=false;calStep=1;hide('sheetCal');setMode('pan');
 hint.style.display='block';hint.innerHTML='<b>校正 1/3：</b> 作業半径0m・高さ0mの原点をタップ';setStatus('校正中：原点をタップ')
};
function calTap(p){
 const ip=screenToImg(p);
 if(calStep===1){S.cal.O=ip;calStep=2;hint.innerHTML='<b>校正 2/3：</b> 横軸 '+S.cal.xm+'m の点をタップ'}
 else if(calStep===2){S.cal.X=ip;calStep=3;hint.innerHTML='<b>校正 3/3：</b> 縦軸 '+S.cal.ym+'m の点をタップ'}
 else if(calStep===3){S.cal.Y=ip;S.cal.ready=true;calStep=0;hint.style.display='none';coords.textContent='R 0.00m / H 0.00m';setStatus('校正完了。建物・作業点を数字で入れられます。')}
 draw()
}

$('buildingBtn').onclick=()=>S.cal.ready?show('sheetBuilding'):setStatus('先に「校正」をしてください');
$('addBuilding').onclick=()=>{
 const front=+$('bFront').value,height=+$('bHeight').value,depth=+$('bDepth').value;if(!(front>=0&&height>=0&&depth>=0))return;
 S.objects.push({type:'building',front,height,depth,name:$('bName').value||'建物',color:'#ef4444',width:4});hide('sheetBuilding');setMode('pan');setStatus('建物を実寸位置に描きました。');draw()
};

$('pointBtn').onclick=()=>S.cal.ready?show('sheetPoint'):setStatus('先に「校正」をしてください');
$('addPoint').onclick=()=>{
 const r=+$('pRadius').value,h=+$('pHeight').value;if(!(r>=0&&h>=0))return;
 S.objects.push({type:'point',r,h,name:$('pName').value||'作業点',guide:$('pGuide').value,color:'#2563eb',width:3});hide('sheetPoint');setMode('pan');setStatus('作業点を実寸位置に描きました。');draw()
};

$('editBtn').onclick=()=>{$('countText').textContent=S.objects.length+'個の書込み';show('sheetEdit')};
$('undo').onclick=()=>{S.objects.pop();$('countText').textContent=S.objects.length+'個の書込み';draw()};
$('clearAll').onclick=()=>{S.objects=[];$('countText').textContent='0個の書込み';draw()};

function currentStyle(){return{color:$('drawColor').value,width:+$('drawWidth').value}}
function updateCoord(p){
 const ip=screenToImg(p);S.cross=ip;const w=imgToWorld(ip);
 coords.textContent=w?'R '+w.x.toFixed(2)+'m / H '+w.y.toFixed(2)+'m':'未校正';draw()
}
function startPinch(){
 const a=[...pointers.values()];if(a.length<2)return;
 const cx=(a[0].x+a[1].x)/2,cy=(a[0].y+a[1].y)/2;
 gesture={d:Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y),s:S.view.s,img:screenToImg({x:cx,y:cy})};
 drag=false;S.active=null
}
function updatePinch(){
 const a=[...pointers.values()];if(a.length<2||!gesture)return;
 const cx=(a[0].x+a[1].x)/2,cy=(a[0].y+a[1].y)/2,d=Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y);
 const ns=Math.min(14,Math.max(.05,gesture.s*d/Math.max(1,gesture.d)));
 S.view.s=ns;S.view.x=cx-gesture.img.x*ns;S.view.y=cy-gesture.img.y*ns;draw()
}

cv.addEventListener('pointerdown',e=>{
 if(!S.img)return;const p=screenPos(e);pointers.set(e.pointerId,p);try{cv.setPointerCapture(e.pointerId)}catch(_){}
 if(pointers.size===2){startPinch();return}
 if(calStep){calTap(p);return}
 last=p;
 if(S.mode==='pan'){drag=true}
 else if(S.mode==='coord'){updateCoord(p);drag=true}
 else if(S.mode==='measure'){
   if(!S.cal.ready)return setStatus('寸法は校正後に使えます');
   const ip=screenToImg(p);
   if(!measureStart){measureStart=ip;S.cross=ip;setStatus('寸法：終点をタップ');draw()}
   else{S.objects.push({type:'measure',a:measureStart,b:ip,...currentStyle()});measureStart=null;S.cross=null;setStatus('寸法を追加しました');draw()}
 }else if(S.mode==='line'||S.mode==='arrow'){
   const ip=screenToImg(p);S.active={type:S.mode,a:ip,b:ip,...currentStyle()};drag=true
 }
});
cv.addEventListener('pointermove',e=>{
 if(!pointers.has(e.pointerId))return;const p=screenPos(e);pointers.set(e.pointerId,p);
 if(pointers.size>=2){if(!gesture)startPinch();updatePinch();return}
 if(!drag)return;
 if(S.mode==='pan'){S.view.x+=p.x-last.x;S.view.y+=p.y-last.y;last=p;draw()}
 else if(S.mode==='coord'){updateCoord(p)}
 else if(S.active){S.active.b=screenToImg(p);draw()}
});
function endPointer(e){
 pointers.delete(e.pointerId);if(pointers.size<2)gesture=null;
 if(S.active){S.objects.push(S.active);S.active=null;setStatus(S.mode==='arrow'?'矢印を追加しました':'直線を追加しました');draw()}
 drag=false
}
cv.addEventListener('pointerup',endPointer);cv.addEventListener('pointercancel',endPointer);

$('save').onclick=()=>{if(C.exportPNG())setStatus('高解像度PNGを保存しました');else setStatus('先に画像を開いてください')};
setMode('pan');
})();