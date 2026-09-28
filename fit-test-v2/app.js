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
function setMovingColor(id,state){const m=findPart(id);if(!m)return;const hex=state==='hit'?0xff4359:state==='warn'?0xe8a23a:0x4aa8ff;m.material.color.setHex(hex)}

function normalizeManifest(m){
  if((m.version||1)>=2 && Array.isArray(m.tests)) return {...m,version:Math.max(3,m.version||2)};
  const moving=(m.parts||[]).find(p=>p.role==='moving')?.id || (m.parts||[]).find(p=>p.role==='moving')?.name;
  const fixed=(m.parts||[]).find(p=>p.role==='fixed')?.id || (m.parts||[]).find(p=>p.role==='fixed')?.name;
  const j=m.joint||{}, range=j.range||[0,180];
  return {...m,version:3,tests:[{name:'作動テスト',type:'rotate',moving,fixed:[fixed],pivot:j.pivot||[0,0,0],axis:j.axis||[1,0,0],segments:[{from:range[0],to:range[1],step:j.step||5}]}]};
}
function axisVector(a){if(Array.isArray(a))return vec3(a,[1,0,0]).normalize();if(a==='y')return new THREE.Vector3(0,1,0);if(a==='z')return new THREE.Vector3(0,0,1);return new THREE.Vector3(1,0,0)}
function testType(t){return String(t.type||'rotate').toLowerCase()}
function isRotary(t){return ['rotate','screw'].includes(testType(t))}
function isLinear(t){return ['translate','fit','pressfit','snapfit','retention'].includes(testType(t))}
function screwPitch(t){return Number(t.pitchMm ?? t.thread?.pitchMm ?? t.thread?.malePitchMm ?? 0)}
function screwTravel(t,deg){const sign=Number(t.axialSign ?? t.thread?.axialSign ?? 1)||1;return screwPitch(t)*(Number(deg)||0)/360*sign}

