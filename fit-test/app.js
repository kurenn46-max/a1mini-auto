import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { unzipSync, strFromU8 } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const $ = id => document.getElementById(id);
const viewer = $('viewer');
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050a12);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10000); camera.position.set(120,90,140);
const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); viewer.appendChild(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement); orbit.enableDamping=true;
const transform = new TransformControls(camera, renderer.domElement); scene.add(transform.getHelper());
transform.addEventListener('dragging-changed', e=>orbit.enabled=!e.value);
transform.addEventListener('objectChange', ()=>{ if (transform.object) storeBasePose(transform.object); checkCollision(false); });
scene.add(new THREE.HemisphereLight(0xffffff,0x334455,2.2));
const dl=new THREE.DirectionalLight(0xffffff,2.2); dl.position.set(70,100,80); scene.add(dl);
scene.add(new THREE.GridHelper(300,30,0x35506f,0x1b2c42));
scene.add(new THREE.AxesHelper(45));

const parts=[]; let axis='x'; let pickingPivot=false; let pivot=new THREE.Vector3(); let basePose=null;
const loader=new STLLoader();
const raycaster=new THREE.Raycaster(); const pointer=new THREE.Vector2();

function resize(){const r=viewer.getBoundingClientRect();renderer.setSize(r.width,r.height,false);camera.aspect=r.width/r.height;camera.updateProjectionMatrix()}
addEventListener('resize',resize); resize();
function animate(){requestAnimationFrame(animate);orbit.update();renderer.render(scene,camera)} animate();

function makeMesh(buffer,name,opts={}){
  const g=loader.parse(buffer); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundsTree({maxLeafTris:10});
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xb9c5d6,roughness:.7,metalness:.08,side:THREE.DoubleSide}));
  m.name=name; m.userData.baseColor=0xb9c5d6;
  if(opts.center){
    const c=g.boundingBox.getCenter(new THREE.Vector3());
    m.position.sub(c);
  }
  scene.add(m); parts.push(m); m.updateMatrixWorld(true); return m;
}
function addSTL(file){
  const fr=new FileReader();
  fr.onload=()=>{try{makeMesh(fr.result,file.name,{center:false});refreshUI();fitView();}catch(e){alert('STL読込エラー: '+e.message)}};
  fr.readAsArrayBuffer(file);
}

async function loadPackage(file){
  try{
    setStatus('AIテストパッケージ読込中','idle');
    const zip=unzipSync(new Uint8Array(await file.arrayBuffer()));
    const manifestKey=Object.keys(zip).find(k=>k.toLowerCase().endsWith('assembly.json'));
    if(!manifestKey) throw new Error('assembly.json がありません');
    const mf=JSON.parse(strFromU8(zip[manifestKey]));
    clearAll(false);

    const indexes={fixed:-1,moving:-1};
    for(const p of mf.parts||[]){
      const data=zip[p.file];
      if(!data) throw new Error('STLが見つかりません: '+p.file);
      const ab=data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
      const m=makeMesh(ab,p.name||p.file,{center:false});
      const pos=p.position||[0,0,0]; m.position.set(+pos[0]||0,+pos[1]||0,+pos[2]||0);
      const r=p.rotationDeg||[0,0,0]; m.rotation.set(THREE.MathUtils.degToRad(+r[0]||0),THREE.MathUtils.degToRad(+r[1]||0),THREE.MathUtils.degToRad(+r[2]||0));
      const s=p.scale||[1,1,1]; m.scale.set(+s[0]||1,+s[1]||1,+s[2]||1);
      m.updateMatrixWorld(true);
      if(p.role==='fixed') indexes.fixed=parts.length-1;
      if(p.role==='moving') indexes.moving=parts.length-1;
    }
    refreshUI();
    if(indexes.fixed>=0) $('fixedSelect').value=String(indexes.fixed);
    if(indexes.moving>=0) $('movingSelect').value=String(indexes.moving);
    $('activeSelect').value=String(indexes.moving>=0?indexes.moving:0); attachActive();

    const j=mf.joint||{};
    axis=(j.axis||'x').toLowerCase();
    document.querySelectorAll('.axis').forEach(b=>b.classList.toggle('active',b.dataset.axis===axis));
    const pv=j.pivot||[0,0,0]; setPivot(new THREE.Vector3(+pv[0]||0,+pv[1]||0,+pv[2]||0));
    const range=j.range||[0,180], step=j.step||5, start=j.startAngle??range[0]??0;
    $('sweepFrom').value=range[0]; $('sweepTo').value=range[1]; $('sweepStep').value=step;
    $('angleSlider').min=Math.min(range[0],range[1]); $('angleSlider').max=Math.max(range[0],range[1]); $('angleSlider').step=1; $('angleSlider').value=start;

    basePose=null; const m=moving(); if(m)storeBasePose(m);
    setAngle(start); fitView();

    $('packageInfo').className='result ok';
    $('packageInfo').textContent='読込完了: '+(mf.name||file.name)+'\n'+(mf.description||'')+'\n固定/可動・ヒンジ軸・テスト範囲を自動設定しました。';
    setStatus('自動組立完了','ok');
    if(mf.test?.autoRun){
      await new Promise(r=>setTimeout(r,120));
      await sweep(mf);
    }
  }catch(e){
    console.error(e);
    $('packageInfo').className='result hit';
    $('packageInfo').textContent='読込失敗: '+e.message;
    setStatus('パッケージ読込失敗','hit');
  }
}

