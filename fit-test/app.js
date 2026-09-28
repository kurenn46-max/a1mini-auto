import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { unzipSync, strFromU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

THREE.Mesh.prototype.raycast=acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree=disposeBoundsTree;

const $=id=>document.getElementById(id);
const viewer=$('viewer'), scene=new THREE.Scene();
scene.background=new THREE.Color(0x040911);
const camera=new THREE.PerspectiveCamera(42,1,.1,10000); camera.position.set(120,90,140);
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2)); viewer.appendChild(renderer.domElement);
const orbit=new OrbitControls(camera,renderer.domElement); orbit.enableDamping=true;
scene.add(new THREE.HemisphereLight(0xffffff,0x334455,2.2));
const dl=new THREE.DirectionalLight(0xffffff,2.0); dl.position.set(80,100,70); scene.add(dl);
scene.add(new THREE.GridHelper(300,30,0x35506f,0x1b2c42)); scene.add(new THREE.AxesHelper(40));
const loader=new STLLoader();

let manifest=null;
let parts=new Map();
let lastSource=null;
let running=false;
let manualTest=null;
let manualMin=0;
let manualMax=180;

function resize(){const r=viewer.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()}
addEventListener('resize',resize);resize();
(function anim(){requestAnimationFrame(anim);orbit.update();renderer.render(scene,camera)})();

function setStatus(t,k='idle'){const e=$('status');e.textContent=t;e.className='badge '+k}
function setProgress(v){const wrap=$('progress');wrap.classList.toggle('hidden',v<=0||v>=1);$('progressBar').style.width=(Math.max(0,Math.min(1,v))*100)+'%'}
function clearScene(){for(const p of parts.values()){scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose()}parts.clear()}
function fitView(){if(!parts.size)return;const box=new THREE.Box3();for(const p of parts.values())box.expandByObject(p.mesh);const c=box.getCenter(new THREE.Vector3()),len=Math.max(box.getSize(new THREE.Vector3()).length(),30);camera.position.copy(c).add(new THREE.Vector3(len*.8,len*.65,len*.9));orbit.target.copy(c);orbit.update()}
function vec3(v,def=[0,0,0]){v=v||def;return new THREE.Vector3(+v[0]||0,+v[1]||0,+v[2]||0)}
function quatFromEulerDeg(v){v=v||[0,0,0];return new THREE.Quaternion().setFromEuler(new THREE.Euler(...v.map(x=>THREE.MathUtils.degToRad(+x||0))))}
function meshFromBuffer(ab,p){const g=loader.parse(ab);g.computeVertexNormals();g.computeBoundsTree({maxLeafTris:10});const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xb9c5d6,roughness:.72,metalness:.06,side:THREE.DoubleSide}));m.name=p.name||p.id;m.position.copy(vec3(p.position));m.quaternion.copy(quatFromEulerDeg(p.rotationDeg));m.scale.copy(vec3(p.scale,[1,1,1]));m.updateMatrixWorld(true);m.userData.baseColor=0xb9c5d6;scene.add(m);return m}
function saveBase(part){part.base={pos:part.mesh.position.clone(),quat:part.mesh.quaternion.clone(),scale:part.mesh.scale.clone()}}
function restoreAll(){for(const p of parts.values()){p.mesh.position.copy(p.base.pos);p.mesh.quaternion.copy(p.base.quat);p.mesh.scale.copy(p.base.scale);p.mesh.material.color.setHex(p.mesh.userData.baseColor);p.mesh.updateMatrixWorld(true)}}
function findPart(id){return parts.get(id)?.mesh}
function setMovingColor(id,hit){const m=findPart(id);if(m)m.material.color.setHex(hit?0xff4359:0x4aa8ff)}

