import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const $ = (id) => document.getElementById(id);
const viewer = $("viewer");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02070d);

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000000);
camera.up.set(0, 0, 1);
camera.position.set(120, -120, 95);

const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.8;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x24384e, 2.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(90, -80, 150);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88bfff, 1.0);
fillLight.position.set(-100, 80, 70);
scene.add(fillLight);

const grid = new THREE.GridHelper(400, 40, 0x355575, 0x172c40);
grid.rotation.x = Math.PI / 2;
grid.material.opacity = 0.58;
grid.material.transparent = true;
scene.add(grid);
scene.add(new THREE.AxesHelper(30));

const modelGroup = new THREE.Group();
const highlightGroup = new THREE.Group();
const gizmoGroup = new THREE.Group();
scene.add(modelGroup, highlightGroup, gizmoGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let parts = [];
let selectionMode = "face";
let selectedPart = -1;
let selectedPatch = null;
let selectedAxis = null;
let pointerDown = null;
let occtPromise = null;
let previewOffset = new THREE.Vector3();
let previewHistory = [new THREE.Vector3()];
let previewCursor = 0;
let commandHistory = [];
let highlightMesh = null;
let gizmoBase = new THREE.Vector3();

function setStatus(text) {
  $("status").textContent = text;
}

function setLoading(show, text) {
  $("loading").classList.toggle("hidden", !show);
  if (text) $("loadingText").textContent = text;
}

function resize() {
  const r = viewer.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(viewer);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

function disposeObject(obj) {
  obj.traverse(function(child) {
    if (child.geometry) child.geometry.dispose();
    if (Array.isArray(child.material)) child.material.forEach(function(m){ if(m) m.dispose(); });
    else if (child.material) child.material.dispose();
  });
}

function clearGroup(group) {
  while (group.children.length) {
    const obj = group.children[group.children.length - 1];
    group.remove(obj);
    disposeObject(obj);
  }
}

function clearModel() {
  clearGroup(modelGroup);
  clearGroup(highlightGroup);
  clearGroup(gizmoGroup);
  parts = [];
  selectedPart = -1;
  selectedPatch = null;
  selectedAxis = null;
  highlightMesh = null;
  previewOffset.set(0,0,0);
  previewHistory = [new THREE.Vector3()];
  previewCursor = 0;
  commandHistory = [];
  updateUi();
}

function flatArray(value) {
  if (!value) return [];
  const arr = ArrayBuffer.isView(value) ? Array.from(value) : value;
  if (Array.isArray(arr) && Array.isArray(arr[0])) return arr.flat();
  return Array.isArray(arr) ? arr : Array.from(arr);
}

function colorFromData(c) {
  if (!Array.isArray(c) || c.length < 3) return new THREE.Color(0xaebdca);
  let r = Number(c[0]), g = Number(c[1]), b = Number(c[2]);
  if (Math.max(r,g,b) > 1.001) { r/=255; g/=255; b/=255; }
  return new THREE.Color(
    Math.max(0,Math.min(1,r)),
    Math.max(0,Math.min(1,g)),
    Math.max(0,Math.min(1,b))
  );
}

function createGeometry(meshData) {
  const pos = flatArray(meshData && meshData.attributes && meshData.attributes.position && meshData.attributes.position.array);
  if (pos.length < 9) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const normals = flatArray(meshData && meshData.attributes && meshData.attributes.normal && meshData.attributes.normal.array);
  if (normals.length === pos.length) g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  const indices = flatArray(meshData && meshData.index && meshData.index.array);
  if (indices.length >= 3) g.setIndex(indices);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function addPart(geometry, name, source, color, brepFaces) {
  const material = new THREE.MeshStandardMaterial({
    color: color || 0xaebdca,
    roughness:0.7,
    metalness:0.05,
    side:THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData.partIndex = parts.length;
  modelGroup.add(mesh);
  parts.push({
    mesh:mesh,
    name:name,
    source:source,
    brepFaces:Array.isArray(brepFaces) ? brepFaces.map(function(f){
      return { first:Number(f.first)||0, last:Number(f.last)||0 };
    }) : [],
    patches:null,
    triToPatch:null,
    patchMode:null
  });
}

function buildStep(result) {
  (result.meshes || []).forEach(function(meshData, i) {
    const g = createGeometry(meshData);
    if (!g) return;
    addPart(g, meshData.name || ("Part " + (i+1)), "step", colorFromData(meshData.color), meshData.brep_faces || []);
  });
  if (!parts.length) throw new Error("STEP内に表示できる形状がありません。");
  afterModelLoaded("STEP");
}

function buildStl(buffer, fileName) {
  const loader = new STLLoader();
  const g = loader.parse(buffer);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  addPart(g, String(fileName || "STL").replace(/\.stl$/i,""), "stl", new THREE.Color(0x9fb8d8), []);
  afterModelLoaded("STL");
}

function loadDemo() {
  clearModel();
  const box = new THREE.BoxGeometry(52, 34, 14);
  box.translate(-34, 0, 7);
  addPart(box, "Demo Block", "demo", new THREE.Color(0xaebdca), []);
  const cyl = new THREE.CylinderGeometry(10,10,32,48,1,false);
  cyl.rotateX(Math.PI/2);
  cyl.translate(30,0,16);
  addPart(cyl, "Demo Cylinder", "demo", new THREE.Color(0x7899b7), []);
  afterModelLoaded("デモ");
}

function afterModelLoaded(label) {
  $("fitBtn").disabled = false;
  fitView();
  updateUi();
  setStatus(label + " 読込完了。面をタップしてください。");
}

async function getOcct() {
  if (!occtPromise) {
    if (typeof window.occtimportjs !== "function") throw new Error("STEP変換エンジンを読み込めません。");
    occtPromise = window.occtimportjs({
      locateFile:function(path) {
        return "https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/" + path;
      }
    }).catch(function(err){ occtPromise=null; throw err; });
  }
  return occtPromise;
}

function looksLikeStepBytes(bytes) {
  if (!bytes || !bytes.length) return false;
  const head = bytes.subarray(0, Math.min(bytes.length,8192));
  let text = "";
  try { text = new TextDecoder("utf-8",{fatal:false}).decode(head).toUpperCase(); }
  catch (_) {
    for (let i=0;i<head.length;i++) text += String.fromCharCode(head[i]).toUpperCase();
  }
  return text.includes("ISO-10303-21") && (text.includes("HEADER;") || text.includes("DATA;"));
}

function looksLikeStlBytes(bytes) {
  if (!bytes || bytes.length < 15) return false;
  try {
    const head = new TextDecoder("utf-8",{fatal:false}).decode(bytes.subarray(0,Math.min(bytes.length,4096))).trimStart().toLowerCase();
    if (head.startsWith("solid") && head.includes("facet normal")) return true;
  } catch (_) {}
  if (bytes.length >= 84) {
    try {
      const dv = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      const tri = dv.getUint32(80,true);
      if (tri > 0 && 84 + tri*50 === bytes.length) return true;
    } catch (_) {}
  }
  return false;
}

async function loadFile(file) {
  if (!file) return;
  setLoading(true, "3Dデータを確認中…");
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const name = String(file.name || "");
    const step = /\.(step|stp)$/i.test(name) || looksLikeStepBytes(bytes);
    const stl = /\.stl$/i.test(name) || looksLikeStlBytes(bytes);
    if (!step && !stl) throw new Error("STEP / STLとして認識できません。");
    clearModel();
    if (stl && !step) {
      setLoading(true, "STLを読み込み中…");
      buildStl(buffer, name);
    } else {
      setLoading(true, "STEPを解析中…");
      const occt = await getOcct();
      const result = occt.ReadStepFile(bytes,{
        linearUnit:"millimeter",
        linearDeflectionType:"bounding_box_ratio",
        linearDeflection:0.003,
        angularDeflection:0.5
      });
      if (!result || !result.success) throw new Error("STEPの解析に失敗しました。");
      buildStep(result);
    }
  } catch (err) {
    console.error(err);
    clearModel();
    setStatus("読込失敗: " + (err && err.message ? err.message : String(err)));
  } finally {
    setLoading(false);
  }
}

function triangleVertexIndex(geometry, triIndex, corner) {
  if (geometry.index) return geometry.index.getX(triIndex*3+corner);
  return triIndex*3+corner;
}

function trianglePoint(geometry, triIndex, corner, target) {
  const out = target || new THREE.Vector3();
  const i = triangleVertexIndex(geometry,triIndex,corner);
  const p = geometry.getAttribute("position");
  return out.set(p.getX(i),p.getY(i),p.getZ(i));
}

function triangleNormal(geometry, triIndex, target) {
  const out = target || new THREE.Vector3();
  const a = trianglePoint(geometry,triIndex,0,new THREE.Vector3());
  const b = trianglePoint(geometry,triIndex,1,new THREE.Vector3());
  const c = trianglePoint(geometry,triIndex,2,new THREE.Vector3());
  return out.subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
}

function triangleCountFor(geometry) {
  return geometry.index ? Math.floor(geometry.index.count/3) : Math.floor(geometry.getAttribute("position").count/3);
}

function positionWeldId(geometry, vertexIndex, cache, map) {
  if (cache.has(vertexIndex)) return cache.get(vertexIndex);
  const p = geometry.getAttribute("position");
  const q = 100000;
  const key = Math.round(p.getX(vertexIndex)*q)+","+Math.round(p.getY(vertexIndex)*q)+","+Math.round(p.getZ(vertexIndex)*q);
  let id = map.get(key);
  if (id === undefined) { id = map.size; map.set(key,id); }
  cache.set(vertexIndex,id);
  return id;
}

function buildPatchesFromBrep(part) {
  const geometry = part.mesh.geometry;
  const triCount = triangleCountFor(geometry);
  const faces = (part.brepFaces || []).filter(function(f){
    return Number.isFinite(f.first) && Number.isFinite(f.last) && f.last>=f.first && f.first>=0 && f.first<triCount;
  });
  if (faces.length < 2) return null;
  if (faces.length > 250 || faces.length > triCount*0.45) return null;
  const patches = [];
  const triToPatch = new Int32Array(triCount);
  triToPatch.fill(-1);
  faces.forEach(function(f) {
    const triangles = [];
    const first = Math.max(0,Math.floor(f.first));
    const last = Math.min(triCount-1,Math.floor(f.last));
    for (let t=first;t<=last;t++) triangles.push(t);
    if (!triangles.length) return;
    const idx = patches.length;
    triangles.forEach(function(t){ triToPatch[t]=idx; });
    patches.push({triangles:triangles,source:"brep"});
  });
  return patches.length ? {patches:patches,triToPatch:triToPatch,mode:"STEP面"} : null;
}

function buildSmoothPatches(part, angleDeg) {
  const geometry = part.mesh.geometry;
  const triCount = triangleCountFor(geometry);
  const normals = new Array(triCount);
  const edgeMap = new Map();
  const weldMap = new Map();
  const weldCache = new Map();

  for (let t=0;t<triCount;t++) {
    normals[t] = triangleNormal(geometry,t,new THREE.Vector3());
    const ids = [0,1,2].map(function(c){
      return positionWeldId(geometry,triangleVertexIndex(geometry,t,c),weldCache,weldMap);
    });
    [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]].forEach(function(pair){
      const key = pair[0] < pair[1] ? pair[0]+":"+pair[1] : pair[1]+":"+pair[0];
      let arr = edgeMap.get(key);
      if (!arr) { arr=[]; edgeMap.set(key,arr); }
      arr.push(t);
    });
  }

  const neighbors = Array.from({length:triCount},function(){ return []; });
  edgeMap.forEach(function(arr){
    if (arr.length < 2) return;
    for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) {
      neighbors[arr[i]].push(arr[j]);
      neighbors[arr[j]].push(arr[i]);
    }
  });

  const cosLimit = Math.cos(THREE.MathUtils.degToRad(angleDeg));
  const triToPatch = new Int32Array(triCount);
  triToPatch.fill(-1);
  const patches = [];

  for (let start=0;start<triCount;start++) {
    if (triToPatch[start] !== -1) continue;
    const patchIndex = patches.length;
    const queue = [start];
    const triangles = [];
    triToPatch[start] = patchIndex;
    while (queue.length) {
      const t = queue.pop();
      triangles.push(t);
      const n = normals[t];
      neighbors[t].forEach(function(nb){
        if (triToPatch[nb] !== -1) return;
        if (n.dot(normals[nb]) >= cosLimit) {
          triToPatch[nb] = patchIndex;
          queue.push(nb);
        }
      });
    }
    patches.push({triangles:triangles,source:"smooth"});
  }
  return {patches:patches,triToPatch:triToPatch,mode:"自動分割"};
}

function ensurePatches(part) {
  if (part.patches) return;
  let built = part.source === "step" ? buildPatchesFromBrep(part) : null;
  if (!built) built = buildSmoothPatches(part, 12);
  part.patches = built.patches;
  part.triToPatch = built.triToPatch;
  part.patchMode = built.mode;
}

function patchStats(part, patch) {
  const geometry = part.mesh.geometry;
  part.mesh.updateMatrixWorld(true);
  const matrix = part.mesh.matrixWorld;
  const box = new THREE.Box3();
  let area = 0;
  const normals = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  patch.triangles.forEach(function(t) {
    trianglePoint(geometry,t,0,a).applyMatrix4(matrix);
    trianglePoint(geometry,t,1,b).applyMatrix4(matrix);
    trianglePoint(geometry,t,2,c).applyMatrix4(matrix);
    box.expandByPoint(a); box.expandByPoint(b); box.expandByPoint(c);
    const cross = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(b,a),
      new THREE.Vector3().subVectors(c,a)
    );
    area += cross.length()*0.5;
    if (cross.lengthSq() > 1e-16) normals.push(cross.normalize().clone());
  });

  let planar = true;
  if (normals.length > 1) {
    const base = normals[0];
    const cos2 = Math.cos(THREE.MathUtils.degToRad(2));
    for (let i=1;i<normals.length;i++) {
      if (base.dot(normals[i]) < cos2) { planar=false; break; }
    }
  }
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  return {box:box,size:size,center:center,area:area,type:planar?"平面":"曲面"};
}

function highlightPatch(part, patch) {
  clearGroup(highlightGroup);
  highlightMesh = null;
  const pos = [];
  const v = new THREE.Vector3();
  part.mesh.updateMatrixWorld(true);
  patch.triangles.forEach(function(t) {
    for (let c=0;c<3;c++) {
      trianglePoint(part.mesh.geometry,t,c,v).applyMatrix4(part.mesh.matrixWorld);
      pos.push(v.x,v.y,v.z);
    }
  });
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({
    color:0xffc247,transparent:true,opacity:0.55,side:THREE.DoubleSide,
    depthTest:false,depthWrite:false
  });
  highlightMesh = new THREE.Mesh(g,m);
  highlightMesh.renderOrder = 90;
  highlightGroup.add(highlightMesh);
}

function buildGizmo(center) {
  clearGroup(gizmoGroup);
  gizmoBase.copy(center);
  const box = new THREE.Box3().setFromObject(modelGroup);
  const size = box.getSize(new THREE.Vector3());
  const length = Math.max(size.length()*0.09, 12);
  const origin = new THREE.Vector3();
  const arrows = [
    {axis:"x",dir:new THREE.Vector3(1,0,0),color:0xff5b5b},
    {axis:"y",dir:new THREE.Vector3(0,1,0),color:0x57d878},
    {axis:"z",dir:new THREE.Vector3(0,0,1),color:0x56a8ff}
  ];
  arrows.forEach(function(a){
    const arrow = new THREE.ArrowHelper(a.dir,origin,length,a.color,length*0.26,length*0.14);
    arrow.userData.axis = a.axis;
    gizmoGroup.add(arrow);
  });
  applyPreviewTransform();
}

function selectPart(index) {
  if (!parts[index]) return;
  selectedPart = index;
  selectedPatch = null;
  clearGroup(highlightGroup);
  clearGroup(gizmoGroup);
  highlightMesh = null;
  selectedAxis = null;
  resetPreview(false);
  updateUi();
  const box = new THREE.Box3().setFromObject(parts[index].mesh);
  const size = box.getSize(new THREE.Vector3());
  $("selectionTitle").textContent = parts[index].name;
  $("selectionInfo").textContent = "外形 X "+size.x.toFixed(2)+" / Y "+size.y.toFixed(2)+" / Z "+size.z.toFixed(2)+" mm";
  setStatus("部品を選択しました。面モードに切り替えると詳細面を選べます。");
}

function selectPatchFromHit(hit) {
  const index = hit.object.userData.partIndex;
  const part = parts[index];
  if (!part) return;
  ensurePatches(part);
  const tri = Number(hit.faceIndex);
  if (!Number.isInteger(tri) || !part.triToPatch || tri < 0 || tri >= part.triToPatch.length) {
    selectPart(index);
    return;
  }
  const patchIndex = part.triToPatch[tri];
  if (patchIndex < 0 || !part.patches[patchIndex]) {
    selectPart(index);
    return;
  }
  selectedPart = index;
  selectedPatch = {partIndex:index,patchIndex:patchIndex};
  selectedAxis = null;
  previewOffset.set(0,0,0);
  previewHistory = [new THREE.Vector3()];
  previewCursor = 0;
  commandHistory = [];
  const patch = part.patches[patchIndex];
  const stats = patchStats(part,patch);
  highlightPatch(part,patch);
  buildGizmo(stats.center);
  updateUi();
  $("selectionTitle").textContent = part.name + " / 面 " + (patchIndex+1);
  $("faceType").textContent = stats.type;
  $("selectionInfo").innerHTML =
    "X " + stats.size.x.toFixed(2) + " / Y " + stats.size.y.toFixed(2) + " / Z " + stats.size.z.toFixed(2) + " mm" +
    "<br>面積 " + stats.area.toFixed(2) + " mm² ・ " + patch.triangles.length + " triangles ・ " + part.patchMode;
  setStatus("面を選択しました。X/Y/Zを選んで数値移動を試せます。");
}

function setSelectionMode(mode) {
  selectionMode = mode === "part" ? "part" : "face";
  $("partModeBtn").classList.toggle("active",selectionMode==="part");
  $("faceModeBtn").classList.toggle("active",selectionMode==="face");
  setStatus(selectionMode==="face" ? "面モード：モデルの面をタップ" : "部品モード：部品をタップ");
}

function pickAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX-rect.left)/rect.width)*2-1;
  pointer.y = -((clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  return raycaster.intersectObjects(parts.map(function(p){return p.mesh;}).filter(function(m){return m.visible;}),false);
}

renderer.domElement.addEventListener("pointerdown",function(e){
  pointerDown = {id:e.pointerId,x:e.clientX,y:e.clientY};
});
renderer.domElement.addEventListener("pointerup",function(e){
  if (!pointerDown || pointerDown.id !== e.pointerId) return;
  const dx = e.clientX-pointerDown.x;
  const dy = e.clientY-pointerDown.y;
  pointerDown = null;
  if (Math.hypot(dx,dy) > 8) return;
  const hits = pickAt(e.clientX,e.clientY);
  if (!hits.length) return;
  if (selectionMode === "part") selectPart(hits[0].object.userData.partIndex);
  else selectPatchFromHit(hits[0]);
});

function setAxis(axis) {
  if (!selectedPatch) return;
  selectedAxis = ["x","y","z"].includes(axis) ? axis : null;
  document.querySelectorAll("[data-axis]").forEach(function(btn){
    btn.classList.toggle("active",btn.dataset.axis===selectedAxis);
  });
  updateUi();
}

function applyPreviewTransform() {
  if (highlightMesh) highlightMesh.position.copy(previewOffset);
  gizmoGroup.position.copy(gizmoBase).add(previewOffset);
  $("previewValue").textContent =
    "X " + previewOffset.x.toFixed(2) + " / Y " + previewOffset.y.toFixed(2) + " / Z " + previewOffset.z.toFixed(2) + " mm";
}

function pushSnapshot(label) {
  previewHistory = previewHistory.slice(0,previewCursor+1);
  previewHistory.push(previewOffset.clone());
  previewCursor = previewHistory.length-1;
  commandHistory = commandHistory.slice(0,previewCursor-1);
  commandHistory.push(label);
  updateUi();
}

function movePreview(amount) {
  if (!selectedPatch || !selectedAxis || !Number.isFinite(amount) || amount === 0) return;
  previewOffset[selectedAxis] += amount;
  pushSnapshot("面 " + (selectedPatch.patchIndex+1) + " / " + selectedAxis.toUpperCase() + " " + (amount>=0?"+":"") + amount.toFixed(2) + " mm");
  applyPreviewTransform();
}

function resetPreview(record) {
  if (!selectedPatch) return;
  const had = previewOffset.lengthSq() > 1e-12;
  previewOffset.set(0,0,0);
  if (record && had) pushSnapshot("プレビューを0に戻す");
  else {
    previewHistory = [new THREE.Vector3()];
    previewCursor = 0;
    commandHistory = [];
  }
  applyPreviewTransform();
  updateUi();
}

function undo() {
  if (previewCursor <= 0) return;
  previewCursor--;
  previewOffset.copy(previewHistory[previewCursor]);
  applyPreviewTransform();
  updateUi();
}

function redo() {
  if (previewCursor >= previewHistory.length-1) return;
  previewCursor++;
  previewOffset.copy(previewHistory[previewCursor]);
  applyPreviewTransform();
  updateUi();
}

function renderHistory() {
  const list = $("historyList");
  const visible = commandHistory.slice(0,previewCursor);
  $("historyCount").textContent = String(visible.length);
  if (!visible.length) {
    list.innerHTML = '<div class="empty">まだコマンドはありません</div>';
    return;
  }
  list.innerHTML = "";
  visible.forEach(function(text,i){
    const row = document.createElement("div");
    row.className = "historyItem";
    const strong = document.createElement("strong");
    strong.textContent = text;
    const small = document.createElement("small");
    small.textContent = "#" + (i+1);
    row.append(strong,small);
    list.appendChild(row);
  });
}

function updateUi() {
  $("partCount").textContent = String(parts.length);
  $("selectedKind").textContent = selectedPatch ? "面" : (selectedPart>=0 ? "部品" : "—");
  $("selectedFace").textContent = selectedPatch ? String(selectedPatch.patchIndex+1) : "—";
  $("axisBar").classList.toggle("hidden",!selectedPatch);
  const canEdit = !!selectedPatch && !!selectedAxis;
  $("applyPreviewBtn").disabled = !canEdit;
  $("resetPreviewBtn").disabled = !selectedPatch || previewOffset.lengthSq() < 1e-12;
  $("undoBtn").disabled = previewCursor <= 0;
  $("redoBtn").disabled = previewCursor >= previewHistory.length-1;
  document.querySelectorAll(".axisBtn").forEach(function(btn){ btn.disabled = !selectedPatch; });
  document.querySelectorAll(".quickNudge button").forEach(function(btn){ btn.disabled = !canEdit; });
  if (!selectedPatch) $("faceType").textContent = "—";
  renderHistory();
}

function fitView() {
  if (!parts.length) return;
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x,size.y,size.z,1);
  controls.target.copy(center);
  camera.position.set(center.x + span*1.35, center.y - span*1.35, center.z + span*1.05);
  camera.near = Math.max(span/5000,0.01);
  camera.far = Math.max(span*200,1000);
  camera.updateProjectionMatrix();
  controls.update();
}

$("fileInput").addEventListener("click",function(){ this.value=""; });
$("fileInput").addEventListener("change",function(){ loadFile(this.files && this.files[0]); });
$("demoBtn").addEventListener("click",loadDemo);
$("fitBtn").addEventListener("click",fitView);
$("partModeBtn").addEventListener("click",function(){ setSelectionMode("part"); });
$("faceModeBtn").addEventListener("click",function(){ setSelectionMode("face"); });
document.querySelectorAll("[data-axis]").forEach(function(btn){
  btn.addEventListener("click",function(){ setAxis(btn.dataset.axis); });
});
document.querySelectorAll("[data-delta]").forEach(function(btn){
  btn.addEventListener("click",function(){ movePreview(Number(btn.dataset.delta)); });
});
$("applyPreviewBtn").addEventListener("click",function(){
  movePreview(Number($("moveAmount").value));
});
$("resetPreviewBtn").addEventListener("click",function(){ resetPreview(true); });
$("undoBtn").addEventListener("click",undo);
$("redoBtn").addEventListener("click",redo);

setSelectionMode("face");
updateUi();
window.__OKACAD_NEXT_READY__ = true;