function refreshUI(){
  const selects=[$('fixedSelect'),$('movingSelect'),$('activeSelect')];
  selects.forEach(s=>{const old=s.value;s.innerHTML='';parts.forEach((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}: ${p.name}`;s.appendChild(o)});if([...s.options].some(o=>o.value===old))s.value=old;});
  if(parts.length>1 && $('movingSelect').value==='0') $('movingSelect').value='1';
  const pl=$('partsList');pl.classList.toggle('empty',parts.length===0);pl.innerHTML=parts.length?'':'まだ部品がありません';
  parts.forEach((p,i)=>{const d=document.createElement('div');d.className='part';d.innerHTML=`<div><b>${i+1}. ${escapeHtml(p.name)}</b><br><small>${triCount(p).toLocaleString()} triangles</small></div><button data-del="${i}">削除</button>`;pl.appendChild(d)});
  pl.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>removePart(+b.dataset.del)); attachActive();
}
function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function triCount(p){return p.geometry.index?p.geometry.index.count/3:p.geometry.attributes.position.count/3}
function removePart(i){const p=parts[i];if(!p)return;if(transform.object===p)transform.detach();scene.remove(p);p.geometry.dispose();p.material.dispose();parts.splice(i,1);refreshUI()}
function clearAll(update=true){transform.detach();while(parts.length){const p=parts.pop();scene.remove(p);p.geometry.dispose();p.material.dispose()}basePose=null;if(update)refreshUI();setStatus('テストパッケージを開いてください','idle')}
function attachActive(){const p=parts[+$('activeSelect').value];if(p)transform.attach(p);else transform.detach()}
function moving(){return parts[+$('movingSelect').value]}
function fixed(){return parts[+$('fixedSelect').value]}
function storeBasePose(obj){if(obj===moving())basePose={pos:obj.position.clone(),quat:obj.quaternion.clone(),scale:obj.scale.clone()}}
function fitView(){if(!parts.length)return;const box=new THREE.Box3();parts.forEach(p=>box.expandByObject(p));const c=box.getCenter(new THREE.Vector3()),size=Math.max(box.getSize(new THREE.Vector3()).length(),30);camera.position.copy(c).add(new THREE.Vector3(size*.8,size*.6,size*.9));orbit.target.copy(c);orbit.update()}

function axisVector(){return axis==='x'?new THREE.Vector3(1,0,0):axis==='y'?new THREE.Vector3(0,1,0):new THREE.Vector3(0,0,1)}
function setAngle(deg){
  const m=moving();if(!m)return;if(!basePose)storeBasePose(m);
  const q=new THREE.Quaternion().setFromAxisAngle(axisVector(),THREE.MathUtils.degToRad(deg));
  const rel=basePose.pos.clone().sub(pivot).applyQuaternion(q);
  m.position.copy(pivot).add(rel);m.quaternion.copy(q).multiply(basePose.quat);m.scale.copy(basePose.scale);m.updateMatrixWorld(true);
  $('angleValue').textContent=deg;checkCollision(false);
}
function setPivot(v){pivot.copy(v);$('pivotX').value=v.x.toFixed(2);$('pivotY').value=v.y.toFixed(2);$('pivotZ').value=v.z.toFixed(2);basePose=null;const m=moving();if(m)storeBasePose(m)}
function updatePivotInputs(){setPivot(new THREE.Vector3(+$('pivotX').value||0,+$('pivotY').value||0,+$('pivotZ').value||0))}

function collision(){
  const a=fixed(),b=moving();if(!a||!b||a===b)return null;
  a.updateMatrixWorld(true);b.updateMatrixWorld(true);
  if(!a.geometry.boundsTree)a.geometry.computeBoundsTree();if(!b.geometry.boundsTree)b.geometry.computeBoundsTree();
  const rel=new THREE.Matrix4().copy(a.matrixWorld).invert().multiply(b.matrixWorld);
  try{return a.geometry.boundsTree.intersectsGeometry(b.geometry,rel)}catch(e){console.error(e);return false}
}
function checkCollision(showText=true){
  const hit=collision(),m=moving();if(hit===null){setStatus('固定/可動部品を選択','idle');return null}
  if(m)m.material.color.setHex(hit?0xff4359:m.userData.baseColor);
  setStatus(hit?'干渉あり':'干渉なし',hit?'hit':'ok');
  if(showText){$('result').className='result '+(hit?'hit':'ok');$('result').textContent=`現在 ${$('angleValue').textContent}° : ${hit?'❌ 干渉あり':'✅ 干渉なし'}`;}
  return hit;
}
function setStatus(t,kind){const b=$('statusBadge');b.textContent=t;b.className='badge '+kind}

async function sweep(manifest=null){
  const m=moving();if(!m||!fixed()||m===fixed()){alert('固定部品と可動部品を別々に選んでください');return}
  const from=+$('sweepFrom').value||0,to=+$('sweepTo').value||180,step=Math.max(1,+$('sweepStep').value||5);
  const hits=[],dir=to>=from?1:-1,total=Math.floor(Math.abs(to-from)/step)+1;
  setStatus('自動作動テスト中…','idle');
  for(let d=from;dir>0?d<=to:d>=to;d+=dir*step){
    $('angleSlider').value=d;setAngle(d);if(collision())hits.push(d);await new Promise(r=>setTimeout(r,0));
  }
  const expected=manifest?.test?.expected;
  let extra='';
  if(expected==='collision')extra=hits.length?'\n基準判定: ✅ 既知の干渉を検出':'\n基準判定: ❌ 干渉を見逃した可能性';
  if(expected==='clear')extra=!hits.length?'\n基準判定: ✅ 合格':'\n基準判定: ❌ 想定外の干渉';
  $('result').className='result '+(hits.length?'hit':'ok');
  $('result').textContent=hits.length?`❌ 干渉あり\n角度: ${hits.join('°, ')}°\n${hits.length} / ${total} 点で干渉${extra}`:`✅ ${from}°〜${to}°（${step}°刻み）で干渉なし${extra}`;
  setStatus(hits.length?'全角度テスト: 干渉あり':'全角度テスト: 合格',hits.length?'hit':'ok');
}

$('packageInput').onchange=e=>{const f=e.target.files?.[0];if(f)loadPackage(f);e.target.value=''};
$('fileInput').onchange=e=>{[...e.target.files].forEach(addSTL);e.target.value=''};
$('clearBtn').onclick=()=>{clearAll();refreshUI();$('packageInfo').className='result';$('packageInfo').textContent='AIテストパッケージ待ち'};
$('fitViewBtn').onclick=fitView;
$('activeSelect').onchange=attachActive;$('transformMode').onchange=e=>transform.setMode(e.target.value);
$('fixedSelect').onchange=()=>checkCollision(false);$('movingSelect').onchange=()=>{basePose=null;const m=moving();if(m)storeBasePose(m);checkCollision(false)};
document.querySelectorAll('.axis').forEach(b=>b.onclick=()=>{document.querySelectorAll('.axis').forEach(x=>x.classList.remove('active'));b.classList.add('active');axis=b.dataset.axis;basePose=null;const m=moving();if(m)storeBasePose(m)});
$('pickPivotBtn').onclick=()=>{pickingPivot=true;$('pickHint').classList.remove('hidden')};
$('centerPivotBtn').onclick=()=>{const m=moving();if(!m)return;setPivot(new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()))};
['pivotX','pivotY','pivotZ'].forEach(id=>$(id).onchange=updatePivotInputs);
$('angleSlider').oninput=e=>setAngle(+e.target.value);$('checkBtn').onclick=()=>checkCollision(true);$('sweepBtn').onclick=()=>sweep();
renderer.domElement.addEventListener('pointerdown',e=>{if(!pickingPivot)return;const r=renderer.domElement.getBoundingClientRect();pointer.x=((e.clientX-r.left)/r.width)*2-1;pointer.y=-((e.clientY-r.top)/r.height)*2+1;raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(parts,false);if(hits.length){setPivot(hits[0].point);pickingPivot=false;$('pickHint').classList.add('hidden');setStatus('ヒンジ中心を設定','ok')}});