function applyTestValue(test,value){
  const p=parts.get(test.moving); if(!p)return;
  const m=p.mesh, base=p.base, type=testType(test);
  if(isLinear(test)){
    const d=axisVector(test.direction||test.axis||[1,0,0]);
    m.position.copy(base.pos).addScaledVector(d,value);
    m.quaternion.copy(base.quat);
  }else if(type==='screw'){
    const pivot=vec3(test.pivot), axis=axisVector(test.axis||[0,0,1]);
    const q=new THREE.Quaternion().setFromAxisAngle(axis,THREE.MathUtils.degToRad(value));
    const rel=base.pos.clone().sub(pivot).applyQuaternion(q);
    m.position.copy(pivot).add(rel).addScaledVector(axis,screwTravel(test,value));
    m.quaternion.copy(q).multiply(base.quat);
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
function collisionIds(test){
  const ignored=new Set(test.ignoreCollisionWith||[]);
  return (test.fixed||[]).filter(id=>id && !ignored.has(id));
}
function testCollision(test){
  const moving=findPart(test.moving); if(!moving)return false;
  for(const id of collisionIds(test)){const f=findPart(id);if(f&&collisionPair(f,moving))return true}
  return false;
}
function expandSamples(segments){
  const vals=[];
  for(const s of segments||[]){const from=Number(s.from)||0,to=Number(s.to)||0,step=Math.max(0.0001,Math.abs(Number(s.step)||1)),dir=to>=from?1:-1;for(let v=from;dir>0?v<=to+1e-9:v>=to-1e-9;v+=dir*step)vals.push(+v.toFixed(6))}
  return [...new Set(vals)];
}
function unitFor(test){return isLinear(test)?'mm':'°'}
function typeLabel(test){
  return ({rotate:'回転',translate:'直動',screw:'ネジ締結',fit:'はめ込み',pressfit:'圧入',snapfit:'スナップ',retention:'抜け止め'})[testType(test)]||test.type||'作動';
}
function planText(m){
  return (m.tests||[]).map((t,i)=>{
    const u=unitFor(t);const seg=(t.segments||[]).map(s=>`${s.from}〜${s.to}${u} / ${s.step}${u}刻み`).join('、');
    const extra=testType(t)==='screw'?`　ピッチ ${fmt(screwPitch(t),3)}mm/回` : '';
    return `${i+1}. ${t.name||'テスト'}：${typeLabel(t)}　${seg}${extra}`;
  }).join('\n');
}
function showManifestInfo(){
  $('testName').textContent=manifest.name||'AI作動テスト';
  $('plan').textContent=planText(manifest)||'テスト計画なし';
  $('partsInfo').textContent=(manifest.parts||[]).map(p=>`${p.id}: ${p.name||p.file}`).join('\n');
  $('rerunBtn').disabled=false;setupManualControl();
}
function setManualEnabled(enabled){['manualAngle','minus10','minus1','plus1','plus10'].forEach(id=>$(id).disabled=!enabled)}
function setupManualControl(){
  manualTest=(manifest?.tests||[]).find(t=>isRotary(t))||null;
  if(!manualTest){
    setManualEnabled(false);$('manualCollision').className='pill';$('manualCollision').textContent='回転テストなし';$('manualHint').textContent='このテストファイルには回転またはネジ動作がありません。';$('manualSubValue').textContent='';return;
  }
  const ends=(manualTest.segments||[]).flatMap(s=>[Number(s.from),Number(s.to)]).filter(Number.isFinite);
  manualMin=ends.length?Math.min(...ends):0;manualMax=ends.length?Math.max(...ends):180;if(manualMax===manualMin)manualMax=manualMin+1;
  const slider=$('manualAngle');slider.min=manualMin;slider.max=manualMax;slider.step=1;slider.value=manualMin;
  $('gaugeMinLabel').textContent=formatAngle(manualMin);$('gaugeMidLabel').textContent=formatAngle((manualMin+manualMax)/2);$('gaugeMaxLabel').textContent=formatAngle(manualMax);
  $('manualTitle').textContent=testType(manualTest)==='screw'?'ネジ回転計':'角度計';
  $('manualHint').textContent=(manualTest.name||typeLabel(manualTest))+'を手動操作中。動かすたびに干渉を即判定します。';
  setManualEnabled(true);updateGauge(manualMin);
}
function formatAngle(v){const n=Math.round(Number(v)*10)/10;return n+'°'}
function fmt(v,d=2){const n=Number(v);return Number.isFinite(n)?n.toFixed(d).replace(/\.?0+$/,''):'—'}
function updateGauge(value){
  const v=Math.max(manualMin,Math.min(manualMax,Number(value)||0)),span=Math.max(.0001,manualMax-manualMin),ratio=(v-manualMin)/span,deg=-90+ratio*180;
  $('gaugeNeedle').style.transform=`rotate(${deg}deg)`;$('gaugeValue').textContent=formatAngle(v);
  $('manualSubValue').textContent=manualTest&&testType(manualTest)==='screw'?`軸移動 ${fmt(screwTravel(manualTest,v),2)} mm` : '';
}
function collisionPolicy(test){const type=testType(test);return test.collisionPolicy||(type==='retention'?'require':['pressfit','snapfit'].includes(type)?'ignore':'forbid')}
function motionCollisionVerdict(test,hitValues,samples){
  const policy=collisionPolicy(test),hit=hitValues.length>0,u=unitFor(test),first=hit?hitValues[0]:null;
  if(policy==='ignore')return {level:'warn',pass:true,detail:hit?`接触/干渉を検出: 最初 ${first}${u}（このテストでは許容扱い）`:`${samples.length}点を確認。接触なし`};
  if(policy==='require')return hit?{level:'ok',pass:true,detail:`抜け止め候補を検出: 最初 ${first}${u}　${hitValues.length}/${samples.length}点で幾何的に阻止`}:{level:'hit',pass:false,detail:`抜け止めを検出できず。${samples.length}点で自由に抜ける経路`};
  return hit?{level:'hit',pass:false,detail:`最初の干渉: ${first}${u}　干渉点数: ${hitValues.length}/${samples.length}`}:{level:'ok',pass:true,detail:`${samples.length}点を確認。指定範囲では干渉なし`};
}
function rangeCheck(value,min,max,label,unit='mm'){
  if(!Number.isFinite(value))return null;
  const lo=Number(min),hi=Number(max),hasLo=Number.isFinite(lo),hasHi=Number.isFinite(hi);
  if(!hasLo&&!hasHi)return {level:'warn',pass:true,text:`${label}: ${fmt(value,3)}${unit}（許容範囲未指定）`};
  const ok=(!hasLo||value>=lo)&&(!hasHi||value<=hi);
  const range=`${hasLo?fmt(lo,3):'−∞'}〜${hasHi?fmt(hi,3):'∞'}${unit}`;
  return {level:ok?'ok':'hit',pass:ok,text:`${label}: ${fmt(value,3)}${unit} / 許容 ${range}`};
}
function engineeringCheck(test){
  const type=testType(test),checks=[];
  if(type==='screw'||test.thread){
    const th=test.thread||{};
    const mp=Number(th.malePitchMm ?? th.pitchMm ?? screwPitch(test)),fp=Number(th.femalePitchMm ?? th.pitchMm ?? screwPitch(test)),pt=Number(th.pitchToleranceMm ?? .05);
    if(Number.isFinite(mp)&&Number.isFinite(fp)&&mp>0&&fp>0){const diff=Math.abs(mp-fp);checks.push({level:diff<=pt?'ok':'hit',pass:diff<=pt,text:`ピッチ差 ${fmt(diff,3)}mm（許容 ${fmt(pt,3)}mm）`})}
    const mh=String(th.maleHand??th.hand??'').toLowerCase(),fh=String(th.femaleHand??th.hand??'').toLowerCase();
    if(mh&&fh){const ok=mh===fh;checks.push({level:ok?'ok':'hit',pass:ok,text:`ねじ方向: ${mh} / ${fh}${ok?' 一致':' 不一致'}`})}
    const md=Number(th.maleMajorDiameterMm),fd=Number(th.femaleMajorDiameterMm);
    if(Number.isFinite(md)&&Number.isFinite(fd))checks.push(rangeCheck(fd-md,th.minMajorClearanceMm,th.maxMajorClearanceMm,'大径差'));
  }
  if(['fit','pressfit','snapfit'].includes(type)||test.fit){
    const f=test.fit||{},male=Number(f.maleDiameterMm),female=Number(f.femaleDiameterMm);
    if(Number.isFinite(male)&&Number.isFinite(female)){
      const clearance=female-male;
      if(type==='pressfit'||f.mode==='press'){
        const interference=-clearance;checks.push(rangeCheck(interference,f.minInterferenceMm,f.maxInterferenceMm,'圧入しろ'));
      }else checks.push(rangeCheck(clearance,f.minClearanceMm,f.maxClearanceMm,'すきま'));
    }
  }
  if(type==='snapfit'||test.snap){
    const s=test.snap||{},inter=Number(s.hookInterferenceMm),allow=Number(s.elasticAllowanceMm),eng=Number(s.engagementMm),minEng=Number(s.minEngagementMm);
    if(Number.isFinite(inter)&&Number.isFinite(allow)){const ok=inter<=allow;checks.push({level:ok?'ok':'hit',pass:ok,text:`爪の乗り越え量 ${fmt(inter,3)}mm / 許容弾性量 ${fmt(allow,3)}mm`})}
    if(Number.isFinite(eng)&&Number.isFinite(minEng)){const ok=eng>=minEng;checks.push({level:ok?'ok':'hit',pass:ok,text:`掛かり量 ${fmt(eng,3)}mm / 必要 ${fmt(minEng,3)}mm以上`})}
  }
  const clean=checks.filter(Boolean);if(!clean.length){const needsDims=['screw','fit','pressfit','snapfit'].includes(type);return needsDims?{level:'warn',pass:true,text:'寸法・許容差データなし（幾何作動のみ判定）'}:{level:'ok',pass:true,text:type==='retention'?'抜け止めは幾何経路で判定':'追加寸法判定なし'};}
  const fail=clean.some(c=>!c.pass),warn=!fail&&clean.some(c=>c.level==='warn');
  return {level:fail?'hit':warn?'warn':'ok',pass:!fail,text:clean.map(c=>c.text).join('\n')};
}
function combinedLevel(a,b){if(a==='hit'||b==='hit')return'hit';if(a==='warn'||b==='warn')return'warn';return'ok'}
function addResultCard(r){
  const d=document.createElement('div');d.className='resultCard '+r.level;
  const label=r.level==='hit'?'要修正':r.level==='warn'?'参考':'合格';
  d.innerHTML=`<div class="resultTitle"><span>${r.name}</span><span class="pill ${r.level}">${label}</span></div><div class="resultMeta">${r.detail}</div>`;$('results').appendChild(d);
}
function manualSetAngle(value,announce=true){
  if(!manualTest||running)return;const v=Math.max(manualMin,Math.min(manualMax,Number(value)||0));restoreAll();applyTestValue(manualTest,v);const hit=testCollision(manualTest);setMovingColor(manualTest.moving,hit?'hit':'ok');$('manualAngle').value=v;updateGauge(v);
  const policy=collisionPolicy(manualTest),bad=policy==='require'?!hit:policy==='forbid'?hit:false,p=$('manualCollision');p.className='pill '+(bad?'manualHit':policy==='ignore'&&hit?'manualWarn':'manualOk');p.textContent=bad?(policy==='require'?'抜け止めなし':'干渉あり'):(hit?'接触あり':'干渉なし');if(announce)setStatus(`手動 ${formatAngle(v)}：${p.textContent}`,bad?'hit':hit?'warn':'ok');
}
function nudgeManual(delta){manualSetAngle((Number($('manualAngle').value)||0)+delta)}

async function runAll(){
  if(!manifest||running)return;running=true;setManualEnabled(false);$('results').innerHTML='';$('summary').className='summary run';$('summary').textContent='自動テスト中…';setStatus('自動作動・はめ合いテスト中…','run');restoreAll();
  const tests=manifest.tests||[];let anyFail=false,anyWarn=false,done=0,total=tests.reduce((n,t)=>n+Math.max(1,expandSamples(t.segments).length),0)||1;
  for(const t of tests){
    let samples=expandSamples(t.segments);if(!samples.length)samples=[0];let hitValues=[];restoreAll();setMovingColor(t.moving,'ok');
    for(const v of samples){applyTestValue(t,v);const hit=testCollision(t);if(hit)hitValues.push(v);done++;setProgress(done/total);if(done%5===0)await new Promise(r=>requestAnimationFrame(r))}
    const motion=motionCollisionVerdict(t,hitValues,samples),eng=engineeringCheck(t),level=combinedLevel(motion.level,eng.level);anyFail ||= !motion.pass||!eng.pass;anyWarn ||= level==='warn';
    const focus=hitValues.length?hitValues[0]:samples[samples.length-1];applyTestValue(t,focus);setMovingColor(t.moving,level==='hit'?'hit':level==='warn'?'warn':'ok');
    const screwExtra=testType(t)==='screw'?`\n最終軸移動: ${fmt(screwTravel(t,samples[samples.length-1]),2)}mm` : '';
    addResultCard({name:t.name||typeLabel(t),level,detail:`${motion.detail}${screwExtra}\n${eng.text}`});await new Promise(r=>setTimeout(r,100));
  }
  setProgress(1);const finalLevel=anyFail?'hit':anyWarn?'warn':'ok';$('summary').className='summary '+finalLevel;$('summary').textContent=anyFail?'❌ 要修正：締結・はめ合い条件に不一致あり':anyWarn?'⚠️ 作動合格。寸法条件未指定の項目あり':'✅ 作動・締結・はめ合いテスト合格';setStatus(anyFail?'テスト完了：要修正':anyWarn?'テスト完了：参考項目あり':'テスト完了：合格',finalLevel);fitView();running=false;setManualEnabled(!!manualTest);if(manualTest)manualSetAngle(Number($('manualAngle').value)||manualMin,false);
}
async function loadManifestWithBuffers(m,getBuffer){
  manifest=normalizeManifest(m);clearScene();$('results').innerHTML='';$('summary').className='summary idle';$('summary').textContent='読込中…';setStatus('部品を自動組立中…','run');
  for(const p of manifest.parts||[]){const ab=await getBuffer(p.file);const mesh=meshFromBuffer(ab,p);parts.set(p.id,{mesh,def:p,base:null});saveBase(parts.get(p.id))}
  showManifestInfo();fitView();setStatus('自動組立完了','ok');await runAll();
}
function saveLastPackage(ab,name){
  try{const u=new Uint8Array(ab);let s='';const chunk=0x8000;for(let i=0;i<u.length;i+=chunk)s+=String.fromCharCode(...u.subarray(i,i+chunk));localStorage.setItem('oka3d_last_package',btoa(s));localStorage.setItem('oka3d_last_name',name||'前回のAIテスト');$('lastBtn').disabled=false}catch(e){console.warn('cache save failed',e)}
}
function readLastPackage(){
  try{const b64=localStorage.getItem('oka3d_last_package');if(!b64)return null;const s=atob(b64),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer}catch(e){console.warn('cache read failed',e);return null}
}
async function loadPackageBuffer(ab,label,remember=false){
  try{const zip=unzipSync(new Uint8Array(ab));const key=Object.keys(zip).find(k=>k.toLowerCase().endsWith('assembly.json'));if(!key)throw new Error('assembly.jsonなし');const m=JSON.parse(strFromU8(zip[key]));await loadManifestWithBuffers(m,async f=>{const u=zip[f];if(!u)throw new Error('STLなし: '+f);return u.buffer.slice(u.byteOffset,u.byteOffset+u.byteLength)});if(remember)saveLastPackage(ab,label)}catch(e){console.error(e);setStatus('テストファイル読込失敗','hit');$('summary').className='summary hit';$('summary').textContent='読込失敗: '+e.message}
}
async function loadPackage(file){const ab=await file.arrayBuffer();await loadPackageBuffer(ab,file.name,true)}
async function loadLast(){const ab=readLastPackage();if(!ab){$('lastBtn').disabled=true;return}await loadPackageBuffer(ab,localStorage.getItem('oka3d_last_name')||'前回のAIテスト',false)}

$('manualAngle').addEventListener('input',e=>manualSetAngle(e.target.value));
$('minus10').onclick=()=>nudgeManual(-10);$('minus1').onclick=()=>nudgeManual(-1);$('plus1').onclick=()=>nudgeManual(1);$('plus10').onclick=()=>nudgeManual(10);
$('lastBtn').disabled=!readLastPackage();$('lastBtn').onclick=loadLast;$('rerunBtn').onclick=runAll;$('fitBtn').onclick=fitView;$('packageInput').onchange=e=>{const f=e.target.files?.[0];if(f)loadPackage(f);e.target.value=''};
if(new URLSearchParams(location.search).get('auto')==='last'&&readLastPackage())loadLast();
