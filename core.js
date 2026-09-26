(()=>{
const S={
 img:null,iw:1000,ih:1400,view:{s:1,x:0,y:0},
 objects:[],active:null,mode:'pan',
 cal:{O:null,X:null,Y:null,xm:5,ym:5,ready:false},
 cross:null
};
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),stage=document.getElementById('stage');
const dpr=()=>Math.max(1,window.devicePixelRatio||1);
const $=id=>document.getElementById(id);
function resize(){const r=stage.getBoundingClientRect(),d=dpr();cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);cv.style.width=r.width+'px';cv.style.height=r.height+'px';draw()}
function fit(){if(!S.img)return;const w=stage.clientWidth,h=stage.clientHeight;S.view.s=Math.min(w/S.iw,h/S.ih)*.96;S.view.x=(w-S.iw*S.view.s)/2;S.view.y=(h-S.ih*S.view.s)/2;draw()}
function zoomAt(f,cx,cy){if(!S.img)return;const old=S.view.s,ns=Math.min(14,Math.max(.05,old*f));const ix=(cx-S.view.x)/old,iy=(cy-S.view.y)/old;S.view.s=ns;S.view.x=cx-ix*ns;S.view.y=cy-iy*ns;draw()}
function screenToImg(p){return{x:(p.x-S.view.x)/S.view.s,y:(p.y-S.view.y)/S.view.s}}
function imgToScreen(p){return{x:S.view.x+p.x*S.view.s,y:S.view.y+p.y*S.view.s}}
function worldToImg(x,y){
 if(!S.cal.ready)return null;
 const c=S.cal,ex={x:(c.X.x-c.O.x)/c.xm,y:(c.X.y-c.O.y)/c.xm},ey={x:(c.Y.x-c.O.x)/c.ym,y:(c.Y.y-c.O.y)/c.ym};
 return{x:c.O.x+ex.x*x+ey.x*y,y:c.O.y+ex.y*x+ey.y*y}
}
function imgToWorld(p){
 if(!S.cal.ready)return null;
 const c=S.cal,ax=(c.X.x-c.O.x)/c.xm,ay=(c.X.y-c.O.y)/c.xm,bx=(c.Y.x-c.O.x)/c.ym,by=(c.Y.y-c.O.y)/c.ym,dx=p.x-c.O.x,dy=p.y-c.O.y,det=ax*by-ay*bx;
 if(Math.abs(det)<1e-9)return null;
 return{x:(dx*by-dy*bx)/det,y:(ax*dy-ay*dx)/det}
}
function line(a,b,color,width,dash=[]){ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore()}
function label(text,x,y,color='#111827',align='left'){ctx.save();ctx.font='700 14px system-ui';ctx.textAlign=align;ctx.textBaseline='bottom';ctx.lineWidth=4;ctx.strokeStyle='rgba(255,255,255,.95)';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);ctx.restore()}
function drawObj(o){
 const w=Math.max(2,o.width||4);
 if(o.type==='building'){
  const a=worldToImg(o.front,o.height),p1=worldToImg(o.front+o.depth,o.height),b=worldToImg(o.front+o.depth,0),p0=worldToImg(o.front,0);if(!a)return;
  const A=imgToScreen(a),P1=imgToScreen(p1),B=imgToScreen(b),P0=imgToScreen(p0);
  ctx.save();ctx.fillStyle='rgba(239,68,68,.10)';ctx.strokeStyle=o.color||'#ef4444';ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(P1.x,P1.y);ctx.lineTo(B.x,B.y);ctx.lineTo(P0.x,P0.y);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  label(o.name+' 手前'+o.front+'m / H'+o.height+'m / D'+o.depth+'m',A.x,A.y-5,o.color||'#ef4444');
  label('奥端 '+(o.front+o.depth).toFixed(1)+'m',P1.x,P1.y-5,o.color||'#ef4444','right')
 }else if(o.type==='point'){
  const q=worldToImg(o.r,o.h);if(!q)return;const Q=imgToScreen(q),base=imgToScreen(worldToImg(o.r,0)),left=imgToScreen(worldToImg(0,o.h));
  if(o.guide==='both'||o.guide==='vertical')line(base,Q,o.color||'#2563eb',2,[7,5]);
  if(o.guide==='both')line(left,Q,o.color||'#2563eb',2,[7,5]);
  ctx.save();ctx.fillStyle='#fff';ctx.strokeStyle=o.color||'#2563eb';ctx.lineWidth=3;ctx.beginPath();ctx.arc(Q.x,Q.y,7,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
  label(o.name+' R'+o.r+'m / H'+o.h+'m',Q.x+10,Q.y-8,o.color||'#2563eb')
 }else if(o.type==='measure'){
  const A=imgToScreen(o.a),B=imgToScreen(o.b);line(A,B,o.color,w);const wa=imgToWorld(o.a),wb=imgToWorld(o.b);let t='寸法';
  if(wa&&wb){const dx=wb.x-wa.x,dy=wb.y-wa.y;t='ΔR '+Math.abs(dx).toFixed(2)+'m / ΔH '+Math.abs(dy).toFixed(2)+'m / '+Math.hypot(dx,dy).toFixed(2)+'m'}
  label(t,(A.x+B.x)/2,(A.y+B.y)/2-5,o.color,'center')
 }else if(o.type==='line'||o.type==='arrow'){
  const A=imgToScreen(o.a),B=imgToScreen(o.b);line(A,B,o.color,w);
  if(o.type==='arrow'){const ang=Math.atan2(B.y-A.y,B.x-A.x),L=14+w*1.5;line(B,{x:B.x-L*Math.cos(ang-.5),y:B.y-L*Math.sin(ang-.5)},o.color,w);line(B,{x:B.x-L*Math.cos(ang+.5),y:B.y-L*Math.sin(ang+.5)},o.color,w)}
 }
}
function drawCal(){
 const c=S.cal;
 if(c.O){const O=imgToScreen(c.O);line({x:O.x-12,y:O.y},{x:O.x+12,y:O.y},'#7c3aed',2);line({x:O.x,y:O.y-12},{x:O.x,y:O.y+12},'#7c3aed',2);label('原点',O.x+7,O.y-6,'#7c3aed')}
 if(c.X){const X=imgToScreen(c.X);ctx.fillStyle='#16a34a';ctx.beginPath();ctx.arc(X.x,X.y,6,0,Math.PI*2);ctx.fill();label(c.xm+'m',X.x+7,X.y-5,'#16a34a')}
 if(c.Y){const Y=imgToScreen(c.Y);ctx.fillStyle='#d97706';ctx.beginPath();ctx.arc(Y.x,Y.y,6,0,Math.PI*2);ctx.fill();label(c.ym+'m',Y.x+7,Y.y-5,'#d97706')}
}
function draw(){
 const d=dpr(),w=cv.width/d,h=cv.height/d;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#cdd4dc';ctx.fillRect(0,0,w,h);
 if(S.img)ctx.drawImage(S.img,S.view.x,S.view.y,S.iw*S.view.s,S.ih*S.view.s);else{ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.fillStyle='#64748b';ctx.font='18px system-ui';ctx.textAlign='center';ctx.fillText('「画像」から揚程図を開く',w/2,h/2)}
 S.objects.forEach(drawObj);if(S.active)drawObj(S.active);drawCal();
 if(S.cross){const q=imgToScreen(S.cross);line({x:q.x-16,y:q.y},{x:q.x+16,y:q.y},'#0f172a',1);line({x:q.x,y:q.y-16},{x:q.x,y:q.y+16},'#0f172a',1)}
}
function exportPNG(){
 if(!S.img)return false;
 const out=document.createElement('canvas');out.width=S.iw;out.height=S.ih;const oc=out.getContext('2d');oc.drawImage(S.img,0,0);
 function eline(a,b,c,w,dash=[]){oc.save();oc.strokeStyle=c;oc.lineWidth=w;oc.setLineDash(dash);oc.lineCap='round';oc.beginPath();oc.moveTo(a.x,a.y);oc.lineTo(b.x,b.y);oc.stroke();oc.restore()}
 function elabel(t,x,y,c='#111827',align='left'){oc.save();oc.font='700 18px system-ui';oc.textAlign=align;oc.textBaseline='bottom';oc.lineWidth=5;oc.strokeStyle='white';oc.strokeText(t,x,y);oc.fillStyle=c;oc.fillText(t,x,y);oc.restore()}
 S.objects.forEach(o=>{
  const w=Math.max(3,o.width||4);
  if(o.type==='building'){const A=worldToImg(o.front,o.height),P1=worldToImg(o.front+o.depth,o.height),B=worldToImg(o.front+o.depth,0),P0=worldToImg(o.front,0);oc.save();oc.fillStyle='rgba(239,68,68,.10)';oc.strokeStyle=o.color;oc.lineWidth=w;oc.beginPath();oc.moveTo(A.x,A.y);oc.lineTo(P1.x,P1.y);oc.lineTo(B.x,B.y);oc.lineTo(P0.x,P0.y);oc.closePath();oc.fill();oc.stroke();oc.restore();elabel(o.name+' 手前'+o.front+'m / H'+o.height+'m / D'+o.depth+'m',A.x,A.y-7,o.color);elabel('奥端 '+(o.front+o.depth).toFixed(1)+'m',P1.x,P1.y-7,o.color,'right')}
  else if(o.type==='point'){const Q=worldToImg(o.r,o.h),base=worldToImg(o.r,0),left=worldToImg(0,o.h);if(o.guide==='both'||o.guide==='vertical')eline(base,Q,o.color,2,[9,7]);if(o.guide==='both')eline(left,Q,o.color,2,[9,7]);oc.save();oc.fillStyle='#fff';oc.strokeStyle=o.color;oc.lineWidth=4;oc.beginPath();oc.arc(Q.x,Q.y,9,0,Math.PI*2);oc.fill();oc.stroke();oc.restore();elabel(o.name+' R'+o.r+'m / H'+o.h+'m',Q.x+12,Q.y-10,o.color)}
  else if(o.type==='measure'){eline(o.a,o.b,o.color,w);const wa=imgToWorld(o.a),wb=imgToWorld(o.b);elabel('ΔR '+Math.abs(wb.x-wa.x).toFixed(2)+'m / ΔH '+Math.abs(wb.y-wa.y).toFixed(2)+'m / '+Math.hypot(wb.x-wa.x,wb.y-wa.y).toFixed(2)+'m',(o.a.x+o.b.x)/2,(o.a.y+o.b.y)/2-7,o.color,'center')}
  else if(o.type==='line'||o.type==='arrow'){eline(o.a,o.b,o.color,w);if(o.type==='arrow'){const ang=Math.atan2(o.b.y-o.a.y,o.b.x-o.a.x),L=20+w*1.5;eline(o.b,{x:o.b.x-L*Math.cos(ang-.5),y:o.b.y-L*Math.sin(ang-.5)},o.color,w);eline(o.b,{x:o.b.x-L*Math.cos(ang+.5),y:o.b.y-L*Math.sin(ang+.5)},o.color,w)}}
 });
 out.toBlob(blob=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='揚程図_作図.png';a.click();setTimeout(()=>URL.revokeObjectURL(u),1500)},'image/png');return true
}
window.CraneCore={S,cv,stage,$,resize,fit,zoomAt,screenToImg,imgToScreen,worldToImg,imgToWorld,draw,exportPNG};
resize();draw();
})();