function normalizeManifest(m){
  if((m.version||1)>=2 && Array.isArray(m.tests)) return m;
  const moving=(m.parts||[]).find(p=>p.role==='moving')?.id || (m.parts||[]).find(p=>p.role==='moving')?.name;
  const fixed=(m.parts||[]).find(p=>p.role==='fixed')?.id || (m.parts||[]).find(p=>p.role==='fixed')?.name;
  const j=m.joint||{}, range=j.range||[0,180];
  return {...m,version:2,tests:[{name:'作動テスト',type:'rotate',moving,fixed:[fixed],pivot:j.pivot||[0,0,0],axis:j.axis||[1,0,0],segments:[{from:range[0],to:range[1],step:j.step||5}]}]};
}
function axisVector(a){if(Array.isArray(a))return vec3(a,[1,0,0]).normalize();if(a==='y')return new THREE.Vector3(0,1,0);if(a==='z')return new THREE.Vector3(0,0,1);return new THREE.Vector3(1,0,0)}
function applyTestValue(test,value){
  const p=parts.get(test.moving); if(!p)return;
  const m=p.mesh, base=p.base;
  if(test.type==='translate'){
    const d=axisVector(test.direction||test.axis||[1,0,0]);
    m.position.copy(base.pos).addScaledVector(d,value);
    m.quaternion.copy(base.quat);
  }else{
    const pivot=vec3(test.pivot), axis=axisVector(test.axis);
    const q=new THREE.Quaternion().setFromAxisAngle(axis,THREE.MathUtils.degToRad(value));
    const rel=base.pos.clone().sub(pivot).applyQuaternion(q);
    m.position.copy(pivot).add(rel);
    m.quaternion.copy(q).multiply(base.quat);
  }
  m.updateMatrixWorld(true);
}
function collisionPair(a,b){
  a.updateMatrixWorld(true);b.updateMatrixWorld(true);
  const rel=new THREE.Matrix4().copy(a.matrixWorld).invert().multiply(b.matrixWorld);
  try{return a.geometry.boundsTree.intersectsGeometry(b.geometry,rel)}catch(e){console.error(e);return false}
}
function testCollision(test){
  const moving=findPart(test.moving); if(!moving)return false;
  const fixedIds=(test.fixed||[]).filter(Boolean);
  for(const id of fixedIds){const f=findPart(id);if(f&&collisionPair(f,moving))return true}
  return false;
}
function expandSamples(segments){
  const vals=[];
  for(const s of segments||[]){const from=+s.from||0,to=+s.to||0,step=Math.max(0.0001,Math.abs(+s.step||1)),dir=to>=from?1:-1;for(let v=from;dir>0?v<=to+1e-9:v>=to-1e-9;v+=dir*step)vals.push(+v.toFixed(6))}
  return [...new Set(vals)];
}
function unitFor(test){return test.type==='translate'?'mm':'°'}
function planText(m){
  return (m.tests||[]).map((t,i)=>{
    const seg=(t.segments||[]).map(s=>`${s.from}〜${s.to}${unitFor(t)} / ${s.step}${unitFor(t)}刻み`).join('、');
    return `${i+1}. ${t.name||'テスト'}：${t.type==='translate'?'直動':'回転'}　${seg}`;
  }).join('\n');
}
function showManifestInfo(){
  $('testName').textContent=manifest.name||'AI作動テスト';
  $('plan').textContent=planText(manifest)||'テスト計画なし';
  $('partsInfo').textContent=(manifest.parts||[]).map(p=>`${p.id}: ${p.name||p.file}`).join('\n');
  $('rerunBtn').disabled=false;
  setupManualControl();
}
function setManualEnabled(enabled){
  ['manualAngle','minus10','minus1','plus1','plus10'].forEach(id=>$(id).disabled=!enabled);
}
function setupManualControl(){
  manualTest=(manifest?.tests||[]).find(t=>t.type==='rotate')||null;
  if(!manualTest){
    setManualEnabled(false);
    $('manualCollision').className='pill';
    $('manualCollision').textContent='回転テストなし';
    $('manualHint').textContent='このテストファイルには回転動作がありません。';
    return;
  }
  const ends=(manualTest.segments||[]).flatMap(s=>[Number(s.from),Number(s.to)]).filter(Number.isFinite);
  manualMin=ends.length?Math.min(...ends):0;
  manualMax=ends.length?Math.max(...ends):180;
  if(manualMax===manualMin)manualMax=manualMin+1;
  const slider=$('manualAngle');
  slider.min=manualMin; slider.max=manualMax; slider.step=1; slider.value=manualMin;
  $('gaugeMinLabel').textContent=formatAngle(manualMin);
  $('gaugeMidLabel').textContent=formatAngle((manualMin+manualMax)/2);
  $('gaugeMaxLabel').textContent=formatAngle(manualMax);
  $('manualHint').textContent=(manualTest.name||'回転テスト')+'を手動操作中。角度を動かすたびに干渉を即判定します。';
  setManualEnabled(true);
  updateGauge(manualMin);
}
function formatAngle(v){
  const n=Math.round(Number(v)*10)/10;
  return n+'°';
}
function updateGauge(value){
  const v=Math.max(manualMin,Math.min(manualMax,Number(value)||0));
  const span=Math.max(0.0001,manualMax-manualMin);
  const ratio=(v-manualMin)/span;
  const deg=-90+ratio*180;
  $('gaugeNeedle').style.transform=`rotate(${deg}deg)`;
  $('gaugeValue').textContent=formatAngle(v);
}
function manualSetAngle(value,announce=true){
  if(!manualTest||running)return;
  const v=Math.max(manualMin,Math.min(manualMax,Number(value)||0));
  restoreAll();
  applyTestValue(manualTest,v);
  const hit=testCollision(manualTest);
  setMovingColor(manualTest.moving,hit);
  $('manualAngle').value=v;
  updateGauge(v);
  const p=$('manualCollision');
  p.className='pill '+(hit?'manualHit':'manualOk');
  p.textContent=hit?'干渉あり':'干渉なし';
  if(announce)setStatus(`手動 ${formatAngle(v)}：${hit?'干渉あり':'干渉なし'}`,hit?'hit':'ok');
}
function nudgeManual(delta){
  manualSetAngle((Number($('manualAngle').value)||0)+delta);
}
function addResultCard(r){
  const d=document.createElement('div');d.className='resultCard '+(r.hit?'hit':'ok');
  d.innerHTML=`<div class="resultTitle"><span>${r.name}</span><span class="pill ${r.hit?'hit':'ok'}">${r.hit?'干渉あり':'干渉なし'}</span></div><div class="resultMeta">${r.detail}</div>`;
  $('results').appendChild(d);
}
async function runAll(){
  if(!manifest||running)return;
  running=true;setManualEnabled(false);$('results').innerHTML='';$('summary').className='summary run';$('summary').textContent='自動テスト中…';setStatus('自動作動テスト中…','run');restoreAll();
  const tests=manifest.tests||[]; let anyHit=false,done=0,total=tests.reduce((n,t)=>n+expandSamples(t.segments).length,0)||1;
  for(const t of tests){
    const samples=expandSamples(t.segments); let firstHit=null,hitValues=[];
    restoreAll(); setMovingColor(t.moving,false);
    for(const v of samples){
      applyTestValue(t,v);
      const hit=testCollision(t);
      if(hit){hitValues.push(v);if(firstHit===null)firstHit=v}
      done++;setProgress(done/total);
      if(done%5===0)await new Promise(r=>requestAnimationFrame(r));
    }
    const hit=hitValues.length>0;anyHit ||= hit;
    if(hit){applyTestValue(t,firstHit);setMovingColor(t.moving,true)}
    else{restoreAll();setMovingColor(t.moving,false)}
    const u=unitFor(t);
    const detail=hit?`最初の干渉: ${firstHit}${u}　干渉点数: ${hitValues.length}/${samples.length}`:`${samples.length}点を確認。指定範囲では干渉なし`;
    addResultCard({name:t.name||'作動テスト',hit,detail});
    await new Promise(r=>setTimeout(r,120));
  }
  setProgress(1);
  $('summary').className='summary '+(anyHit?'hit':'ok');
  $('summary').textContent=anyHit?'❌ 干渉あり。印刷前に修正必要':'✅ 指定した作動範囲では干渉なし';
  setStatus(anyHit?'テスト完了：干渉あり':'テスト完了：合格',anyHit?'hit':'ok');
  fitView();running=false;setManualEnabled(!!manualTest);
  if(manualTest)manualSetAngle(Number($('manualAngle').value)||manualMin,false);
}
async function loadManifestWithBuffers(m,getBuffer,label){
  manifest=normalizeManifest(m);clearScene();$('results').innerHTML='';$('summary').className='summary idle';$('summary').textContent='読込中…';setStatus('部品を自動組立中…','run');
  for(const p of manifest.parts||[]){const ab=await getBuffer(p.file);const mesh=meshFromBuffer(ab,p);parts.set(p.id,{mesh,def:p,base:null});saveBase(parts.get(p.id))}
  showManifestInfo();fitView();lastSource=label;setStatus('自動組立完了','ok');await runAll();
}
function saveLastPackage(ab,name){
  try{
    const u=new Uint8Array(ab);
    let s=''; const chunk=0x8000;
    for(let i=0;i<u.length;i+=chunk)s+=String.fromCharCode(...u.subarray(i,i+chunk));
    localStorage.setItem('oka3d_last_package',btoa(s));
    localStorage.setItem('oka3d_last_name',name||'前回のAIテスト');
    $('lastBtn').disabled=false;
  }catch(e){console.warn('cache save failed',e)}
}
function readLastPackage(){
  try{
    const b64=localStorage.getItem('oka3d_last_package');if(!b64)return null;
    const s=atob(b64),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);
    return u.buffer;
  }catch(e){console.warn('cache read failed',e);return null}
}
async function loadPackageBuffer(ab,label,remember=false){
  try{
    const zip=unzipSync(new Uint8Array(ab));
    const key=Object.keys(zip).find(k=>k.toLowerCase().endsWith('assembly.json'));if(!key)throw new Error('assembly.jsonなし');
    const m=JSON.parse(strFromU8(zip[key]));
    await loadManifestWithBuffers(m,async f=>{const u=zip[f];if(!u)throw new Error('STLなし: '+f);return u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength)},label);
    if(remember)saveLastPackage(ab,label);
  }catch(e){
    console.error(e);setStatus('テストファイル読込失敗','hit');
    $('summary').className='summary hit';$('summary').textContent='読込失敗: '+e.message;
  }
}
async function loadPackage(file){
  const ab=await file.arrayBuffer();
  await loadPackageBuffer(ab,file.name,true);
}
async function loadLast(){
  const ab=readLastPackage();
  if(!ab){$('lastBtn').disabled=true;return}
  await loadPackageBuffer(ab,localStorage.getItem('oka3d_last_name')||'前回のAIテスト',false);
}

$('manualAngle').addEventListener('input',e=>manualSetAngle(e.target.value));
$('minus10').onclick=()=>nudgeManual(-10);
$('minus1').onclick=()=>nudgeManual(-1);
$('plus1').onclick=()=>nudgeManual(1);
$('plus10').onclick=()=>nudgeManual(10);

$('lastBtn').disabled=!readLastPackage();
$('lastBtn').onclick=loadLast;
$('rerunBtn').onclick=runAll;
$('fitBtn').onclick=fitView;
$('packageInput').onchange=e=>{const f=e.target.files?.[0];if(f)loadPackage(f);e.target.value=''};
if(new URLSearchParams(location.search).get('auto')==='last' && readLastPackage())loadLast();
