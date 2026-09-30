import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const $ = (id) => document.getElementById(id);
const viewer = $("viewer");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02070d);

const camera = new THREE.PerspectiveCamera(40,1,0.01,1000000);
camera.up.set(0,0,1);
camera.position.set(120,-120,95);

const renderer = new THREE.WebGLRenderer({antialias:true,alpha:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;
controls.dampingFactor=0.08;
controls.rotateSpeed=0.7;
controls.zoomSpeed=0.9;
controls.panSpeed=0.8;
controls.screenSpacePanning=true;

scene.add(new THREE.HemisphereLight(0xffffff,0x24384e,2.2));
const keyLight=new THREE.DirectionalLight(0xffffff,2.8);
keyLight.position.set(90,-80,150);
scene.add(keyLight);
const fillLight=new THREE.DirectionalLight(0x88bfff,1.0);
fillLight.position.set(-100,80,70);
scene.add(fillLight);

const grid=new THREE.GridHelper(400,40,0x355575,0x172c40);
grid.rotation.x=Math.PI/2;
grid.material.opacity=.58;
grid.material.transparent=true;
scene.add(grid);

const modelGroup=new THREE.Group();
const highlightGroup=new THREE.Group();
const gizmoGroup=new THREE.Group();
scene.add(modelGroup,highlightGroup,gizmoGroup);

const raycaster=new THREE.Raycaster();
const pointer=new THREE.Vector2();

let parts=[];
let selectionMode="face";
let selectedPart=-1;
let selectedPatch=null;
let selectedOutward=new THREE.Vector3(0,0,1);
let pointerDown=null;
let occtPromise=null;
let previewOffset=new THREE.Vector3();
let history=[{offset:new THREE.Vector3(),label:"開始"}];
let historyCursor=0;
let highlightMesh=null;
let gizmoBase=new THREE.Vector3();

function setStatus(text){ $("status").textContent=text; }
function setLoading(show,text){
  $("loading").classList.toggle("hidden",!show);
  if(text) $("loadingText").textContent=text;
}
function resize(){
  const r=viewer.getBoundingClientRect();
  if(!r.width||!r.height)return;
  renderer.setSize(r.width,r.height,false);
  camera.aspect=r.width/r.height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize",resize);
new ResizeObserver(resize).observe(viewer);
resize();
function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene,camera);
}
animate();

function disposeObject(obj){
  obj.traverse(function(child){
    if(child.geometry)child.geometry.dispose();
    if(Array.isArray(child.material))child.material.forEach(function(m){if(m)m.dispose();});
    else if(child.material)child.material.dispose();
  });
}
function clearGroup(group){
  while(group.children.length){
    const obj=group.children[group.children.length-1];
    group.remove(obj);disposeObject(obj);
  }
}
function resetHistory(){
  previewOffset.set(0,0,0);
  history=[{offset:new THREE.Vector3(),label:"開始"}];
  historyCursor=0;
}
function clearModel(){
  clearGroup(modelGroup);clearGroup(highlightGroup);clearGroup(gizmoGroup);
  parts=[];selectedPart=-1;selectedPatch=null;highlightMesh=null;
  selectedOutward.set(0,0,1);resetHistory();updateUi();
}
function flatArray(value){
  if(!value)return[];
  const arr=ArrayBuffer.isView(value)?Array.from(value):value;
  if(Array.isArray(arr)&&Array.isArray(arr[0]))return arr.flat();
  return Array.isArray(arr)?arr:Array.from(arr);
}
function colorFromData(c){
  if(!Array.isArray(c)||c.length<3)return new THREE.Color(0xaebdca);
  let r=Number(c[0]),g=Number(c[1]),b=Number(c[2]);
  if(Math.max(r,g,b)>1.001){r/=255;g/=255;b/=255;}
  return new THREE.Color(Math.max(0,Math.min(1,r)),Math.max(0,Math.min(1,g)),Math.max(0,Math.min(1,b)));
}
function createGeometry(meshData){
  const pos=flatArray(meshData&&meshData.attributes&&meshData.attributes.position&&meshData.attributes.position.array);
  if(pos.length<9)return null;
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const normals=flatArray(meshData&&meshData.attributes&&meshData.attributes.normal&&meshData.attributes.normal.array);
  if(normals.length===pos.length)g.setAttribute("normal",new THREE.Float32BufferAttribute(normals,3));
  const indices=flatArray(meshData&&meshData.index&&meshData.index.array);
  if(indices.length>=3)g.setIndex(indices);
  if(!g.getAttribute("normal"))g.computeVertexNormals();
  g.computeBoundingBox();g.computeBoundingSphere();
  return g;
}
function addPart(geometry,name,source,color,brepFaces){
  const material=new THREE.MeshStandardMaterial({color:color||0xaebdca,roughness:.7,metalness:.05,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name=name;mesh.userData.partIndex=parts.length;modelGroup.add(mesh);
  parts.push({
    mesh,name,source,
    brepFaces:Array.isArray(brepFaces)?brepFaces.map(function(f){return{first:Number(f.first)||0,last:Number(f.last)||0};}):[],
    patches:null,triToPatch:null,patchMode:null
  });
}
function buildStep(result){
  (result.meshes||[]).forEach(function(meshData,i){
    const g=createGeometry(meshData);if(!g)return;
    addPart(g,meshData.name||("Part "+(i+1)),"step",colorFromData(meshData.color),meshData.brep_faces||[]);
  });
  if(!parts.length)throw new Error("STEP内に表示できる形状がありません。");
  afterModelLoaded("STEP");
}
function buildStl(buffer,fileName){
  const loader=new STLLoader();const g=loader.parse(buffer);
  if(!g.getAttribute("normal"))g.computeVertexNormals();
  g.computeBoundingBox();g.computeBoundingSphere();
  addPart(g,String(fileName||"STL").replace(/\.stl$/i,""),"stl",new THREE.Color(0x9fb8d8),[]);
  afterModelLoaded("STL");
}
function loadDemo(){
  clearModel();
  const box=new THREE.BoxGeometry(52,34,14);box.translate(-34,0,7);
  addPart(box,"デモ角材","demo",new THREE.Color(0xaebdca),[]);
  const cyl=new THREE.CylinderGeometry(10,10,32,48,1,false);
  cyl.rotateX(Math.PI/2);cyl.translate(30,0,16);
  addPart(cyl,"デモ丸棒","demo",new THREE.Color(0x7899b7),[]);
  afterModelLoaded("デモ");
}
function afterModelLoaded(label){
  $("fitBtn").disabled=false;fitView();updateUi();
  setStatus(label+" 読込完了。動かしたい面をタップしてください。");
}
async function getOcct(){
  if(!occtPromise){
    if(typeof window.occtimportjs!=="function")throw new Error("STEP変換エンジンを読み込めません。");
    occtPromise=window.occtimportjs({locateFile:function(path){return"https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/"+path;}})
      .catch(function(err){occtPromise=null;throw err;});
  }
  return occtPromise;
}
function looksLikeStepBytes(bytes){
  if(!bytes||!bytes.length)return false;
  const head=bytes.subarray(0,Math.min(bytes.length,8192));let text="";
  try{text=new TextDecoder("utf-8",{fatal:false}).decode(head).toUpperCase();}
  catch(_){for(let i=0;i<head.length;i++)text+=String.fromCharCode(head[i]).toUpperCase();}
  return text.includes("ISO-10303-21")&&(text.includes("HEADER;")||text.includes("DATA;"));
}
function looksLikeStlBytes(bytes){
  if(!bytes||bytes.length<15)return false;
  try{
    const head=new TextDecoder("utf-8",{fatal:false}).decode(bytes.subarray(0,Math.min(bytes.length,4096))).trimStart().toLowerCase();
    if(head.startsWith("solid")&&head.includes("facet normal"))return true;
  }catch(_){}
  if(bytes.length>=84){
    try{
      const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      const tri=dv.getUint32(80,true);
      if(tri>0&&84+tri*50===bytes.length)return true;
    }catch(_){}
  }
  return false;
}
async function loadFile(file){
  if(!file)return;
  setLoading(true,"3Dデータを確認中…");
  try{
    const buffer=await file.arrayBuffer();const bytes=new Uint8Array(buffer);const name=String(file.name||"");
    const step=/\.(step|stp)$/i.test(name)||looksLikeStepBytes(bytes);
    const stl=/\.stl$/i.test(name)||looksLikeStlBytes(bytes);
    if(!step&&!stl)throw new Error("STEP / STLとして認識できません。");
    clearModel();
    if(stl&&!step){setLoading(true,"STLを読み込み中…");buildStl(buffer,name);}
    else{
      setLoading(true,"STEPを解析中…");const occt=await getOcct();
      const result=occt.ReadStepFile(bytes,{linearUnit:"millimeter",linearDeflectionType:"bounding_box_ratio",linearDeflection:.003,angularDeflection:.5});
      if(!result||!result.success)throw new Error("STEPの解析に失敗しました。");
      buildStep(result);
    }
  }catch(err){
    console.error(err);clearModel();setStatus("読込失敗: "+(err&&err.message?err.message:String(err)));
  }finally{setLoading(false);}
}

function triangleVertexIndex(geometry,triIndex,corner){
  return geometry.index?geometry.index.getX(triIndex*3+corner):triIndex*3+corner;
}
function trianglePoint(geometry,triIndex,corner,target){
  const out=target||new THREE.Vector3();const i=triangleVertexIndex(geometry,triIndex,corner);const p=geometry.getAttribute("position");
  return out.set(p.getX(i),p.getY(i),p.getZ(i));
}
function triangleNormal(geometry,triIndex,target){
  const out=target||new THREE.Vector3();
  const a=trianglePoint(geometry,triIndex,0,new THREE.Vector3());
  const b=trianglePoint(geometry,triIndex,1,new THREE.Vector3());
  const c=trianglePoint(geometry,triIndex,2,new THREE.Vector3());
  return out.subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
}
function triangleCountFor(geometry){
  return geometry.index?Math.floor(geometry.index.count/3):Math.floor(geometry.getAttribute("position").count/3);
}
function positionWeldId(geometry,vertexIndex,cache,map){
  if(cache.has(vertexIndex))return cache.get(vertexIndex);
  const p=geometry.getAttribute("position"),q=100000;
  const key=Math.round(p.getX(vertexIndex)*q)+","+Math.round(p.getY(vertexIndex)*q)+","+Math.round(p.getZ(vertexIndex)*q);
  let id=map.get(key);if(id===undefined){id=map.size;map.set(key,id);}cache.set(vertexIndex,id);return id;
}
function buildPatchesFromBrep(part){
  const geometry=part.mesh.geometry,triCount=triangleCountFor(geometry);
  const faces=(part.brepFaces||[]).filter(function(f){return Number.isFinite(f.first)&&Number.isFinite(f.last)&&f.last>=f.first&&f.first>=0&&f.first<triCount;});
  if(faces.length<2||faces.length>250||faces.length>triCount*.45)return null;
  const patches=[],triToPatch=new Int32Array(triCount);triToPatch.fill(-1);
  faces.forEach(function(f){
    const triangles=[],first=Math.max(0,Math.floor(f.first)),last=Math.min(triCount-1,Math.floor(f.last));
    for(let t=first;t<=last;t++)triangles.push(t);
    if(!triangles.length)return;
    const idx=patches.length;triangles.forEach(function(t){triToPatch[t]=idx;});
    patches.push({triangles,source:"brep"});
  });
  return patches.length?{patches,triToPatch,mode:"STEP面"}:null;
}
function buildSmoothPatches(part,angleDeg){
  const geometry=part.mesh.geometry,triCount=triangleCountFor(geometry),normals=new Array(triCount);
  const edgeMap=new Map(),weldMap=new Map(),weldCache=new Map();
  for(let t=0;t<triCount;t++){
    normals[t]=triangleNormal(geometry,t,new THREE.Vector3());
    const ids=[0,1,2].map(function(c){return positionWeldId(geometry,triangleVertexIndex(geometry,t,c),weldCache,weldMap);});
    [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]].forEach(function(pair){
      const key=pair[0]<pair[1]?pair[0]+":"+pair[1]:pair[1]+":"+pair[0];
      let arr=edgeMap.get(key);if(!arr){arr=[];edgeMap.set(key,arr);}arr.push(t);
    });
  }
  const neighbors=Array.from({length:triCount},function(){return[];});
  edgeMap.forEach(function(arr){
    if(arr.length<2)return;
    for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){neighbors[arr[i]].push(arr[j]);neighbors[arr[j]].push(arr[i]);}
  });
  const cosLimit=Math.cos(THREE.MathUtils.degToRad(angleDeg)),triToPatch=new Int32Array(triCount);triToPatch.fill(-1);
  const patches=[];
  for(let start=0;start<triCount;start++){
    if(triToPatch[start]!==-1)continue;
    const patchIndex=patches.length,queue=[start],triangles=[];triToPatch[start]=patchIndex;
    while(queue.length){
      const t=queue.pop();triangles.push(t);const n=normals[t];
      neighbors[t].forEach(function(nb){
        if(triToPatch[nb]!==-1)return;
        if(n.dot(normals[nb])>=cosLimit){triToPatch[nb]=patchIndex;queue.push(nb);}
      });
    }
    patches.push({triangles,source:"smooth"});
  }
  return{patches,triToPatch,mode:"自動分割"};
}
function ensurePatches(part){
  if(part.patches)return;
  let built=part.source==="step"?buildPatchesFromBrep(part):null;
  if(!built)built=buildSmoothPatches(part,12);
  part.patches=built.patches;part.triToPatch=built.triToPatch;part.patchMode=built.mode;
}
function patchStats(part,patch){
  const geometry=part.mesh.geometry;part.mesh.updateMatrixWorld(true);
  const matrix=part.mesh.matrixWorld,normalMatrix=new THREE.Matrix3().getNormalMatrix(matrix);
  const box=new THREE.Box3(),normalSum=new THREE.Vector3();let area=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  patch.triangles.forEach(function(t){
    trianglePoint(geometry,t,0,a).applyMatrix4(matrix);
    trianglePoint(geometry,t,1,b).applyMatrix4(matrix);
    trianglePoint(geometry,t,2,c).applyMatrix4(matrix);
    box.expandByPoint(a);box.expandByPoint(b);box.expandByPoint(c);
    const cross=new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(b,a),new THREE.Vector3().subVectors(c,a));
    const triArea=cross.length()*.5;area+=triArea;
    const localN=triangleNormal(geometry,t,new THREE.Vector3()).applyMatrix3(normalMatrix).normalize();
    normalSum.addScaledVector(localN,Math.max(triArea,.000001));
  });
  const size=box.isEmpty()?new THREE.Vector3():box.getSize(new THREE.Vector3());
  const center=box.isEmpty()?new THREE.Vector3():box.getCenter(new THREE.Vector3());
  let planar=true;
  const base=normalSum.lengthSq()>1e-12?normalSum.clone().normalize():new THREE.Vector3(0,0,1);
  for(const t of patch.triangles){
    const n=triangleNormal(geometry,t,new THREE.Vector3()).applyMatrix3(normalMatrix).normalize();
    if(Math.abs(base.dot(n))<Math.cos(THREE.MathUtils.degToRad(3))){planar=false;break;}
  }
  const modelCenter=new THREE.Box3().setFromObject(part.mesh).getCenter(new THREE.Vector3());
  if(base.dot(new THREE.Vector3().subVectors(center,modelCenter))<0)base.multiplyScalar(-1);
  return{box,size,center,area,type:planar?"平面":"曲面",outward:base};
}
function directionName(v){
  const ax=Math.abs(v.x),ay=Math.abs(v.y),az=Math.abs(v.z);
  if(az>=ax&&az>=ay)return v.z>=0?"上（Z＋）":"下（Z−）";
  if(ax>=ay)return v.x>=0?"右（X＋）":"左（X−）";
  return v.y>=0?"奥（Y＋）":"手前（Y−）";
}
function highlightPatch(part,patch){
  clearGroup(highlightGroup);highlightMesh=null;
  const pos=[],v=new THREE.Vector3();part.mesh.updateMatrixWorld(true);
  patch.triangles.forEach(function(t){
    for(let c=0;c<3;c++){trianglePoint(part.mesh.geometry,t,c,v).applyMatrix4(part.mesh.matrixWorld);pos.push(v.x,v.y,v.z);}
  });
  if(!pos.length)return;
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();
  const m=new THREE.MeshBasicMaterial({color:0xffc247,transparent:true,opacity:.56,side:THREE.DoubleSide,depthTest:false,depthWrite:false});
  highlightMesh=new THREE.Mesh(g,m);highlightMesh.renderOrder=90;highlightGroup.add(highlightMesh);
}
function buildGizmo(center,outward){
  clearGroup(gizmoGroup);gizmoBase.copy(center);
  const box=new THREE.Box3().setFromObject(modelGroup),size=box.getSize(new THREE.Vector3());
  const length=Math.max(size.length()*.1,12);
  const origin=new THREE.Vector3(),dir=outward.clone().normalize();
  const outArrow=new THREE.ArrowHelper(dir,origin,length,0xffc247,length*.27,length*.14);
  const inArrow=new THREE.ArrowHelper(dir.clone().multiplyScalar(-1),origin,length*.58,0x768595,length*.22,length*.12);
  gizmoGroup.add(outArrow,inArrow);applyPreviewTransform();
}
function selectPart(index){
  if(!parts[index])return;
  selectedPart=index;selectedPatch=null;clearGroup(highlightGroup);clearGroup(gizmoGroup);highlightMesh=null;resetHistory();updateUi();
  const box=new THREE.Box3().setFromObject(parts[index].mesh),size=box.getSize(new THREE.Vector3());
  $("selectionTitle").textContent=parts[index].name;
  $("selectionInfo").textContent="左右幅 "+size.x.toFixed(2)+" / 前後幅 "+size.y.toFixed(2)+" / 高さ "+size.z.toFixed(2)+" mm";
  setStatus("部品を選びました。面を動かすなら「面を選ぶ」にしてください。");
}
function selectPatchByIndex(index,patchIndex){
  const part=parts[index];if(!part)return false;
  ensurePatches(part);const patch=part.patches&&part.patches[patchIndex];if(!patch)return false;
  selectedPart=index;selectedPatch={partIndex:index,patchIndex};resetHistory();
  const stats=patchStats(part,patch);selectedOutward.copy(stats.outward);
  highlightPatch(part,patch);buildGizmo(stats.center,selectedOutward);updateUi();
  $("selectionTitle").textContent=part.name+" / 面 "+(patchIndex+1);
  $("faceType").textContent=stats.type;
  $("selectionInfo").innerHTML=
    "左右幅 "+stats.size.x.toFixed(2)+" / 前後幅 "+stats.size.y.toFixed(2)+" / 高さ "+stats.size.z.toFixed(2)+" mm"+
    "<br>面積 "+stats.area.toFixed(2)+" mm² ・ 外方向 "+directionName(selectedOutward);
  $("directionText").textContent=directionName(selectedOutward);
  $("easyHelp").innerHTML="黄色い面を <strong>外へ出す</strong> / <strong>内へ引っ込める</strong> だけで編集できます。";
  setStatus("黄色い面を選択中。下の「外へ / 内へ」を押してください。");
  return true;
}
function selectPatchFromHit(hit){
  const index=hit.object.userData.partIndex,part=parts[index];if(!part)return;
  ensurePatches(part);const tri=Number(hit.faceIndex);
  if(!Number.isInteger(tri)||!part.triToPatch||tri<0||tri>=part.triToPatch.length){selectPart(index);return;}
  const patchIndex=part.triToPatch[tri];
  if(patchIndex<0||!part.patches[patchIndex]){selectPart(index);return;}
  selectPatchByIndex(index,patchIndex);
}
function setSelectionMode(mode){
  selectionMode=mode==="part"?"part":"face";
  $("partModeBtn").classList.toggle("active",selectionMode==="part");
  $("faceModeBtn").classList.toggle("active",selectionMode==="face");
  setStatus(selectionMode==="face"?"面を選ぶ：動かしたい面をタップ":"部品を選ぶ：部品全体をタップ");
}
function pickAt(clientX,clientY){
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.x=((clientX-rect.left)/rect.width)*2-1;pointer.y=-((clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  return raycaster.intersectObjects(parts.map(function(p){return p.mesh;}).filter(function(m){return m.visible;}),false);
}
renderer.domElement.addEventListener("pointerdown",function(e){pointerDown={id:e.pointerId,x:e.clientX,y:e.clientY};});
renderer.domElement.addEventListener("pointerup",function(e){
  if(!pointerDown||pointerDown.id!==e.pointerId)return;
  const dx=e.clientX-pointerDown.x,dy=e.clientY-pointerDown.y;pointerDown=null;
  if(Math.hypot(dx,dy)>8)return;
  const hits=pickAt(e.clientX,e.clientY);if(!hits.length)return;
  if(selectionMode==="part")selectPart(hits[0].object.userData.partIndex);else selectPatchFromHit(hits[0]);
});

function pushSnapshot(label){
  history=history.slice(0,historyCursor+1);
  history.push({offset:previewOffset.clone(),label});
  historyCursor=history.length-1;updateUi();
}
function moveByVector(vector,amount,label){
  if(!selectedPatch||!Number.isFinite(amount)||amount===0)return;
  previewOffset.addScaledVector(vector,amount);
  pushSnapshot(label+" "+Math.abs(amount).toFixed(2)+" mm");
  applyPreviewTransform();
}
function moveNormal(amount){
  const outward=selectedOutward.clone().normalize();
  const label=amount>0?"外へ":"内へ";
  moveByVector(outward,amount,label);
}
function moveAxis(axis,sign){
  const amount=Math.abs(Number($("moveAmount").value));
  if(!Number.isFinite(amount)||amount<=0)return;
  const v=new THREE.Vector3();v[axis]=sign;
  const names={
    "x-":"左へ","x+":"右へ","y-":"手前へ","y+":"奥へ","z+":"上へ","z-":"下へ"
  };
  moveByVector(v,amount,names[axis+(sign>0?"+":"-")]);
}
function applyPreviewTransform(){
  if(highlightMesh)highlightMesh.position.copy(previewOffset);
  gizmoGroup.position.copy(gizmoBase).add(previewOffset);
  $("previewValue").textContent=
    "左右 "+previewOffset.x.toFixed(2)+" / 前後 "+previewOffset.y.toFixed(2)+" / 上下 "+previewOffset.z.toFixed(2)+" mm";
}
function resetPreview(record){
  if(!selectedPatch)return;
  const had=previewOffset.lengthSq()>1e-12;previewOffset.set(0,0,0);
  if(record&&had)pushSnapshot("全部0に戻す");
  else resetHistory();
  applyPreviewTransform();updateUi();
}
function undo(){
  if(historyCursor<=0)return;
  historyCursor--;previewOffset.copy(history[historyCursor].offset);applyPreviewTransform();updateUi();
}
function redo(){
  if(historyCursor>=history.length-1)return;
  historyCursor++;previewOffset.copy(history[historyCursor].offset);applyPreviewTransform();updateUi();
}
function renderHistory(){
  const list=$("historyList"),visible=history.slice(1,historyCursor+1);
  $("historyCount").textContent=String(visible.length);
  if(!visible.length){list.innerHTML='<div class="empty">まだ操作していません</div>';return;}
  list.innerHTML="";
  visible.forEach(function(item,i){
    const row=document.createElement("div");row.className="historyItem";
    const strong=document.createElement("strong");strong.textContent=item.label;
    const small=document.createElement("small");small.textContent="#"+(i+1);
    row.append(strong,small);list.appendChild(row);
  });
}
function updateUi(){
  $("partCount").textContent=String(parts.length);
  $("selectedKind").textContent=selectedPatch?"面":(selectedPart>=0?"部品":"—");
  $("selectedFace").textContent=selectedPatch?String(selectedPatch.patchIndex+1):"—";
  $("directionBadge").classList.toggle("hidden",!selectedPatch);
  const canEdit=!!selectedPatch;
  document.querySelectorAll("[data-normal-delta]").forEach(function(btn){btn.disabled=!canEdit;});
  document.querySelectorAll("[data-dir-axis]").forEach(function(btn){btn.disabled=!canEdit;});
  $("customOutBtn").disabled=!canEdit;$("customInBtn").disabled=!canEdit;
  $("resetPreviewBtn").disabled=!selectedPatch||previewOffset.lengthSq()<1e-12;
  $("undoBtn").disabled=historyCursor<=0;$("redoBtn").disabled=historyCursor>=history.length-1;
  if(!selectedPatch){
    $("faceType").textContent="—";$("directionText").textContent="—";
    $("easyHelp").textContent="まず3Dモデルの面をタップしてください。";
  }
  renderHistory();
}
function fitView(){
  if(!parts.length)return;
  const box=new THREE.Box3().setFromObject(modelGroup);if(box.isEmpty())return;
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(size.x,size.y,size.z,1);
  controls.target.copy(center);
  camera.position.set(center.x+span*1.35,center.y-span*1.35,center.z+span*1.05);
  camera.near=Math.max(span/5000,.01);camera.far=Math.max(span*200,1000);camera.updateProjectionMatrix();controls.update();
}

$("fileInput").addEventListener("click",function(){this.value="";});
$("fileInput").addEventListener("change",function(){loadFile(this.files&&this.files[0]);});
$("demoBtn").addEventListener("click",loadDemo);
$("fitBtn").addEventListener("click",fitView);
$("partModeBtn").addEventListener("click",function(){setSelectionMode("part");});
$("faceModeBtn").addEventListener("click",function(){setSelectionMode("face");});
document.querySelectorAll("[data-normal-delta]").forEach(function(btn){
  btn.addEventListener("click",function(){moveNormal(Number(btn.dataset.normalDelta));});
});
$("customOutBtn").addEventListener("click",function(){
  const n=Math.abs(Number($("moveAmount").value));if(n>0)moveNormal(n);
});
$("customInBtn").addEventListener("click",function(){
  const n=Math.abs(Number($("moveAmount").value));if(n>0)moveNormal(-n);
});
document.querySelectorAll("[data-dir-axis]").forEach(function(btn){
  btn.addEventListener("click",function(){moveAxis(btn.dataset.dirAxis,Number(btn.dataset.dirSign));});
});
$("resetPreviewBtn").addEventListener("click",function(){resetPreview(true);});
$("undoBtn").addEventListener("click",undo);
$("redoBtn").addEventListener("click",redo);

setSelectionMode("face");updateUi();
window.__OKACAD_NEXT_READY__=true;
window.__OKACAD_NEXT_TEST__={
  loadDemo,
  selectFirstFace:function(){
    if(!parts.length)loadDemo();
    ensurePatches(parts[0]);
    return selectPatchByIndex(0,0);
  },
  getPreview:function(){return{x:previewOffset.x,y:previewOffset.y,z:previewOffset.z};},
  getHistoryCursor:function(){return historyCursor;}
};
