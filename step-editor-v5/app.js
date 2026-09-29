import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const $ = (id) => document.getElementById(id);
const viewer = $('viewer');
const input = $('stepInput');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02070d);

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000000);
camera.up.set(0, 0, 1);
camera.position.set(120, -120, 90);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
viewer.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'label-layer';
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
viewer.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.9;
controls.panSpeed = 0.8;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x24384e, 2.5));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(100, -80, 150);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x9ecbff, 1.2);
fillLight.position.set(-100, 80, 60);
scene.add(fillLight);

const grid = new THREE.GridHelper(400, 40, 0x355575, 0x1a3047);
grid.rotation.x = Math.PI / 2;
grid.material.opacity = 0.62;
grid.material.transparent = true;
scene.add(grid);

const axes = new THREE.AxesHelper(35);
scene.add(axes);

const modelGroup = new THREE.Group();
scene.add(modelGroup);

const measureGroup = new THREE.Group();
scene.add(measureGroup);

const dimensionGroup = new THREE.Group();
scene.add(dimensionGroup);

const faceHighlightGroup = new THREE.Group();
scene.add(faceHighlightGroup);

const axisSignGroup = new THREE.Group();
scene.add(axisSignGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let occtPromise = null;
let parts = [];
let selectedIndex = -1;
let modelBox = new THREE.Box3();
let modelSize = new THREE.Vector3();
let wireframe = false;
let measureMode = false;
let measurePoints = [];
let pointerDown = null;
let cadCounter = 0;
let unitMode = 'mm';
let selectedDimsOn = true;
let dimensionOwner = null;
let lastTapPoint = null;
let selectionMode = 'part';
let detailAngleDeg = 12;
let selectedPatch = null;
let originalStepBytes = null;
let originalStepName = '';
let editHistory = [];
let editCursor = 0;
let faceDrag = null;
let touchDragEnabled = false;
let editTargetConfirmed = false;
let confirmedPatchKey = '';
let selectedAxis = null;
let axisAnchor = 'min';

function setStatus(text, type = 'idle') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + type;
}

function setLoading(show, text = '読み込み中…') {
  $('loading').classList.toggle('hidden', !show);
  $('loadingText').textContent = text;
}

function setLoadProgress(percent, visible = true) {
  $('loadProgress').classList.toggle('hidden', !visible);
  $('loadProgressBar').style.width = Math.max(0, Math.min(100, percent)) + '%';
}

function resize() {
  const r = viewer.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  labelRenderer.setSize(r.width, r.height);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(viewer);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();

function flatArray(value) {
  if (!value) return [];
  const arr = ArrayBuffer.isView(value) ? Array.from(value) : value;
  if (Array.isArray(arr) && Array.isArray(arr[0])) return arr.flat();
  return Array.isArray(arr) ? arr : Array.from(arr);
}

function formatRawMm(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(1);
  if (a >= 100) return v.toFixed(2);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

function unitName() {
  return unitMode === 'm' ? 'm' : 'mm';
}

function formatLengthValue(mm) {
  if (!Number.isFinite(mm)) return '—';
  if (unitMode === 'm') {
    const m = mm / 1000;
    const a = Math.abs(m);
    return a >= 10 ? m.toFixed(3) : m.toFixed(4);
  }
  return formatRawMm(mm);
}

function formatLength(mm) {
  return formatLengthValue(mm) + ' ' + unitName();
}

function formatArea(mm2) {
  if (!Number.isFinite(mm2)) return '—';
  if (unitMode === 'm') {
    const m2 = mm2 / 1000000;
    return (Math.abs(m2) >= 10 ? m2.toFixed(3) : m2.toFixed(5)) + ' m²';
  }
  return (Math.abs(mm2) >= 1000 ? mm2.toFixed(1) : mm2.toFixed(2)) + ' mm²';
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function safeName(name, fallback) {
  const s = String(name || '').trim();
  return s || fallback;
}

function colorFromData(c) {
  if (!Array.isArray(c) || c.length < 3) return new THREE.Color(0xb9c6d6);
  let [r, g, b] = c.map(Number);
  if (Math.max(r, g, b) > 1.001) {
    r /= 255; g /= 255; b /= 255;
  }
  return new THREE.Color(
    Math.max(0, Math.min(1, r)),
    Math.max(0, Math.min(1, g)),
    Math.max(0, Math.min(1, b))
  );
}

function collectNodeInfo(root) {
  const info = new Map();
  function walk(node, path = []) {
    if (!node) return;
    const nodeName = safeName(node.name, '');
    const nextPath = nodeName ? [...path, nodeName] : path;
    const label = nodeName || (nextPath.length ? nextPath[nextPath.length - 1] : '');
    for (const idx of node.meshes || []) {
      if (!info.has(idx)) {
        info.set(idx, {
          name: label || 'Part ' + (idx + 1),
          path: nextPath.join(' / ')
        });
      }
    }
    for (const child of node.children || []) walk(child, nextPath);
  }
  walk(root);
  return info;
}

function disposeObject(obj) {
  obj.traverse?.((child) => {
    if (child.element) child.element.remove();
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach(m => m?.dispose?.());
    else child.material?.dispose?.();
  });
}

function clearGroup(group) {
  while (group.children.length) {
    const obj = group.children[group.children.length - 1];
    group.remove(obj);
    disposeObject(obj);
  }
}

function clearPartDimensions() {
  clearGroup(dimensionGroup);
  dimensionOwner = null;
  updateDimensionButtons();
  updateAxisPanel();
}

function disposeModel() {
  clearMeasurement();
  clearPartDimensions();
  clearGroup(faceHighlightGroup);
  clearGroup(axisSignGroup);
  selectedPatch = null;
  for (const part of parts) {
    modelGroup.remove(part.mesh);
    part.mesh.geometry.dispose();
    part.mesh.material.dispose();
  }
  parts = [];
  selectedIndex = -1;
  modelBox.makeEmpty();
  modelSize.set(0, 0, 0);
  lastTapPoint = null;
  $('partsList').innerHTML = '<div class="empty">STEPを開くか、下のCAD作成から部品を追加してください</div>';
  $('partCount').textContent = '—';
  $('sizeX').textContent = '—';
  $('sizeY').textContent = '—';
  $('sizeZ').textContent = '—';
  $('selectedName').textContent = '未選択';
  $('selectedPath').textContent = '';
  $('selectedDims').textContent = 'モデルをタップ';
  $('tapPoint').textContent = 'タップした部品の外形 X・Y・Z を3D上に自動表示します';
  $('facesTitle').textContent = '部品を選択してください';
  $('faceCount').textContent = '0 面';
  $('faceInfo').textContent = '「詳細面」モードに切り替えると、面・穴まわり・R部などを個別にタップできます。';
  $('facesList').innerHTML = '<div class="empty">部品を選ぶと詳細面がここに並びます</div>';
  updateVisibleCount();
  setModelButtons(false);
  setSelectedButtons(false);
}

function setModelButtons(enabled) {
  [
    'fitBtn','isoBtn','frontBtn','rightBtn','backBtn','leftBtn','topBtn','bottomBtn',
    'modelDimBtn','measureBtn','clearMeasureBtn','unitBtn','saveGlbBtn',
    'showAllBtn','wireBtn','partModeBtn','faceModeBtn','fineLevelBtn','normalLevelBtn','coarseLevelBtn','touchDragToggleBtn',
    'axisXCard','axisYCard','axisZCard'
  ].forEach(id => $(id).disabled = !enabled);
}

function setSelectedButtons(enabled) {
  ['focusBtn','isolateBtn','hideBtn','dimSelectedBtn'].forEach(id => $(id).disabled = !enabled);
  if (!enabled) {
    $('applyPosBtn').disabled = true;
    $('deleteCadBtn').disabled = true;
  }
}

function getVisibleBox() {
  const box = new THREE.Box3();
  let any = false;
  for (const part of parts) {
    if (!part.mesh.visible) continue;
    part.mesh.updateMatrixWorld(true);
    box.expandByObject(part.mesh);
    any = true;
  }
  return any ? box : null;
}

function recomputeModelStats(fit = false) {
  if (!parts.length) {
    modelBox.makeEmpty();
    modelSize.set(0,0,0);
    $('sizeX').textContent='—'; $('sizeY').textContent='—'; $('sizeZ').textContent='—';
    $('partCount').textContent='—';
    setModelButtons(false);
    $('saveStlBtn').disabled = true;
    $('clearCadBtn').disabled = true;
    updateVisibleCount();
    return;
  }
  const box = getVisibleBox() || new THREE.Box3().setFromObject(modelGroup);
  modelBox.copy(box);
  modelSize = modelBox.getSize(new THREE.Vector3());
  refreshStats();
  $('partCount').textContent = String(parts.length);
  setModelButtons(true);
  const hasCad = parts.some(p => p.source === 'cad');
  $('saveStlBtn').disabled = !hasCad;
  $('clearCadBtn').disabled = !hasCad;
  updateVisibleCount();
  updateAxisSignsOnly();
  if(selectedAxis) showSelectedAxisDimension();
  if (fit) fitView('iso');
}

function refreshStats() {
  $('sizeX').textContent = formatLengthValue(modelSize.x);
  $('sizeY').textContent = formatLengthValue(modelSize.y);
  $('sizeZ').textContent = formatLengthValue(modelSize.z);
  ['unitX','unitY','unitZ'].forEach(id => $(id).textContent = unitName());
  $('unitBtn').textContent = '単位 ' + unitName();
  if (selectedIndex >= 0 && parts[selectedIndex]) updateSelectedInfo(parts[selectedIndex]);
}

async function getOcct() {
  if (!occtPromise) {
    if (typeof window.occtimportjs !== 'function') {
      throw new Error('STEP変換エンジンを読み込めませんでした。通信状態を確認してください。');
    }
    occtPromise = window.occtimportjs({
      locateFile(path) {
        return 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/' + path;
      }
    }).catch(err => {
      occtPromise = null;
      throw err;
    });
  }
  return occtPromise;
}

function createGeometry(meshData) {
  const pos = flatArray(meshData?.attributes?.position?.array);
  if (pos.length < 9) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));

  const normals = flatArray(meshData?.attributes?.normal?.array);
  if (normals.length === pos.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  }

  const indices = flatArray(meshData?.index?.array);
  if (indices.length >= 3) geometry.setIndex(indices);

  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildModel(result) {
  const nodeInfo = collectNodeInfo(result.root);
  const duplicateCount = new Map();

  (result.meshes || []).forEach((meshData, i) => {
    const geometry = createGeometry(meshData);
    if (!geometry) return;

    const info = nodeInfo.get(i) || {};
    const baseName = safeName(info.name || meshData.name, 'Part ' + (i + 1));
    const used = duplicateCount.get(baseName) || 0;
    duplicateCount.set(baseName, used + 1);
    const name = used ? baseName + ' #' + (used + 1) : baseName;

    const color = colorFromData(meshData.color);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.userData.partIndex = parts.length;
    mesh.userData.baseColor = color.getHex();
    mesh.userData.sourceMeshIndex = i;
    modelGroup.add(mesh);

    const localBox = geometry.boundingBox?.clone() || new THREE.Box3().setFromObject(mesh);
    const localSize = localBox.getSize(new THREE.Vector3());
    const triangles = geometry.index
      ? Math.floor(geometry.index.count / 3)
      : Math.floor(geometry.getAttribute('position').count / 3);

    parts.push({
      mesh, name, path: info.path || name, localBox, localSize, triangles, source:'step',
      brepFaces: Array.isArray(meshData.brep_faces) ? meshData.brep_faces.map(f => ({
        first:Number(f.first)||0, last:Number(f.last)||0, color:f.color||null
      })) : [],
      patches:null, triToPatch:null, patchMode:null, patchAngle:null,
      basePosition:new Float32Array(geometry.getAttribute('position').array)
    });
  });

  if (!parts.length) throw new Error('STEP内に表示できる形状が見つかりませんでした。');

  renderPartsList();
  recomputeModelStats(false);
  setSelectedButtons(false);
  fitView('iso');
}

function renderPartsList() {
  const list = $('partsList');
  list.innerHTML = '';

  parts.forEach((part, index) => {
    part.mesh.userData.partIndex = index;
    const row = document.createElement('div');
    row.className = 'partRow';
    row.dataset.index = index;

    const eye = document.createElement('button');
    eye.className = 'eyeBtn';
    eye.type = 'button';
    eye.textContent = part.mesh.visible ? '👁' : '—';
    eye.title = '表示 / 非表示';
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      part.mesh.visible = !part.mesh.visible;
      eye.textContent = part.mesh.visible ? '👁' : '—';
      row.style.opacity = part.mesh.visible ? '1' : '.55';
      if (!part.mesh.visible && index === selectedIndex) clearPartDimensions();
      recomputeModelStats(false);
    });

    const nameWrap = document.createElement('div');
    nameWrap.className = 'partName';
    const strong = document.createElement('strong');
    strong.textContent = (part.source === 'cad' ? 'CAD: ' : '') + part.name;
    const small = document.createElement('small');
    const box = new THREE.Box3().setFromObject(part.mesh);
    const size = box.getSize(new THREE.Vector3());
    small.textContent =
      formatLengthValue(size.x) + ' × ' +
      formatLengthValue(size.y) + ' × ' +
      formatLengthValue(size.z) + ' ' + unitName() +
      (part.patches ? ' ・ 詳細 ' + part.patches.length : '');
    nameWrap.append(strong, small);

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'selectBtn';
    select.textContent = '選択';
    select.addEventListener('click', (e) => {
      e.stopPropagation();
      selectPart(index, true);
    });

    row.addEventListener('click', () => selectPart(index, true));
    row.append(eye, nameWrap, select);
    list.appendChild(row);
  });
}

function updateVisibleCount() {
  const visible = parts.filter(p => p.mesh.visible).length;
  $('visibleCount').textContent = visible + ' / ' + parts.length;
}

function clearSelectionHighlight() {
  for (const part of parts) {
    if (part.mesh.material?.emissive) {
      part.mesh.material.emissive.setHex(0x000000);
      part.mesh.material.emissiveIntensity = 0;
    }
  }
  document.querySelectorAll('.partRow.selected').forEach(el => el.classList.remove('selected'));
}

function updateSelectedInfo(part) {
  const box = new THREE.Box3().setFromObject(part.mesh);
  const size = box.getSize(new THREE.Vector3());
  $('selectedName').textContent = part.name;
  $('selectedPath').textContent = part.path && part.path !== part.name ? part.path : '';
  $('selectedDims').innerHTML =
    'X ' + formatLength(size.x) + '<br>' +
    'Y ' + formatLength(size.y) + '<br>' +
    'Z ' + formatLength(size.z);

  if (lastTapPoint) {
    $('tapPoint').textContent =
      'タップ位置  X ' + formatLength(lastTapPoint.x) +
      ' / Y ' + formatLength(lastTapPoint.y) +
      ' / Z ' + formatLength(lastTapPoint.z);
  } else {
    $('tapPoint').textContent = '外形寸法を3D上にも表示中';
  }
}

function selectPart(index, scrollIntoView = false, tapPoint = null) {
  if (index < 0 || index >= parts.length) return;
  selectedIndex = index;
  lastTapPoint = tapPoint ? tapPoint.clone() : null;
  clearSelectionHighlight();

  const part = parts[index];
  if (part.mesh.material?.emissive) {
    part.mesh.material.emissive.setHex(0x168fd2);
    part.mesh.material.emissiveIntensity = 0.35;
  }

  const row = document.querySelector('.partRow[data-index="' + index + '"]');
  if (row) {
    row.classList.add('selected');
    if (scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  updateSelectedInfo(part);
  setSelectedButtons(true);
  ensureDetailPatches(part);
  renderFacesList(part, index);

  const isCad = part.source === 'cad';
  $('applyPosBtn').disabled = !isCad;
  $('deleteCadBtn').disabled = !isCad;
  if (isCad) {
    $('posX').value = Number(part.mesh.position.x.toFixed(3));
    $('posY').value = Number(part.mesh.position.y.toFixed(3));
    const baseZ = Number(part.baseOffsetZ || 0);
    $('posZ').value = Number((part.mesh.position.z - baseZ).toFixed(3));
  }

  clearGroup(faceHighlightGroup);
  selectedPatch = null;
  if (selectionMode === 'part' && selectedDimsOn && part.mesh.visible) {
    showBoxDimensions(new THREE.Box3().setFromObject(part.mesh), 'part');
  } else {
    clearPartDimensions();
    if (selectionMode === 'face') {
      $('tapPoint').textContent = '詳細面モード：見たい面・穴内周・R部を直接タップしてください';
    }
  }
  updateDimensionButtons();
}

function makeLine(points, color = 0x7fcfff, opacity = 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 50;
  return line;
}

function addDimensionLine(a, b, witnessA, witnessB, label, axisClass, color) {
  dimensionGroup.add(makeLine([a, b], color));
  if (witnessA) dimensionGroup.add(makeLine([witnessA, a], color, 0.72));
  if (witnessB) dimensionGroup.add(makeLine([witnessB, b], color, 0.72));

  const el = document.createElement('div');
  el.className = 'dimensionLabel ' + axisClass;
  el.textContent = label;
  const obj = new CSS2DObject(el);
  obj.position.copy(a).lerp(b, 0.5);
  dimensionGroup.add(obj);
}

function showBoxDimensions(box, owner = 'part') {
  if (!box || box.isEmpty()) return;
  clearGroup(dimensionGroup);

  const b = box.clone();
  const size = b.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.1);
  const off = Math.max(maxDim * 0.085, 0.5);

  const helper = new THREE.Box3Helper(b, owner === 'model' ? 0xffc857 : 0x49b8f2);
  helper.material.depthTest = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.72;
  helper.renderOrder = 45;
  dimensionGroup.add(helper);

  const xA = new THREE.Vector3(b.min.x, b.min.y - off, b.min.z - off);
  const xB = new THREE.Vector3(b.max.x, b.min.y - off, b.min.z - off);
  addDimensionLine(
    xA, xB,
    new THREE.Vector3(b.min.x, b.min.y, b.min.z),
    new THREE.Vector3(b.max.x, b.min.y, b.min.z),
    'X ' + formatLength(size.x), 'axisX', 0xff6868
  );

  const yA = new THREE.Vector3(b.min.x - off, b.min.y, b.min.z - off);
  const yB = new THREE.Vector3(b.min.x - off, b.max.y, b.min.z - off);
  addDimensionLine(
    yA, yB,
    new THREE.Vector3(b.min.x, b.min.y, b.min.z),
    new THREE.Vector3(b.min.x, b.max.y, b.min.z),
    'Y ' + formatLength(size.y), 'axisY', 0x69df7b
  );

  const zA = new THREE.Vector3(b.min.x - off, b.min.y - off, b.min.z);
  const zB = new THREE.Vector3(b.min.x - off, b.min.y - off, b.max.z);
  addDimensionLine(
    zA, zB,
    new THREE.Vector3(b.min.x, b.min.y, b.min.z),
    new THREE.Vector3(b.min.x, b.min.y, b.max.z),
    'Z ' + formatLength(size.z), 'axisZ', 0x5da8ff
  );

  dimensionOwner = owner;
  updateDimensionButtons();
}

function showAxisDimensionOnly(box, axis, owner='axis') {
  if (!box || box.isEmpty() || !['x','y','z'].includes(axis)) return;
  clearGroup(dimensionGroup);

  const b=box.clone();
  const size=b.getSize(new THREE.Vector3());
  const maxDim=Math.max(size.x,size.y,size.z,0.1);
  const off=Math.max(maxDim*0.085,0.5);

  if(axis==='x'){
    const a=new THREE.Vector3(b.min.x,b.min.y-off,b.min.z-off);
    const c=new THREE.Vector3(b.max.x,b.min.y-off,b.min.z-off);
    addDimensionLine(
      a,c,
      new THREE.Vector3(b.min.x,b.min.y,b.min.z),
      new THREE.Vector3(b.max.x,b.min.y,b.min.z),
      'X '+formatLength(size.x),'axisX',0xff6868
    );
  }else if(axis==='y'){
    const a=new THREE.Vector3(b.min.x-off,b.min.y,b.min.z-off);
    const c=new THREE.Vector3(b.min.x-off,b.max.y,b.min.z-off);
    addDimensionLine(
      a,c,
      new THREE.Vector3(b.min.x,b.min.y,b.min.z),
      new THREE.Vector3(b.min.x,b.max.y,b.min.z),
      'Y '+formatLength(size.y),'axisY',0x69df7b
    );
  }else{
    const a=new THREE.Vector3(b.min.x-off,b.min.y-off,b.min.z);
    const c=new THREE.Vector3(b.min.x-off,b.min.y-off,b.max.z);
    addDimensionLine(
      a,c,
      new THREE.Vector3(b.min.x,b.min.y,b.min.z),
      new THREE.Vector3(b.min.x,b.min.y,b.max.z),
      'Z '+formatLength(size.z),'axisZ',0x5da8ff
    );
  }

  dimensionOwner=owner;
  updateDimensionButtons();
}

function showSelectedAxisDimension(){
  if(!selectedAxis) return false;
  const resolved=getAxisPart();
  if(!resolved?.part?.mesh?.visible) return false;
  showAxisDimensionOnly(new THREE.Box3().setFromObject(resolved.part.mesh),selectedAxis,'axis');
  return true;
}

function updateDimensionButtons() {
  $('modelDimBtn').textContent = dimensionOwner === 'model' ? '📐 全体寸法 OFF' : '📐 全体寸法';
  $('dimSelectedBtn').textContent = selectedDimsOn ? '寸法線 OFF' : '寸法線 ON';
}

function toggleSelectedDimensions() {
  if (selectedIndex < 0 || !parts[selectedIndex]) return;
  selectedDimsOn = !selectedDimsOn;
  if (selectedDimsOn && parts[selectedIndex].mesh.visible) {
    showBoxDimensions(new THREE.Box3().setFromObject(parts[selectedIndex].mesh), 'part');
  } else {
    clearPartDimensions();
  }
  updateDimensionButtons();
}

function toggleModelDimensions() {
  if (dimensionOwner === 'model') {
    clearPartDimensions();
    return;
  }
  const box = getVisibleBox();
  if (box) showBoxDimensions(box, 'model');
}

function fitBox(box, mode = 'iso') {
  if (!box || box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.55;

  let dir;
  if (mode === 'front') dir = new THREE.Vector3(0, -1, 0);
  else if (mode === 'right') dir = new THREE.Vector3(1, 0, 0);
  else if (mode === 'back') dir = new THREE.Vector3(0, 1, 0);
  else if (mode === 'left') dir = new THREE.Vector3(-1, 0, 0);
  else if (mode === 'top') dir = new THREE.Vector3(0, 0, 1);
  else if (mode === 'bottom') dir = new THREE.Vector3(0, 0, -1);
  else dir = new THREE.Vector3(1, -1, 0.78).normalize();

  camera.up.set(0, 0, 1);
  if (mode === 'top' || mode === 'bottom') camera.up.set(0, 1, 0);

  camera.near = Math.max(maxDim / 10000, 0.001);
  camera.far = Math.max(maxDim * 1000, 1000);
  camera.updateProjectionMatrix();
  camera.position.copy(center).addScaledVector(dir, dist);
  controls.target.copy(center);
  controls.update();
}

function fitBoxPreserveView(box) {
  if (!box || box.isEmpty()) return;
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  const maxDim=Math.max(size.x,size.y,size.z,1);
  const fov=THREE.MathUtils.degToRad(camera.fov);
  const dist=(maxDim/(2*Math.tan(fov/2)))*1.65;

  let dir=camera.position.clone().sub(controls.target);
  if(dir.lengthSq()<1e-12) dir.set(1,-1,.78);
  dir.normalize();

  camera.near=Math.max(maxDim/10000,0.001);
  camera.far=Math.max(maxDim*1000,1000);
  camera.updateProjectionMatrix();
  camera.position.copy(center).addScaledVector(dir,dist);
  controls.target.copy(center);
  controls.update();
}

function fitView(mode = 'iso') {
  const box = getVisibleBox();
  if (!box) return;
  modelBox.copy(box);
  modelSize = modelBox.getSize(new THREE.Vector3());
  fitBox(box, mode);
}

function focusSelected() {
  if (selectedIndex < 0 || !parts[selectedIndex]) return;
  fitBox(new THREE.Box3().setFromObject(parts[selectedIndex].mesh), 'iso');
}

function showAll() {
  clearFaceHighlight();
  for (const part of parts) part.mesh.visible = true;
  document.querySelectorAll('.partRow').forEach(row => row.style.opacity = '1');
  document.querySelectorAll('.eyeBtn').forEach(btn => btn.textContent = '👁');
  recomputeModelStats(false);
  if (selectedIndex >= 0 && selectedDimsOn) {
    showBoxDimensions(new THREE.Box3().setFromObject(parts[selectedIndex].mesh), 'part');
  }
}

function isolateSelected() {
  if (selectedIndex < 0) return;
  clearFaceHighlight();
  parts.forEach((part, i) => part.mesh.visible = i === selectedIndex);
  document.querySelectorAll('.partRow').forEach((row, i) => {
    row.style.opacity = i === selectedIndex ? '1' : '.55';
    row.querySelector('.eyeBtn').textContent = i === selectedIndex ? '👁' : '—';
  });
  recomputeModelStats(false);
  if (selectedDimsOn) showBoxDimensions(new THREE.Box3().setFromObject(parts[selectedIndex].mesh), 'part');
  focusSelected();
}

function hideSelected() {
  if (selectedIndex < 0) return;
  clearFaceHighlight();
  parts[selectedIndex].mesh.visible = false;
  const row = document.querySelector('.partRow[data-index="' + selectedIndex + '"]');
  if (row) {
    row.style.opacity = '.55';
    row.querySelector('.eyeBtn').textContent = '—';
  }
  clearPartDimensions();
  recomputeModelStats(false);
}

function toggleWireframe() {
  wireframe = !wireframe;
  for (const part of parts) part.mesh.material.wireframe = wireframe;
  $('wireBtn').textContent = wireframe ? 'ソリッド' : 'ワイヤー';
}

function toggleGrid() {
  grid.visible = !grid.visible;
  axes.visible = grid.visible;
  $('gridBtn').textContent = grid.visible ? 'グリッド' : 'グリッドOFF';
}

function toggleUnit() {
  unitMode = unitMode === 'mm' ? 'm' : 'mm';
  refreshStats();
  renderPartsList();

  if (dimensionOwner === 'model') {
    const box = getVisibleBox();
    if (box) showBoxDimensions(box, 'model');
  } else if (dimensionOwner === 'part' && selectedIndex >= 0 && parts[selectedIndex]) {
    showBoxDimensions(new THREE.Box3().setFromObject(parts[selectedIndex].mesh), 'part');
  } else if (dimensionOwner === 'face' && selectedPatch) {
    const p = parts[selectedPatch.partIndex];
    if (p && p.patches?.[selectedPatch.patchIndex]) {
      const st = computePatchStats(p, p.patches[selectedPatch.patchIndex]);
      showBoxDimensions(st.box, 'face');
      updateFaceReadout(p, selectedPatch.patchIndex, st);
    }
  }

  if (measurePoints.length === 2) {
    finishMeasurement(measurePoints[0], measurePoints[1], false);
  }
}

function clearMeasurement() {
  measureMode = false;
  measurePoints = [];
  clearGroup(measureGroup);
  $('measureHud').classList.add('hidden');
  $('measureBtn').textContent = '📏 2点測定';
}

function startMeasurement() {
  clearMeasurement();
  measureMode = true;
  $('measureBtn').textContent = '測定中…';
  $('measureHud').textContent = '測定: 1点目をタップ';
  $('measureHud').classList.remove('hidden');
}

function modelScale() {
  const b = getVisibleBox() || modelBox;
  const s = b.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z, 1);
}

function addMeasureMarker(point) {
  const radius = modelScale() / 120;
  const g = new THREE.SphereGeometry(radius, 18, 12);
  const m = new THREE.MeshBasicMaterial({ color: 0xffc857, depthTest: false });
  const dot = new THREE.Mesh(g, m);
  dot.position.copy(point);
  dot.renderOrder = 60;
  measureGroup.add(dot);
}

function finishMeasurement(a, b, createLine = true) {
  if (createLine) {
    const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    const material = new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 59;
    measureGroup.add(line);
  }
  const distance = a.distanceTo(b);
  $('measureHud').textContent = '距離 ' + formatLength(distance);
  $('measureHud').classList.remove('hidden');
  $('measureBtn').textContent = '📏 2点測定';
  measureMode = false;
}


function triangleVertexIndex(geometry, triIndex, corner) {
  if (geometry.index) return geometry.index.getX(triIndex * 3 + corner);
  return triIndex * 3 + corner;
}

function trianglePoint(geometry, triIndex, corner, target = new THREE.Vector3()) {
  const i = triangleVertexIndex(geometry, triIndex, corner);
  const pos = geometry.getAttribute('position');
  return target.set(pos.getX(i), pos.getY(i), pos.getZ(i));
}

function triangleNormal(geometry, triIndex, target = new THREE.Vector3()) {
  const a=trianglePoint(geometry,triIndex,0,new THREE.Vector3());
  const b=trianglePoint(geometry,triIndex,1,new THREE.Vector3());
  const c=trianglePoint(geometry,triIndex,2,new THREE.Vector3());
  return target.subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).normalize();
}

function triangleCountFor(geometry) {
  return geometry.index ? Math.floor(geometry.index.count / 3) : Math.floor(geometry.getAttribute('position').count / 3);
}

function positionWeldId(geometry, vertexIndex, cache, map) {
  if (cache.has(vertexIndex)) return cache.get(vertexIndex);
  const p=geometry.getAttribute('position');
  const q=100000;
  const key=
    Math.round(p.getX(vertexIndex)*q)+','+
    Math.round(p.getY(vertexIndex)*q)+','+
    Math.round(p.getZ(vertexIndex)*q);
  let id=map.get(key);
  if (id === undefined) { id=map.size; map.set(key,id); }
  cache.set(vertexIndex,id);
  return id;
}

function buildPatchesFromBrep(part) {
  const geometry=part.mesh.geometry;
  const triCount=triangleCountFor(geometry);
  const faces=(part.brepFaces||[]).filter(f =>
    Number.isFinite(f.first) && Number.isFinite(f.last) && f.last>=f.first &&
    f.first>=0 && f.first<triCount
  );
  if (faces.length < 2) return null;
  // If STEP conversion made almost every triangle a separate BREP face, use smooth grouping instead.
  if (faces.length > 250 || faces.length > triCount * 0.45) return null;

  const patches=[];
  const triToPatch=new Int32Array(triCount); triToPatch.fill(-1);
  for (const f of faces) {
    const triangles=[];
    const first=Math.max(0,Math.floor(f.first));
    const last=Math.min(triCount-1,Math.floor(f.last));
    for (let t=first;t<=last;t++) triangles.push(t);
    if (!triangles.length) continue;
    const idx=patches.length;
    triangles.forEach(t=>triToPatch[t]=idx);
    patches.push({triangles,source:'brep'});
  }
  return patches.length ? {patches,triToPatch,mode:'STEP面'} : null;
}

function buildSmoothPatches(part, angleDeg) {
  const geometry=part.mesh.geometry;
  const triCount=triangleCountFor(geometry);
  if (!triCount) return {patches:[],triToPatch:new Int32Array(0),mode:'自動分割'};
  const normals=new Array(triCount);
  const edgeMap=new Map();
  const weldMap=new Map(), weldCache=new Map();

  for (let t=0;t<triCount;t++) {
    normals[t]=triangleNormal(geometry,t,new THREE.Vector3());
    const ids=[0,1,2].map(c => {
      const vi=triangleVertexIndex(geometry,t,c);
      return positionWeldId(geometry,vi,weldCache,weldMap);
    });
    for (const [u,v] of [[ids[0],ids[1]],[ids[1],ids[2]],[ids[2],ids[0]]]) {
      const key=u<v ? u+':'+v : v+':'+u;
      let arr=edgeMap.get(key);
      if (!arr) { arr=[]; edgeMap.set(key,arr); }
      arr.push(t);
    }
  }

  const neighbors=Array.from({length:triCount},()=>[]);
  for (const arr of edgeMap.values()) {
    if (arr.length < 2) continue;
    for (let i=0;i<arr.length;i++) for (let j=i+1;j<arr.length;j++) {
      neighbors[arr[i]].push(arr[j]);
      neighbors[arr[j]].push(arr[i]);
    }
  }

  const cosLimit=Math.cos(THREE.MathUtils.degToRad(angleDeg));
  const triToPatch=new Int32Array(triCount); triToPatch.fill(-1);
  const patches=[];

  for (let start=0;start<triCount;start++) {
    if (triToPatch[start] !== -1) continue;
    const patchIndex=patches.length;
    const queue=[start], triangles=[];
    triToPatch[start]=patchIndex;
    while(queue.length) {
      const t=queue.pop();
      triangles.push(t);
      const n=normals[t];
      for (const nb of neighbors[t]) {
        if (triToPatch[nb] !== -1) continue;
        if (n.dot(normals[nb]) >= cosLimit) {
          triToPatch[nb]=patchIndex;
          queue.push(nb);
        }
      }
    }
    patches.push({triangles,source:'smooth'});
  }
  return {patches,triToPatch,mode:'自動分割 '+angleDeg+'°'};
}

function ensureDetailPatches(part) {
  if (!part) return;
  if (part.patches && part.patchAngle === detailAngleDeg) return;
  part.mesh.updateMatrixWorld(true);

  let built = part.source === 'step' ? buildPatchesFromBrep(part) : null;
  if (!built) built = buildSmoothPatches(part, detailAngleDeg);

  part.patches=built.patches;
  part.triToPatch=built.triToPatch;
  part.patchMode=built.mode;
  part.patchAngle=detailAngleDeg;
  part.patches.forEach((p,i)=>p.index=i);
}

function computePatchStats(part, patch) {
  const geometry=part.mesh.geometry;
  part.mesh.updateMatrixWorld(true);
  const matrix=part.mesh.matrixWorld;
  const box=new THREE.Box3();
  let area=0;
  const normals=[];
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();

  for (const t of patch.triangles) {
    trianglePoint(geometry,t,0,a).applyMatrix4(matrix);
    trianglePoint(geometry,t,1,b).applyMatrix4(matrix);
    trianglePoint(geometry,t,2,c).applyMatrix4(matrix);
    box.expandByPoint(a); box.expandByPoint(b); box.expandByPoint(c);
    const ab=new THREE.Vector3().subVectors(b,a);
    const ac=new THREE.Vector3().subVectors(c,a);
    const cross=new THREE.Vector3().crossVectors(ab,ac);
    area += cross.length() * 0.5;
    if (cross.lengthSq()>1e-16) normals.push(cross.normalize().clone());
  }

  let planar=true;
  if (normals.length>1) {
    const base=normals[0];
    const cos2=Math.cos(THREE.MathUtils.degToRad(2));
    for (let i=1;i<normals.length;i++) {
      if (base.dot(normals[i]) < cos2) { planar=false; break; }
    }
  }
  const size=box.isEmpty()?new THREE.Vector3():box.getSize(new THREE.Vector3());
  return {box,size,area,type:planar?'平面':'曲面',triangles:patch.triangles.length};
}

function clearFaceHighlight() {
  clearGroup(faceHighlightGroup);
  selectedPatch=null;
  document.querySelectorAll('.faceRow.selected').forEach(el=>el.classList.remove('selected'));
}

function highlightPatch(part, patch) {
  clearGroup(faceHighlightGroup);
  const geometry=part.mesh.geometry;
  part.mesh.updateMatrixWorld(true);
  const pos=[];
  const v=new THREE.Vector3();
  for (const t of patch.triangles) {
    for (let c=0;c<3;c++) {
      trianglePoint(geometry,t,c,v).applyMatrix4(part.mesh.matrixWorld);
      pos.push(v.x,v.y,v.z);
    }
  }
  if (!pos.length) return;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.computeVertexNormals();
  const m=new THREE.MeshBasicMaterial({
    color:0xffc247,transparent:true,opacity:.48,side:THREE.DoubleSide,
    depthTest:false,depthWrite:false
  });
  const mesh=new THREE.Mesh(g,m);
  mesh.renderOrder=80;
  faceHighlightGroup.add(mesh);
}

function updateFaceReadout(part, patchIndex, stats) {
  const patch=part.patches?.[patchIndex];
  if (!patch) return;
  $('selectedName').textContent = part.name + ' / 詳細面 ' + (patchIndex+1);
  $('selectedPath').textContent = part.path || '';
  $('selectedDims').innerHTML =
    'X '+formatLength(stats.size.x)+'<br>'+
    'Y '+formatLength(stats.size.y)+'<br>'+
    'Z '+formatLength(stats.size.z);
  $('tapPoint').innerHTML =
    stats.type+' ・ 面積 '+formatArea(stats.area)+
    ' ・ '+stats.triangles+' triangles';
  $('faceInfo').innerHTML =
    '<strong>詳細面 '+(patchIndex+1)+'</strong>　'+stats.type+
    '　面積 '+formatArea(stats.area)+
    '<br>X '+formatLength(stats.size.x)+' / Y '+formatLength(stats.size.y)+' / Z '+formatLength(stats.size.z);
}

function selectPatch(partIndex, patchIndex, scroll=true) {
  const part=parts[partIndex];
  if (!part) return;
  ensureDetailPatches(part);
  const patch=part.patches?.[patchIndex];
  if (!patch) return;

  if (selectedIndex !== partIndex) {
    selectedIndex=partIndex;
    clearSelectionHighlight();
    if (part.mesh.material?.emissive) {
      part.mesh.material.emissive.setHex(0x168fd2);
      part.mesh.material.emissiveIntensity=.18;
    }
    const row=document.querySelector('.partRow[data-index="'+partIndex+'"]');
    if (row) row.classList.add('selected');
    renderFacesList(part,partIndex);
  }

  const stats=computePatchStats(part,patch);
  clearPartDimensions();
  highlightPatch(part,patch);
  selectedPatch={partIndex,patchIndex};
  if(!showSelectedAxisDimension()) showBoxDimensions(stats.box,'face');
  resetEditConfirmation();
  updateFaceReadout(part,patchIndex,stats);
  updateEditTarget(part,patchIndex,stats);

  document.querySelectorAll('.faceRow.selected').forEach(el=>el.classList.remove('selected'));
  const row=document.querySelector('.faceRow[data-face-index="'+patchIndex+'"]');
  if (row) {
    row.classList.add('selected');
    if (scroll) row.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  setSelectedButtons(true);
}

function selectPatchFromHit(hit) {
  const partIndex=hit.object.userData.partIndex;
  const part=parts[partIndex];
  if (!part) return;
  ensureDetailPatches(part);
  const tri=Number(hit.faceIndex);
  if (!Number.isInteger(tri) || !part.triToPatch || tri<0 || tri>=part.triToPatch.length) {
    selectPart(partIndex,true,hit.point);
    return;
  }
  const patchIndex=part.triToPatch[tri];
  if (patchIndex<0) {
    selectPart(partIndex,true,hit.point);
    return;
  }
  renderFacesList(part,partIndex);
  selectPatch(partIndex,patchIndex,true);
}

function renderFacesList(part, partIndex) {
  ensureDetailPatches(part);
  const list=$('facesList');
  const count=part.patches?.length||0;
  $('facesTitle').textContent=part.name;
  $('faceCount').textContent=count+' 面';
  $('faceInfo').textContent='分割方式: '+(part.patchMode||'—')+'。一覧は面積の大きい順です。';
  list.innerHTML='';
  if (!count) {
    list.innerHTML='<div class="empty">詳細面を取得できませんでした</div>';
    return;
  }

  const rows=part.patches.map((patch,index)=>({
    patch,index,stats:computePatchStats(part,patch)
  })).sort((a,b)=>b.stats.area-a.stats.area);
  const maxRows=Math.min(rows.length,140);

  for (let r=0;r<maxRows;r++) {
    const item=rows[r];
    const row=document.createElement('div');
    row.className='faceRow';
    row.dataset.faceIndex=item.index;

    const info=document.createElement('div');
    const strong=document.createElement('strong');
    strong.textContent='詳細面 '+(item.index+1)+' ・ '+item.stats.type;
    const small=document.createElement('small');
    small.textContent=
      'X '+formatLengthValue(item.stats.size.x)+' / Y '+formatLengthValue(item.stats.size.y)+
      ' / Z '+formatLengthValue(item.stats.size.z)+' '+unitName()+
      ' ・ 面積 '+formatArea(item.stats.area);
    info.append(strong,small);

    const btn=document.createElement('button');
    btn.type='button'; btn.className='facePickBtn'; btn.textContent='表示';
    btn.addEventListener('click',(e)=>{e.stopPropagation();selectPatch(partIndex,item.index,false);});
    row.addEventListener('click',()=>selectPatch(partIndex,item.index,false));
    row.append(info,btn);
    list.appendChild(row);
  }

  if (rows.length>maxRows) {
    const more=document.createElement('div');
    more.className='empty';
    more.textContent='詳細面が多いため上位 '+maxRows+' 面を表示（3D上では全てタップできます）';
    list.appendChild(more);
  }
}

function setSelectionMode(mode) {
  if(faceDrag){ controls.enabled=true; faceDrag=null; $('dragHud').classList.add('hidden'); }
  resetEditConfirmation();
  selectionMode=mode==='face'?'face':'part';
  $('partModeBtn').classList.toggle('active',selectionMode==='part');
  $('faceModeBtn').classList.toggle('active',selectionMode==='face');
  $('tapHint').textContent=selectionMode==='face'
    ? '詳細面モード：面・穴・R部をタップ'
    : '部品モード：タップで外形寸法';
  $('modeHelp').textContent=selectionMode==='face'
    ? '面をタップして黄色に選択 → 「この面を編集」で確定 → ±ボタンか数値で変更します。'
    : '部品全体を選択して X・Y・Z 外形寸法を表示します。';
  clearFaceHighlight();
  clearPartDimensions();

  if (selectedIndex>=0 && parts[selectedIndex]) {
    const part=parts[selectedIndex];
    ensureDetailPatches(part);
    renderFacesList(part,selectedIndex);
    updateSelectedInfo(part);
    if (selectedAxis && part.mesh.visible) {
      showSelectedAxisDimension();
    } else if (selectionMode==='part' && selectedDimsOn && part.mesh.visible) {
      showBoxDimensions(new THREE.Box3().setFromObject(part.mesh),'part');
    } else if (selectionMode==='face') {
      $('tapPoint').textContent='詳細面モード：面をタップ → 黄色になったら編集面を確定';
    }
  }
}

function setDetailLevel(angle, buttonId) {
  detailAngleDeg=angle;
  ['fineLevelBtn','normalLevelBtn','coarseLevelBtn'].forEach(id=>$(id).classList.toggle('active',id===buttonId));
  for (const p of parts) {
    p.patches=null; p.triToPatch=null; p.patchAngle=null; p.patchMode=null;
  }
  clearFaceHighlight();
  clearPartDimensions();
  if (selectedIndex>=0 && parts[selectedIndex]) {
    const part=parts[selectedIndex];
    ensureDetailPatches(part);
    renderFacesList(part,selectedIndex);
    if (selectionMode==='part' && selectedDimsOn) showBoxDimensions(new THREE.Box3().setFromObject(part.mesh),'part');
  }
  renderPartsList();
}



function uniquePatchVertexIndices(part, patch) {
  const set=new Set();
  for (const t of patch.triangles) {
    for (let c=0;c<3;c++) set.add(triangleVertexIndex(part.mesh.geometry,t,c));
  }
  return Array.from(set);
}

function expandCoincidentVertexIndices(part, seedIndices, tolerance=1e-5) {
  const attr=part.mesh.geometry.getAttribute('position');
  if(!attr || !seedIndices?.length) return Array.from(seedIndices||[]);
  const inv=1/Math.max(tolerance,1e-9);
  const keys=new Set();
  for(const i of seedIndices){
    keys.add(
      Math.round(attr.getX(i)*inv)+','+
      Math.round(attr.getY(i)*inv)+','+
      Math.round(attr.getZ(i)*inv)
    );
  }
  const out=[];
  for(let i=0;i<attr.count;i++){
    const key=
      Math.round(attr.getX(i)*inv)+','+
      Math.round(attr.getY(i)*inv)+','+
      Math.round(attr.getZ(i)*inv);
    if(keys.has(key)) out.push(i);
  }
  return out;
}

function averagePatchNormalLocal(part, patch) {
  const sum=new THREE.Vector3();
  for (const t of patch.triangles) sum.add(triangleNormal(part.mesh.geometry,t,new THREE.Vector3()));
  if (sum.lengthSq()<1e-12) return new THREE.Vector3(0,0,1);
  return sum.normalize();
}

function patchLocalCenter(part, patch) {
  const ids=expandCoincidentVertexIndices(part,uniquePatchVertexIndices(part,patch));
  const pos=part.mesh.geometry.getAttribute('position');
  const c=new THREE.Vector3();
  if (!ids.length) return c;
  for (const i of ids) c.add(new THREE.Vector3(pos.getX(i),pos.getY(i),pos.getZ(i)));
  return c.multiplyScalar(1/ids.length);
}

function patchAxisSide(part, patch, axis) {
  if(!part||!patch||!['x','y','z'].includes(axis)) return null;
  const geometry=part.mesh.geometry;
  geometry.computeBoundingBox();
  const box=geometry.boundingBox;
  if(!box || box.isEmpty()) return null;

  const center=patchLocalCenter(part,patch);
  const extent=Math.max(box.max[axis]-box.min[axis],1e-9);
  const tol=Math.max(extent*0.025,0.12);
  const dMin=Math.abs(center[axis]-box.min[axis]);
  const dMax=Math.abs(box.max[axis]-center[axis]);

  if(dMin<=tol && dMin<dMax) return 'min';
  if(dMax<=tol && dMax<dMin) return 'max';
  return null;
}

function moveFaceVertexIndices(part, patch) {
  return expandCoincidentVertexIndices(part,uniquePatchVertexIndices(part,patch));
}


function axisCoord(attr,index,axis){
  return axis==='x'?attr.getX(index):(axis==='y'?attr.getY(index):attr.getZ(index));
}

function analyzeCutCandidates(part,axis,tMin,tMax,targetT){
  const geometry=part?.mesh?.geometry;
  const attr=geometry?.getAttribute('position');
  if(!geometry||!attr||!['x','y','z'].includes(axis)) return null;

  geometry.computeBoundingBox();
  const box=geometry.boundingBox;
  if(!box||box.isEmpty()) return null;

  const lo=box.min[axis], hi=box.max[axis], extent=hi-lo;
  if(!(extent>1e-9)) return null;

  const triCount=triangleCountFor(geometry);
  const data=new Array(triCount);
  for(let t=0;t<triCount;t++){
    let mn=Infinity,mx=-Infinity;
    for(let c=0;c<3;c++){
      const vi=triangleVertexIndex(geometry,t,c);
      const v=axisCoord(attr,vi,axis);
      mn=Math.min(mn,v); mx=Math.max(mx,v);
    }
    const n=triangleNormal(geometry,t,new THREE.Vector3());
    data[t]={mn,mx,na:Math.abs(n[axis])};
  }

  let best=null;
  const steps=100;
  const eps=Math.max(extent*1e-9,1e-8);

  for(let i=0;i<=steps;i++){
    const tt=tMin+(tMax-tMin)*(i/steps);
    const q=lo+extent*tt;
    let crossCount=0,badCount=0,maxAxisNormal=0;

    for(const d of data){
      if(d.mn < q-eps && d.mx > q+eps){
        crossCount++;
        maxAxisNormal=Math.max(maxAxisNormal,d.na);
        if(d.na>0.06) badCount++;
      }
    }
    if(!crossCount) continue;

    // A good stretch plane only crosses faces running parallel to the edit axis.
    // Strongly reject holes, R, steps, or end walls that would be distorted.
    const score=
      badCount*1000000 +
      maxAxisNormal*10000 +
      crossCount*0.001 +
      Math.abs(tt-targetT);

    const candidate={q,t:tt,crossCount,badCount,maxAxisNormal,score};
    if(!best || candidate.score<best.score) best=candidate;
  }

  if(!best || best.badCount>0 || best.maxAxisNormal>0.06) return null;
  return best;
}

function planCutStretch(part,axis,anchor,deltaWorld){
  const scale=worldAxisScale(part,axis);
  const deltaLocal=deltaWorld/scale;
  let cuts=[];

  if(anchor==='min'){
    const c=analyzeCutCandidates(part,axis,0.45,0.78,0.62);
    if(!c) return null;
    cuts=[{side:'max',q:c.q,deltaLocal,quality:c}];
  }else if(anchor==='max'){
    const c=analyzeCutCandidates(part,axis,0.22,0.55,0.38);
    if(!c) return null;
    cuts=[{side:'min',q:c.q,deltaLocal:-deltaLocal,quality:c}];
  }else{
    const left=analyzeCutCandidates(part,axis,0.15,0.45,0.35);
    const right=analyzeCutCandidates(part,axis,0.55,0.85,0.65);
    if(!left||!right||left.q>=right.q) return null;
    cuts=[
      {side:'min',q:left.q,deltaLocal:-deltaLocal/2,quality:left},
      {side:'max',q:right.q,deltaLocal:deltaLocal/2,quality:right}
    ];
  }

  return {cuts,deltaLocal};
}

function simulateCutStretch(part,axis,cuts){
  const geometry=part.mesh.geometry;
  const attr=geometry.getAttribute('position');
  const count=attr.count;
  const coords=new Float64Array(count);
  for(let i=0;i<count;i++) coords[i]=axisCoord(attr,i,axis);

  const next=new Float64Array(coords);
  const eps=1e-9;
  for(let i=0;i<count;i++){
    let d=0;
    const v=coords[i];
    for(const cut of cuts){
      if(cut.side==='max' && v>cut.q+eps) d+=cut.deltaLocal;
      if(cut.side==='min' && v<cut.q-eps) d+=cut.deltaLocal;
    }
    next[i]=v+d;
  }

  // Reject edits that collapse or invert any triangle.
  const triCount=triangleCountFor(geometry);
  for(let t=0;t<triCount;t++){
    const ids=[0,1,2].map(c=>triangleVertexIndex(geometry,t,c));
    const before=ids.map(i=>{
      const p=new THREE.Vector3(attr.getX(i),attr.getY(i),attr.getZ(i));
      return p;
    });
    const after=ids.map((i,k)=>{
      const p=before[k].clone();
      p[axis]=next[i];
      return p;
    });

    const nb=new THREE.Vector3().subVectors(before[1],before[0])
      .cross(new THREE.Vector3().subVectors(before[2],before[0]));
    const na=new THREE.Vector3().subVectors(after[1],after[0])
      .cross(new THREE.Vector3().subVectors(after[2],after[0]));
    const lb=nb.length(), la=na.length();
    if(!(la>1e-10) || !(lb>1e-10)) return null;
    nb.multiplyScalar(1/lb); na.multiplyScalar(1/la);
    if(nb.dot(na)<0.98) return null;
  }

  return next;
}

function extremePlaneVertexIndices(part, axis, side) {
  const geometry=part?.mesh?.geometry;
  const attr=geometry?.getAttribute('position');
  if(!geometry||!attr||!['x','y','z'].includes(axis)) return [];

  geometry.computeBoundingBox();
  const box=geometry.boundingBox;
  if(!box||box.isEmpty()) return [];

  const target=side==='min'?box.min[axis]:box.max[axis];
  const extent=Math.max(box.max[axis]-box.min[axis],1e-9);
  const tol=Math.max(extent*1e-6,1e-5);
  const ids=[];

  for(let i=0;i<attr.count;i++){
    let v=0;
    if(axis==='x') v=attr.getX(i);
    else if(axis==='y') v=attr.getY(i);
    else v=attr.getZ(i);
    if(Math.abs(v-target)<=tol) ids.push(i);
  }
  return ids;
}

function worldAxisScale(part, axis) {
  const ws=new THREE.Vector3();
  part.mesh.getWorldScale(ws);
  return Math.max(Math.abs(ws[axis]),1e-9);
}

function estimateHole(part, patch) {
  const geometry=part.mesh.geometry;
  const ids=expandCoincidentVertexIndices(part,uniquePatchVertexIndices(part,patch));
  if (ids.length<3) return null;
  const pos=geometry.getAttribute('position');
  const center=patchLocalCenter(part,patch);

  let nx=0,ny=0,nz=0,nc=0;
  for (const t of patch.triangles) {
    const n=triangleNormal(geometry,t,new THREE.Vector3());
    nx+=Math.abs(n.x); ny+=Math.abs(n.y); nz+=Math.abs(n.z); nc++;
  }
  if (!nc) return null;
  nx/=nc; ny/=nc; nz/=nc;
  let axis='x';
  if (ny<=nx && ny<=nz) axis='y';
  else if (nz<=nx && nz<=ny) axis='z';

  let sumR=0;
  for (const i of ids) {
    const x=pos.getX(i)-center.x, y=pos.getY(i)-center.y, z=pos.getZ(i)-center.z;
    let r=0;
    if (axis==='x') r=Math.hypot(y,z);
    else if (axis==='y') r=Math.hypot(x,z);
    else r=Math.hypot(x,y);
    sumR+=r;
  }
  const diameter=2*(sumR/ids.length);
  if (!Number.isFinite(diameter) || diameter<=0) return null;
  return {axis,center,diameter,vertexIndices:expandCoincidentVertexIndices(part,ids)};
}

function featureSignature(part, patchIndex, stats) {
  const center=stats.box.getCenter(new THREE.Vector3());
  return {
    partName:part.name,
    partPath:part.path||part.name,
    patchIndex,
    surfaceType:stats.type,
    triangleCount:stats.triangles,
    areaMm2:Number(stats.area.toFixed(6)),
    centerMm:[center.x,center.y,center.z].map(v=>Number(v.toFixed(6))),
    sizeMm:[stats.size.x,stats.size.y,stats.size.z].map(v=>Number(v.toFixed(6)))
  };
}


function patchKey(partIndex,patchIndex){
  return partIndex+':'+patchIndex;
}

function setEditControlsLocked(locked){
  document.querySelectorAll('[data-push]').forEach(btn=>btn.disabled=locked);
  $('applyPushPullBtn').disabled=locked;
  if(locked) $('applyHoleBtn').disabled=true;
  document.querySelectorAll('.editBlock').forEach(el=>el.classList.toggle('editLocked',locked));
}

function resetEditConfirmation(){
  editTargetConfirmed=false;
  confirmedPatchKey='';
  $('confirmEditFaceBtn').disabled=!selectedPatch;
  $('confirmEditFaceBtn').textContent='✓ この面を編集';
  setEditControlsLocked(true);
}

function confirmSelectedFaceForEdit(){
  if(!selectedPatch){
    setStatus('先に詳細面を選んでください','error');
    return;
  }
  editTargetConfirmed=true;
  confirmedPatchKey=patchKey(selectedPatch.partIndex,selectedPatch.patchIndex);
  $('confirmEditFaceBtn').disabled=true;
  $('confirmEditFaceBtn').textContent='✓ 編集面を確定';
  setEditControlsLocked(false);

  const part=parts[selectedPatch.partIndex];
  const patch=part?.patches?.[selectedPatch.patchIndex];
  if(part&&patch){
    const stats=computePatchStats(part,patch);
    const hole=estimateHole(part,patch);
    $('applyHoleBtn').disabled=!(stats.type==='曲面' && hole && hole.diameter>0);
    focusSelected();
    $('editTargetInfo').innerHTML=
      '<strong>編集面を確定しました</strong><br>'+part.name+' / 詳細面 '+(selectedPatch.patchIndex+1)+
      '<br>下の±ボタンか数値入力で変更してください。';
  }
  setStatus('編集面を確定しました','ok');
}

function ensureConfirmedEditTarget(){
  if(!selectedPatch || !editTargetConfirmed ||
     confirmedPatchKey!==patchKey(selectedPatch.partIndex,selectedPatch.patchIndex)){
    setStatus('「この面を編集」で面を確定してください','error');
    return false;
  }
  return true;
}

function toggleTouchDragAssist(){
  touchDragEnabled=!touchDragEnabled;
  $('touchDragToggleBtn').classList.toggle('active',touchDragEnabled);
  $('touchDragToggleBtn').textContent=touchDragEnabled?'指ドラッグ補助 ON':'指ドラッグ補助 OFF';
  setStatus(touchDragEnabled?'指ドラッグ補助をONにしました':'数値編集を基本に戻しました','ok');
}

function updateEditTarget(part,patchIndex,stats){
  const patch=part.patches?.[patchIndex];
  if(!patch) return;
  if(confirmedPatchKey!==patchKey(selectedPatch?.partIndex ?? -1,patchIndex)){
    editTargetConfirmed=false;
    confirmedPatchKey='';
    $('confirmEditFaceBtn').disabled=false;
    $('confirmEditFaceBtn').textContent='✓ この面を編集';
    setEditControlsLocked(true);
  }
  $('editTargetInfo').innerHTML=
    '<strong>'+part.name+' / 詳細面 '+(patchIndex+1)+'</strong><br>'+
    stats.type+' ・ X '+formatLength(stats.size.x)+' / Y '+formatLength(stats.size.y)+' / Z '+formatLength(stats.size.z)+
    '<br><span style="color:#8fd6b3">境界も一緒に動かして部品形状を伸縮します</span>';

  const hole=estimateHole(part,patch);
  const holeOkay=stats.type==='曲面' && hole && hole.diameter>0;
  $('applyHoleBtn').disabled=!(editTargetConfirmed && holeOkay);
  if(holeOkay){
    $('holeCurrentDia').textContent='Ø'+formatRawMm(hole.diameter)+' mm';
    $('holeAxis').textContent=hole.axis.toUpperCase()+'軸（推定）';
    $('holeTargetDia').value=Number(hole.diameter.toFixed(3));
  }else{
    $('holeCurrentDia').textContent='曲面を選択';
    $('holeAxis').textContent='—';
    $('holeTargetDia').value='';
  }
}

function refreshEditSelection(){
  if(!selectedPatch) return;
  const part=parts[selectedPatch.partIndex];
  const patch=part?.patches?.[selectedPatch.patchIndex];
  if(!part||!patch) return;
  const stats=computePatchStats(part,patch);
  highlightPatch(part,patch);
  if(!showSelectedAxisDimension()) showBoxDimensions(stats.box,'face');
  updateFaceReadout(part,selectedPatch.patchIndex,stats);
  updateEditTarget(part,selectedPatch.patchIndex,stats);
}

function resetGeometryToBase(){
  for(const part of parts){
    const attr=part.mesh.geometry.getAttribute('position');
    if(!attr||!part.basePosition||part.basePosition.length!==attr.array.length) continue;
    attr.array.set(part.basePosition);
    attr.needsUpdate=true;
    part.mesh.geometry.computeVertexNormals();
    part.mesh.geometry.computeBoundingBox();
    part.mesh.geometry.computeBoundingSphere();
  }
}

function applyEditCommand(cmd){
  const part=parts[cmd.partIndex];
  if(!part) return;
  const geometry=part.mesh.geometry;
  const attr=geometry.getAttribute('position');
  if(!attr) return;

  if(cmd.type==='pushPull'){
    const n=new THREE.Vector3(cmd.normal[0],cmd.normal[1],cmd.normal[2]);
    for(const i of cmd.vertexIndices){
      attr.setXYZ(i,
        attr.getX(i)+n.x*cmd.deltaMm,
        attr.getY(i)+n.y*cmd.deltaMm,
        attr.getZ(i)+n.z*cmd.deltaMm
      );
    }
  }else if(cmd.type==='axisDimension'){
    if(cmd.mode==='cut-stretch' && Array.isArray(cmd.cuts) && cmd.cuts.length){
      const original=new Float64Array(attr.count);
      for(let i=0;i<attr.count;i++) original[i]=axisCoord(attr,i,cmd.axis);

      for(let i=0;i<attr.count;i++){
        let d=0;
        const v=original[i];
        for(const cut of cmd.cuts){
          if(cut.side==='max' && v>cut.q+1e-9) d+=Number(cut.deltaLocal)||0;
          if(cut.side==='min' && v<cut.q-1e-9) d+=Number(cut.deltaLocal)||0;
        }
        const nv=v+d;
        if(cmd.axis==='x') attr.setX(i,nv);
        else if(cmd.axis==='y') attr.setY(i,nv);
        else attr.setZ(i,nv);
      }
    }else if(cmd.mode==='move-end-plane' && Array.isArray(cmd.moves) && cmd.moves.length){
      for(const move of cmd.moves){
        const delta=Number(move.deltaLocalMm)||0;
        const ids=Array.from(move.vertexIndices||[]);
        for(const i of ids){
          if(cmd.axis==='x') attr.setX(i,attr.getX(i)+delta);
          else if(cmd.axis==='y') attr.setY(i,attr.getY(i)+delta);
          else attr.setZ(i,attr.getZ(i)+delta);
        }
      }
    }else if(cmd.mode==='move-face' && Array.isArray(cmd.vertexIndices) && cmd.vertexIndices.length){
      const delta=Number(cmd.deltaLocalMm)||0;
      for(const i of cmd.vertexIndices){
        if(cmd.axis==='x') attr.setX(i,attr.getX(i)+delta);
        else if(cmd.axis==='y') attr.setY(i,attr.getY(i)+delta);
        else attr.setZ(i,attr.getZ(i)+delta);
      }
    }else{
      // Legacy fallback for old edit histories only.
      geometry.computeBoundingBox();
      const box=geometry.boundingBox;
      const axis=cmd.axis;
      const min=box.min[axis], max=box.max[axis];
      const current=Math.max(max-min,1e-9);
      const target=Math.max(Number(cmd.toDimensionMm)||current,0.0001);
      const scale=target/current;
      let fixed=min;
      if(cmd.anchor==='max') fixed=max;
      else if(cmd.anchor==='center') fixed=(min+max)/2;
      for(let i=0;i<attr.count;i++){
        let x=attr.getX(i), y=attr.getY(i), z=attr.getZ(i);
        if(axis==='x') x=fixed+(x-fixed)*scale;
        else if(axis==='y') y=fixed+(y-fixed)*scale;
        else z=fixed+(z-fixed)*scale;
        attr.setXYZ(i,x,y,z);
      }
    }
  }else if(cmd.type==='holeDiameter'){
    const c=new THREE.Vector3(cmd.center[0],cmd.center[1],cmd.center[2]);
    const scale=cmd.scale;
    for(const i of cmd.vertexIndices){
      let x=attr.getX(i),y=attr.getY(i),z=attr.getZ(i);
      if(cmd.axis==='x'){
        y=c.y+(y-c.y)*scale; z=c.z+(z-c.z)*scale;
      }else if(cmd.axis==='y'){
        x=c.x+(x-c.x)*scale; z=c.z+(z-c.z)*scale;
      }else{
        x=c.x+(x-c.x)*scale; y=c.y+(y-c.y)*scale;
      }
      attr.setXYZ(i,x,y,z);
    }
  }
  attr.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function replayEdits(){
  resetGeometryToBase();
  for(let i=0;i<editCursor;i++) applyEditCommand(editHistory[i]);
  recomputeModelStats(false);
  renderPartsList();
  if(selectedIndex>=0&&parts[selectedIndex]){
    renderFacesList(parts[selectedIndex],selectedIndex);
  }
  refreshEditSelection();
  updateEditHistoryUI();
  updateAxisPanel();
}

function editDescription(cmd){
  if(cmd.type==='pushPull'){
    const sign=cmd.deltaMm>=0?'+':'';
    return '面を '+sign+Number(cmd.deltaMm.toFixed(3))+' mm 移動';
  }
  if(cmd.type==='axisDimension'){
    const prefix=cmd.mode==='cut-stretch'?'断面ストレッチ ':(cmd.mode==='move-end-plane'?'端面移動 ':(cmd.mode==='move-face'?'面移動 ':''));
    return prefix+cmd.axis.toUpperCase()+'寸法 '+Number(cmd.fromDimensionMm.toFixed(3))+' → '+Number(cmd.toDimensionMm.toFixed(3))+' mm';
  }
  if(cmd.type==='holeDiameter'){
    return '穴径 Ø'+Number(cmd.fromDiameterMm.toFixed(3))+' → Ø'+Number(cmd.toDiameterMm.toFixed(3))+' mm';
  }
  return cmd.type;
}

function updateEditHistoryUI(){
  $('undoBtn').disabled=editCursor<=0;
  $('redoBtn').disabled=editCursor>=editHistory.length;
  $('axisUndoBtn').disabled=editCursor<=0;
  $('axisRedoBtn').disabled=editCursor>=editHistory.length;
  $('resetEditBtn').disabled=editHistory.length===0;
  $('exportNightBtn').disabled=!originalStepBytes;
  $('saveEditedStlBtn').disabled=parts.length===0;
  $('editBadge').textContent='編集 '+editCursor+'件';

  const list=$('editHistory');
  list.innerHTML='';
  if(!editHistory.length){
    list.innerHTML='<div class="empty">まだ編集していません</div>';
    return;
  }
  editHistory.forEach((cmd,i)=>{
    const row=document.createElement('div');
    row.className='historyItem'+(i<editCursor?' current':'');
    row.textContent=(i+1)+'. '+editDescription(cmd);
    const small=document.createElement('small');
    small.textContent=cmd.feature?.partName+' / 詳細面 '+((cmd.feature?.patchIndex??0)+1)+(i>=editCursor?' （やり直し待ち）':'');
    row.appendChild(small);
    list.appendChild(row);
  });
}

function commitEdit(cmd){
  if(editCursor<editHistory.length) editHistory=editHistory.slice(0,editCursor);
  editHistory.push(cmd);
  editCursor=editHistory.length;
  replayEdits();
  setStatus('編集を適用しました','ok');
}


function getAxisPart(){
  if(selectedIndex>=0 && parts[selectedIndex]) return {part:parts[selectedIndex],index:selectedIndex};
  if(parts.length===1){
    selectPart(0,false);
    return {part:parts[0],index:0};
  }
  return null;
}

function partWorldSize(part){
  return new THREE.Box3().setFromObject(part.mesh).getSize(new THREE.Vector3());
}

function axisCurrentDimension(axis){
  const resolved=getAxisPart();
  if(!resolved) return null;
  return partWorldSize(resolved.part)[axis];
}

function setAxisControlsEnabled(enabled){
  ['anchorMinBtn','anchorCenterBtn','anchorMaxBtn','applyAxisTargetBtn','matchAxis1Btn','matchAxis2Btn']
    .forEach(id=>$(id).disabled=!enabled);
  $('axisTargetInput').disabled=!enabled;
  document.querySelectorAll('[data-axis-delta]').forEach(btn=>btn.disabled=!enabled);
}


function makeAxisSign(text, cls){
  const el=document.createElement('div');
  el.className='axisSignLabel '+cls;
  el.textContent=text;
  return new CSS2DObject(el);
}

function updateAxisSignsOnly(){
  clearGroup(axisSignGroup);
  if(!selectedAxis) return;
  const resolved=getAxisPart();
  if(!resolved?.part?.mesh?.visible) return;

  const box=new THREE.Box3().setFromObject(resolved.part.mesh);
  if(box.isEmpty()) return;

  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  const pad=Math.max(Math.max(size.x,size.y,size.z,1)*0.06,0.5);

  const minP=center.clone();
  const maxP=center.clone();
  minP[selectedAxis]=box.min[selectedAxis]-pad;
  maxP[selectedAxis]=box.max[selectedAxis]+pad;

  const minus=makeAxisSign('−'+selectedAxis.toUpperCase(),'minus');
  const plus=makeAxisSign('＋'+selectedAxis.toUpperCase(),'plus');
  minus.position.copy(minP);
  plus.position.copy(maxP);
  axisSignGroup.add(minus,plus);
}

function updateAxisPanel(){
  ['x','y','z'].forEach(a=>$('axis'+a.toUpperCase()+'Card').classList.toggle('active',selectedAxis===a));
  updateAxisSignsOnly();
  ['anchorMinBtn','anchorCenterBtn','anchorMaxBtn'].forEach(id=>$(id).classList.remove('active'));
  if(axisAnchor==='min') $('anchorMinBtn').classList.add('active');
  else if(axisAnchor==='center') $('anchorCenterBtn').classList.add('active');
  else $('anchorMaxBtn').classList.add('active');

  if(!selectedAxis){
    $('anchorMinBtn').textContent='−側固定';
    $('anchorMaxBtn').textContent='＋側固定';
    $('axisEditTitle').textContent='X / Y / Z をタップ';
    $('axisEditBadge').textContent='軸 未選択';
    $('axisEditHelp').textContent='上の X・Y・Z をタップすると、その軸だけ編集できます。';
    setAxisControlsEnabled(false);
    return;
  }

  const resolved=getAxisPart();
  if(!resolved){
    $('axisEditHelp').textContent='先に編集する部品をタップしてください。';
    setAxisControlsEnabled(false);
    return;
  }

  const dim=partWorldSize(resolved.part)[selectedAxis];
  const axisLabel=selectedAxis.toUpperCase();
  $('anchorMinBtn').textContent='−'+axisLabel+'側固定';
  $('anchorMaxBtn').textContent='＋'+axisLabel+'側固定';
  $('axisEditTitle').textContent=axisLabel+'方向を編集';
  $('axisEditBadge').textContent=axisLabel+' 選択中';
  $('axisTargetInput').value=Number(dim.toFixed(3));

  setAxisControlsEnabled(true);
  $('anchorMinBtn').disabled=false;
  $('anchorCenterBtn').disabled=false;
  $('anchorMaxBtn').disabled=false;

  let moveText='';
  if(axisAnchor==='min') moveText='−'+axisLabel+'側を固定して、＋側の形を丸ごと移動';
  else if(axisAnchor==='max') moveText='＋'+axisLabel+'側を固定して、−側の形を丸ごと移動';
  else moveText='中心を保って左右の形を丸ごと移動';

  $('axisEditHelp').textContent=
    resolved.part.name+' の '+axisLabel+'寸法 '+formatRawMm(dim)+' mm。'+moveText+
    'し、穴・R・段差を避けた途中断面だけを伸ばします。適用後に寸法を再計測し、異常なら自動で戻します。';

  const others=['x','y','z'].filter(a=>a!==selectedAxis);
  $('matchAxis1Btn').textContent=others[0].toUpperCase()+'を'+axisLabel+'に合わせる';
  $('matchAxis1Btn').dataset.targetAxis=others[0];
  $('matchAxis2Btn').textContent=others[1].toUpperCase()+'を'+axisLabel+'に合わせる';
  $('matchAxis2Btn').dataset.targetAxis=others[1];
}

function selectAxis(axis){
  selectedAxis=axis;
  showSelectedAxisDimension();
  updateAxisPanel();
  setStatus(axis.toUpperCase()+'軸を選択・3D寸法は部品全体の'+axis.toUpperCase()+'だけ表示','ok');
}

function partSizeSnapshot(part){
  const v=partWorldSize(part);
  return {x:v.x,y:v.y,z:v.z};
}

function axisEditPostcheck(before,after,axis,target,tolerance=0.015){
  const result={ok:true,reasons:[]};
  if(Math.abs(after[axis]-target)>tolerance){
    result.ok=false;
    result.reasons.push(axis.toUpperCase()+'寸法 '+after[axis].toFixed(3)+'mm');
  }
  for(const a of ['x','y','z']){
    if(a===axis) continue;
    if(Math.abs(after[a]-before[a])>tolerance){
      result.ok=false;
      result.reasons.push(a.toUpperCase()+'が '+before[a].toFixed(3)+'→'+after[a].toFixed(3)+'mm');
    }
  }
  return result;
}

function rollbackLastAxisEdit(message){
  if(editCursor>0){
    editHistory.splice(editCursor-1,1);
    editCursor=Math.max(0,editCursor-1);
    replayEdits();
  }
  setStatus(message,'error');
}

function commitAxisDimension(axis,target){
  const resolved=getAxisPart();
  if(!resolved){setStatus('先に編集する部品を選んでください','error');return;}

  const part=resolved.part;
  const current=partWorldSize(part)[axis];
  const to=Number(target);
  if(!Number.isFinite(to)||to<=0){
    setStatus('目標寸法を確認してください','error'); return;
  }
  if(Math.abs(to-current)<0.0001){
    setStatus('現在と同じ寸法です','error'); return;
  }

  const deltaWorld=to-current;
  const before=partSizeSnapshot(part);
  const scale=worldAxisScale(part,axis);
  const deltaLocal=deltaWorld/scale;

  // V5.6.1: 寸法編集は「端の形を丸ごと平行移動」に戻す。
  // 中間断面を引き伸ばす方式は、IGLOOの穴・R・段差の途中に
  // 新しい段差を作ることがあった。端部の全頂点を同量移動すれば、
  // 端にある穴・R・爪の相対形状を保ったまま外形寸法だけ変えられる。
  const moves=[];
  if(axisAnchor==='min'){
    const ids=extremePlaneVertexIndices(part,axis,'max');
    if(!ids.length){setStatus('＋側の端形状を取得できません','error');return;}
    moves.push({side:'max',deltaLocalMm:deltaLocal,vertexIndices:ids});
  }else if(axisAnchor==='max'){
    const ids=extremePlaneVertexIndices(part,axis,'min');
    if(!ids.length){setStatus('−側の端形状を取得できません','error');return;}
    moves.push({side:'min',deltaLocalMm:-deltaLocal,vertexIndices:ids});
  }else{
    const minIds=extremePlaneVertexIndices(part,axis,'min');
    const maxIds=extremePlaneVertexIndices(part,axis,'max');
    if(!minIds.length||!maxIds.length){setStatus('両端の形状を取得できません','error');return;}
    moves.push({side:'min',deltaLocalMm:-deltaLocal/2,vertexIndices:minIds});
    moves.push({side:'max',deltaLocalMm:deltaLocal/2,vertexIndices:maxIds});
  }

  const cmd={
    type:'axisDimension',
    mode:'move-end-plane',
    partIndex:resolved.index,
    axis,
    anchor:axisAnchor,
    moves,
    deltaWorldMm:deltaWorld,
    fromDimensionMm:current,
    toDimensionMm:to,
    feature:{
      partName:part.name,
      partPath:part.path||part.name,
      axis,
      anchor:axisAnchor,
      editMode:'move-end-plane',
      movedEnds:moves.map(m=>({side:m.side,deltaMm:Number(m.deltaLocalMm.toFixed(6)),vertexCount:m.vertexIndices.length}))
    },
    inputMethod:'axis-card-end-plane'
  };

  if(editCursor<editHistory.length) editHistory=editHistory.slice(0,editCursor);
  editHistory.push(cmd);
  editCursor=editHistory.length;
  replayEdits();

  const after=partSizeSnapshot(parts[resolved.index]);
  const check=axisEditPostcheck(before,after,axis,to);
  if(!check.ok){
    rollbackLastAxisEdit('安全確認NG：'+check.reasons.join(' / ')+'。編集を元に戻しました');
    return;
  }

  showSelectedAxisDimension();
  updateAxisPanel();
  fitBoxPreserveView(new THREE.Box3().setFromObject(parts[resolved.index].mesh));
  setStatus(
    axis.toUpperCase()+' '+formatRawMm(current)+'→'+formatRawMm(to)+
    'mm 適用・他軸不変を確認済み','ok'
  );
}

function applyAxisDelta(delta){
  if(!selectedAxis){setStatus('X / Y / Z を選んでください','error');return;}
  const current=axisCurrentDimension(selectedAxis);
  if(current==null) return;
  commitAxisDimension(selectedAxis,current+Number(delta));
}

function applyAxisTarget(){
  if(!selectedAxis){setStatus('X / Y / Z を選んでください','error');return;}
  commitAxisDimension(selectedAxis,Number($('axisTargetInput').value));
}

function matchAxisToSelected(targetAxis){
  if(!selectedAxis){setStatus('基準にする軸を選んでください','error');return;}
  const source=axisCurrentDimension(selectedAxis);
  if(source==null) return;
  commitAxisDimension(targetAxis,source);
}

function applyPushPullValue(value){
  if(!ensureConfirmedEditTarget()) return;
  if(!selectedPatch) {
    setStatus('先に詳細面を選んでください','error'); return;
  }
  const delta=Number(value);
  if(!Number.isFinite(delta)||Math.abs(delta)<0.000001){
    setStatus('変更量を確認してください','error'); return;
  }
  const part=parts[selectedPatch.partIndex];
  const patch=part?.patches?.[selectedPatch.patchIndex];
  if(!part||!patch) return;
  const stats=computePatchStats(part,patch);
  const normal=averagePatchNormalLocal(part,patch);
  const cmd={
    type:'pushPull',
    partIndex:selectedPatch.partIndex,
    vertexIndices:expandCoincidentVertexIndices(part,uniquePatchVertexIndices(part,patch)),
    normal:[normal.x,normal.y,normal.z],
    deltaMm:delta,
    feature:featureSignature(part,selectedPatch.patchIndex,stats)
  };
  commitEdit(cmd);
}

function applyPushPull(){
  applyPushPullValue(Number($('pushPullAmount').value));
}

function applyHoleDiameter(){
  if(!ensureConfirmedEditTarget()) return;
  if(!selectedPatch){setStatus('先に穴の内周を選んでください','error');return;}
  const part=parts[selectedPatch.partIndex];
  const patch=part?.patches?.[selectedPatch.patchIndex];
  if(!part||!patch) return;
  const stats=computePatchStats(part,patch);
  const hole=estimateHole(part,patch);
  const target=Number($('holeTargetDia').value);
  if(stats.type!=='曲面'||!hole||!Number.isFinite(target)||target<=0){
    setStatus('穴の曲面と変更後の径を確認してください','error');return;
  }
  const scale=target/hole.diameter;
  if(!Number.isFinite(scale)||scale<=0){setStatus('穴径を確認してください','error');return;}
  const cmd={
    type:'holeDiameter',
    partIndex:selectedPatch.partIndex,
    vertexIndices:hole.vertexIndices,
    axis:hole.axis,
    center:[hole.center.x,hole.center.y,hole.center.z],
    scale,
    fromDiameterMm:hole.diameter,
    toDiameterMm:target,
    feature:featureSignature(part,selectedPatch.patchIndex,stats)
  };
  commitEdit(cmd);
}

function undoEdit(){
  if(editCursor<=0) return;
  editCursor--;
  replayEdits();
  setStatus('1つ戻しました','ok');
}

function redoEdit(){
  if(editCursor>=editHistory.length) return;
  editCursor++;
  replayEdits();
  setStatus('やり直しました','ok');
}

function resetEdits(){
  if(!editHistory.length) return;
  if(!window.confirm('編集を全部取り消して、読み込んだ元STEPの形に戻しますか？')) return;
  editHistory=[];
  editCursor=0;
  replayEdits();
  setStatus('元モデルへ戻しました','ok');
}

function serializableCommand(cmd){
  const out={...cmd};
  out.vertexIndices=Array.from(cmd.vertexIndices||[]);
  if(Array.isArray(cmd.moves)){
    out.moves=cmd.moves.map(m=>({...m,vertexIndices:Array.from(m.vertexIndices||[])}));
  }
  if(Array.isArray(cmd.cuts)){
    out.cuts=cmd.cuts.map(c=>({...c}));
  }
  return out;
}

async function exportNightPackage(){
  if(!originalStepBytes||!originalStepName){
    setStatus('元STEPを開いてください','error'); return;
  }
  const active=editHistory.slice(0,editCursor).map(serializableCommand);
  const payload={
    format:'OKA-CAD-EDIT',
    version:1,
    app:'岡重機 STEP Editor V5.6.1 END SHAPE',
    createdAt:new Date().toISOString(),
    sourceFile:originalStepName,
    unit:'mm',
    note:'元STEPと編集指示。表示側のメッシュ編集はプレビューで、最終CAD/STLは編集指示を元に再構築する。',
    operations:active
  };
  const base=originalStepName.replace(/\.(step|stp)$/i,'')||'model';

  setLoading(true,'ナイト用データを作成中…');
  try{
    const mod=await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');
    const files={};
    files['source/'+originalStepName]=originalStepBytes;
    files['edit.json']=mod.strToU8(JSON.stringify(payload,null,2));
    const zipped=mod.zipSync(files,{level:6});
    saveBlob(new Blob([zipped],{type:'application/octet-stream'}),base+'_EDIT.okacad');
    setStatus('ナイト用データを書き出しました','ok');
  }catch(err){
    console.error(err);
    const fallback={
      ...payload,
      sourceStepBase64:null,
      warning:'圧縮ライブラリを読み込めなかったため編集指示JSONのみを書き出しました。元STEPと一緒に渡してください。'
    };
    saveBlob(
      new Blob([JSON.stringify(fallback,null,2)],{type:'application/json'}),
      base+'_EDIT.json'
    );
    setStatus('圧縮できなかったため編集指示JSONを保存しました','error');
  }finally{
    setLoading(false);
  }
}

function saveEditedStl(){
  if(!parts.length){setStatus('モデルがありません','error');return;}
  const group=buildExportGroup();
  const exporter=new STLExporter();
  const data=exporter.parse(group,{binary:true});
  const base=(originalStepName||'edited').replace(/\.(step|stp)$/i,'');
  saveBlob(new Blob([data],{type:'model/stl'}),base+'_PREVIEW_EDIT.stl');
  setStatus('編集後の仮STLを保存しました','ok');
}



function screenPointForWorld(world, rect) {
  const p=world.clone().project(camera);
  return {
    x:(p.x*0.5+0.5)*rect.width,
    y:(-p.y*0.5+0.5)*rect.height
  };
}

function currentSelectedPatchHit(hit){
  if(!selectedPatch || !hit) return false;
  const idx=hit.object?.userData?.partIndex;
  if(idx!==selectedPatch.partIndex) return false;
  const part=parts[idx];
  if(!part) return false;
  ensureDetailPatches(part);
  const tri=Number(hit.faceIndex);
  if(!Number.isInteger(tri) || !part.triToPatch || tri<0 || tri>=part.triToPatch.length) return false;
  return part.triToPatch[tri]===selectedPatch.patchIndex;
}

function beginFaceDragCandidate(e, hit){
  if(!touchDragEnabled || !editTargetConfirmed || selectionMode!=='face' || measureMode || !selectedPatch || !currentSelectedPatchHit(hit)) return false;
  const part=parts[selectedPatch.partIndex];
  const patch=part?.patches?.[selectedPatch.patchIndex];
  if(!part||!patch) return false;

  const ids=uniquePatchVertexIndices(part,patch);
  const attr=part.mesh.geometry.getAttribute('position');
  const startPositions=new Float32Array(ids.length*3);
  ids.forEach((vi,k)=>{
    startPositions[k*3]=attr.getX(vi);
    startPositions[k*3+1]=attr.getY(vi);
    startPositions[k*3+2]=attr.getZ(vi);
  });

  const normalLocal=averagePatchNormalLocal(part,patch);
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(part.mesh.matrixWorld);
  const normalWorld=normalLocal.clone().applyMatrix3(normalMatrix).normalize();
  const stats=computePatchStats(part,patch);
  const centerWorld=stats.box.getCenter(new THREE.Vector3());
  const rect=renderer.domElement.getBoundingClientRect();
  const probe=Math.max(modelScale()*0.15,1);
  const a=screenPointForWorld(centerWorld,rect);
  const b=screenPointForWorld(centerWorld.clone().addScaledVector(normalWorld,probe),rect);
  let sx=b.x-a.x, sy=b.y-a.y;
  const sl=Math.hypot(sx,sy);
  let projected=true;
  if(sl<12){
    projected=false;
    sx=0; sy=-1;
  }else{
    sx/=sl; sy/=sl;
  }
  const pxPerMm=projected ? sl/probe : Math.max(rect.height/Math.max(modelScale()*1.5,1),0.1);

  faceDrag={
    pointerId:e.pointerId,
    startX:e.clientX,startY:e.clientY,
    partIndex:selectedPatch.partIndex,
    patchIndex:selectedPatch.patchIndex,
    vertexIndices:ids,
    startPositions,
    normalLocal,
    feature:featureSignature(part,selectedPatch.patchIndex,stats),
    screenDirX:sx,screenDirY:sy,
    pxPerMm:Math.max(pxPerMm,0.08),
    active:false,
    deltaMm:0
  };
  controls.enabled=false;
  try{renderer.domElement.setPointerCapture(e.pointerId);}catch(_){}
  return true;
}

function updateFaceDrag(e){
  if(!faceDrag || faceDrag.pointerId!==e.pointerId) return false;
  const dx=e.clientX-faceDrag.startX;
  const dy=e.clientY-faceDrag.startY;
  const travel=Math.hypot(dx,dy);
  if(!faceDrag.active && travel<5) return true;
  faceDrag.active=true;

  let along=dx*faceDrag.screenDirX + dy*faceDrag.screenDirY;
  // If normal points almost at the camera, vertical drag is used as a stable fallback.
  if(Math.abs(faceDrag.screenDirX)<0.001 && Math.abs(faceDrag.screenDirY+1)<0.001) along=-dy;
  let delta=along/faceDrag.pxPerMm;
  const limit=Math.max(modelScale()*0.5,10);
  delta=THREE.MathUtils.clamp(delta,-limit,limit);
  faceDrag.deltaMm=delta;

  const part=parts[faceDrag.partIndex];
  const attr=part?.mesh?.geometry?.getAttribute('position');
  if(!part||!attr) return true;
  const n=faceDrag.normalLocal;

  faceDrag.vertexIndices.forEach((vi,k)=>{
    const x=faceDrag.startPositions[k*3];
    const y=faceDrag.startPositions[k*3+1];
    const z=faceDrag.startPositions[k*3+2];
    attr.setXYZ(vi,x+n.x*delta,y+n.y*delta,z+n.z*delta);
  });
  attr.needsUpdate=true;
  part.mesh.geometry.computeVertexNormals();
  part.mesh.geometry.computeBoundingBox();
  part.mesh.geometry.computeBoundingSphere();

  clearGroup(faceHighlightGroup);
  clearPartDimensions();
  const patch=part.patches?.[faceDrag.patchIndex];
  if(patch){
    highlightPatch(part,patch);
    const stats=computePatchStats(part,patch);
    showBoxDimensions(stats.box,'face');
    updateFaceReadout(part,faceDrag.patchIndex,stats);
    updateEditTarget(part,faceDrag.patchIndex,stats);
  }
  $('dragHud').textContent='伸ばし '+(delta>=0?'+':'')+formatRawMm(delta)+' mm';
  $('dragHud').classList.remove('hidden');
  setStatus('部品を伸縮中','ok');
  return true;
}

function endFaceDrag(e,cancel=false){
  if(!faceDrag || faceDrag.pointerId!==e.pointerId) return false;
  const d=faceDrag;
  const part=parts[d.partIndex];
  const attr=part?.mesh?.geometry?.getAttribute('position');

  $('dragHud').classList.add('hidden');
  controls.enabled=true;
  try{renderer.domElement.releasePointerCapture(e.pointerId);}catch(_){}

  if(!d.active || cancel || Math.abs(d.deltaMm)<0.001){
    if(attr){
      d.vertexIndices.forEach((vi,k)=>{
        attr.setXYZ(vi,d.startPositions[k*3],d.startPositions[k*3+1],d.startPositions[k*3+2]);
      });
      attr.needsUpdate=true;
      part.mesh.geometry.computeVertexNormals();
      part.mesh.geometry.computeBoundingBox();
      part.mesh.geometry.computeBoundingSphere();
    }
    faceDrag=null;
    refreshEditSelection();
    return false;
  }

  // Restore the pre-drag geometry. commitEdit will replay all history and apply this command once.
  if(attr){
    d.vertexIndices.forEach((vi,k)=>{
      attr.setXYZ(vi,d.startPositions[k*3],d.startPositions[k*3+1],d.startPositions[k*3+2]);
    });
    attr.needsUpdate=true;
    part.mesh.geometry.computeVertexNormals();
    part.mesh.geometry.computeBoundingBox();
    part.mesh.geometry.computeBoundingSphere();
  }

  const cmd={
    type:'pushPull',
    partIndex:d.partIndex,
    vertexIndices:Array.from(d.vertexIndices),
    normal:[d.normalLocal.x,d.normalLocal.y,d.normalLocal.z],
    deltaMm:d.deltaMm,
    feature:d.feature,
    inputMethod:'touch-drag'
  };
  faceDrag=null;
  commitEdit(cmd);
  setStatus('部品の伸縮を確定しました','ok');
  return true;
}


function pickAt(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const meshes = parts.filter(p => p.mesh.visible).map(p => p.mesh);
  return raycaster.intersectObjects(meshes, false);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDown = { x: e.clientX, y: e.clientY, id: e.pointerId };
  if(touchDragEnabled && selectionMode==='face' && selectedPatch && !measureMode){
    const hits=pickAt(e.clientX,e.clientY);
    if(hits.length && beginFaceDragCandidate(e,hits[0])){
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}, true);

renderer.domElement.addEventListener('pointermove', (e) => {
  if(faceDrag && faceDrag.pointerId===e.pointerId){
    updateFaceDrag(e);
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

renderer.domElement.addEventListener('pointercancel', (e) => {
  if(faceDrag && faceDrag.pointerId===e.pointerId){
    e.stopImmediatePropagation();
    endFaceDrag(e,true);
  }
  pointerDown=null;
}, true);

renderer.domElement.addEventListener('pointerup', (e) => {
  const hadDrag=!!(faceDrag && faceDrag.pointerId===e.pointerId);
  if(hadDrag) e.stopImmediatePropagation();
  const wasActive=hadDrag && faceDrag.active;
  if(hadDrag){
    const committed=endFaceDrag(e,false);
    if(committed || wasActive){
      pointerDown=null;
      e.preventDefault();
      return;
    }
  }

  if (!pointerDown || pointerDown.id !== e.pointerId) return;
  const dx = e.clientX - pointerDown.x;
  const dy = e.clientY - pointerDown.y;
  pointerDown = null;
  if (Math.hypot(dx, dy) > 8) return;

  const hits = pickAt(e.clientX, e.clientY);
  if (!hits.length) return;

  if (measureMode) {
    const point = hits[0].point.clone();
    measurePoints.push(point);
    addMeasureMarker(point);
    if (measurePoints.length === 1) {
      $('measureHud').textContent = '測定: 2点目をタップ';
    } else if (measurePoints.length === 2) {
      finishMeasurement(measurePoints[0], measurePoints[1]);
    }
    return;
  }

  const idx = hits[0].object.userData.partIndex;
  if (!Number.isInteger(idx)) return;
  if (selectionMode === 'face') {
    selectPatchFromHit(hits[0]);
  } else {
    selectPart(idx, true, hits[0].point);
  }
}, true);

input.addEventListener('click', () => {
  input.value = '';
});

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  const ext = file.name.toLowerCase().split('.').pop();
  if (!['step', 'stp'].includes(ext)) {
    setStatus('STEP / STPを選んでください', 'error');
    $('fileInfo').textContent = file.name + ' は対象外です';
    return;
  }

  disposeModel();
  $('fileInfo').textContent = file.name + ' ・ ' + formatBytes(file.size);
  setStatus('読込準備中', 'idle');
  setLoadProgress(8, true);
  setLoading(true, 'STEPエンジンを準備中…');

  try {
    const occt = await getOcct();
    setLoadProgress(28, true);
    setLoading(true, 'STEPを解析中… 大きいファイルは少し待ってください');
    await new Promise(resolve => setTimeout(resolve, 30));

    const bytes = new Uint8Array(await file.arrayBuffer());
    originalStepBytes = bytes.slice();
    originalStepName = file.name;
    editHistory = [];
    editCursor = 0;
    updateEditHistoryUI();
    setLoadProgress(42, true);
    const result = occt.ReadStepFile(bytes, {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.003,
      angularDeflection: 0.5
    });

    if (!result?.success) throw new Error('STEPの解析に失敗しました。');

    setLoadProgress(82, true);
    setLoading(true, '部品と寸法情報を作成中…');
    await new Promise(resolve => setTimeout(resolve, 30));
    buildModel(result);

    setLoadProgress(100, true);
    setStatus('表示完了・部品 / 詳細面をタップ', 'ok');
    $('fileInfo').textContent =
      file.name + ' ・ ' + formatBytes(file.size) + ' ・ ' + parts.length + '部品';
    setTimeout(() => setLoadProgress(0, false), 650);
  } catch (err) {
    console.error(err);
    disposeModel();
    setLoadProgress(0, false);
    setStatus('読込失敗', 'error');
    const msg = err?.message || String(err);
    $('fileInfo').textContent = 'エラー: ' + msg;
  } finally {
    setLoading(false);
  }
});

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function buildExportGroup(filterFn = () => true) {
  const group = new THREE.Group();
  for (const part of parts) {
    if (!part.mesh.visible || !filterFn(part)) continue;
    const clone = part.mesh.clone();
    clone.geometry = part.mesh.geometry.clone();
    clone.material = part.mesh.material.clone();
    if (clone.material?.emissive) {
      clone.material.emissive.setHex(0x000000);
      clone.material.emissiveIntensity = 0;
    }
    group.add(clone);
  }
  group.updateMatrixWorld(true);
  return group;
}

function saveVisibleGlb() {
  if (!parts.some(p => p.mesh.visible)) {
    setStatus('保存する表示部品がありません', 'error');
    return;
  }
  setLoading(true, 'GLBを作成中…');
  try {
    const group = buildExportGroup();
    const exporter = new GLTFExporter();
    exporter.parse(
      group,
      (result) => {
        const blob = new Blob([result], { type:'model/gltf-binary' });
        saveBlob(blob, 'oka-step-viewer-' + new Date().toISOString().replace(/[:.]/g,'-') + '.glb');
        setLoading(false);
        setStatus('GLBを保存しました', 'ok');
      },
      (err) => {
        console.error(err);
        setLoading(false);
        setStatus('GLB保存に失敗しました', 'error');
      },
      { binary:true, onlyVisible:true }
    );
  } catch (e) {
    console.error(e);
    setLoading(false);
    setStatus('GLB保存に失敗しました', 'error');
  }
}

$('fitBtn').addEventListener('click', () => fitView('iso'));
$('isoBtn').addEventListener('click', () => fitView('iso'));
$('frontBtn').addEventListener('click', () => fitView('front'));
$('rightBtn').addEventListener('click', () => fitView('right'));
$('backBtn').addEventListener('click', () => fitView('back'));
$('leftBtn').addEventListener('click', () => fitView('left'));
$('topBtn').addEventListener('click', () => fitView('top'));
$('bottomBtn').addEventListener('click', () => fitView('bottom'));
$('modelDimBtn').addEventListener('click', toggleModelDimensions);
$('measureBtn').addEventListener('click', startMeasurement);
$('clearMeasureBtn').addEventListener('click', clearMeasurement);
$('unitBtn').addEventListener('click', toggleUnit);
$('saveGlbBtn').addEventListener('click', saveVisibleGlb);
$('showAllBtn').addEventListener('click', () => { showAll(); fitView('iso'); });
$('focusBtn').addEventListener('click', focusSelected);
$('isolateBtn').addEventListener('click', isolateSelected);
$('hideBtn').addEventListener('click', hideSelected);
$('dimSelectedBtn').addEventListener('click', toggleSelectedDimensions);
$('wireBtn').addEventListener('click', toggleWireframe);
$('gridBtn').addEventListener('click', toggleGrid);
$('partModeBtn').addEventListener('click',()=>setSelectionMode('part'));
$('faceModeBtn').addEventListener('click',()=>setSelectionMode('face'));
$('fineLevelBtn').addEventListener('click',()=>setDetailLevel(12,'fineLevelBtn'));
$('normalLevelBtn').addEventListener('click',()=>setDetailLevel(25,'normalLevelBtn'));
$('coarseLevelBtn').addEventListener('click',()=>setDetailLevel(45,'coarseLevelBtn'));
$('confirmEditFaceBtn').addEventListener('click',confirmSelectedFaceForEdit);
$('touchDragToggleBtn').addEventListener('click',toggleTouchDragAssist);
$('applyPushPullBtn').addEventListener('click',applyPushPull);
$('applyHoleBtn').addEventListener('click',applyHoleDiameter);
$('undoBtn').addEventListener('click',undoEdit);
$('redoBtn').addEventListener('click',redoEdit);
$('resetEditBtn').addEventListener('click',resetEdits);
$('exportNightBtn').addEventListener('click',exportNightPackage);
$('saveEditedStlBtn').addEventListener('click',saveEditedStl);
document.querySelectorAll('[data-push]').forEach(btn=>{
  btn.addEventListener('click',()=>applyPushPullValue(Number(btn.dataset.push)));
});


$('axisXCard').addEventListener('click',()=>selectAxis('x'));
$('axisYCard').addEventListener('click',()=>selectAxis('y'));
$('axisZCard').addEventListener('click',()=>selectAxis('z'));
$('anchorMinBtn').addEventListener('click',()=>{axisAnchor='min';updateAxisPanel();});
$('anchorCenterBtn').addEventListener('click',()=>{axisAnchor='center';updateAxisPanel();});
$('anchorMaxBtn').addEventListener('click',()=>{axisAnchor='max';updateAxisPanel();});
$('applyAxisTargetBtn').addEventListener('click',applyAxisTarget);
$('matchAxis1Btn').addEventListener('click',()=>matchAxisToSelected($('matchAxis1Btn').dataset.targetAxis));
$('matchAxis2Btn').addEventListener('click',()=>matchAxisToSelected($('matchAxis2Btn').dataset.targetAxis));
$('axisUndoBtn').addEventListener('click',undoEdit);
$('axisRedoBtn').addEventListener('click',redoEdit);
document.querySelectorAll('[data-axis-delta]').forEach(btn=>{
  btn.addEventListener('click',()=>applyAxisDelta(Number(btn.dataset.axisDelta)));
});

function cadNumber(id, min = -Infinity) {
  const v = Number($(id).value);
  if (!Number.isFinite(v) || v < min) throw new Error('寸法を確認してください');
  return v;
}

function addCadPart(kind) {
  try {
    let geometry, name, baseOffsetZ = 0;
    if (kind === 'box') {
      const x=cadNumber('boxX',0.01), y=cadNumber('boxY',0.01), z=cadNumber('boxZ',0.01);
      geometry = new THREE.BoxGeometry(x,y,z);
      geometry.computeBoundingBox();
      name = 'Box ' + (++cadCounter);
      baseOffsetZ = z/2;
    } else {
      const d=cadNumber('cylD',0.01), h=cadNumber('cylH',0.01);
      geometry = new THREE.CylinderGeometry(d/2,d/2,h,64,1,false);
      geometry.rotateX(Math.PI/2);
      geometry.computeBoundingBox();
      name = 'Cylinder ' + (++cadCounter);
      baseOffsetZ = h/2;
    }
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color:0x69b7e8, roughness:.65, metalness:.04, side:THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry,material);
    mesh.name=name;
    mesh.position.set(0,0,baseOffsetZ);
    mesh.userData.baseColor=material.color.getHex();
    modelGroup.add(mesh);
    const localBox=geometry.boundingBox.clone();
    const localSize=localBox.getSize(new THREE.Vector3());
    const triangles=geometry.index?Math.floor(geometry.index.count/3):Math.floor(geometry.getAttribute('position').count/3);
    parts.push({
      mesh,name,path:name,localBox,localSize,triangles,source:'cad',kind,baseOffsetZ,
      brepFaces:[], patches:null, triToPatch:null, patchMode:null, patchAngle:null,
      basePosition:new Float32Array(geometry.getAttribute('position').array)
    });
    renderPartsList();
    recomputeModelStats(true);
    selectPart(parts.length-1,true);
    setStatus('CAD部品を追加しました','ok');
  } catch(e) {
    setStatus(e.message || 'CAD作成エラー','error');
  }
}

function applyCadPosition() {
  if (selectedIndex < 0) return;
  const part=parts[selectedIndex];
  if (part.source !== 'cad') return;
  try {
    const x=cadNumber('posX'), y=cadNumber('posY'), z=cadNumber('posZ');
    part.mesh.position.set(x,y,z + Number(part.baseOffsetZ||0));
    part.mesh.updateMatrixWorld(true);
    recomputeModelStats(false);
    updateSelectedInfo(part);
    if (selectedDimsOn) showBoxDimensions(new THREE.Box3().setFromObject(part.mesh), 'part');
    setStatus('CAD位置を更新しました','ok');
  } catch(e) {
    setStatus(e.message || '位置入力エラー','error');
  }
}

function deleteSelectedCad() {
  if (selectedIndex < 0) return;
  const part=parts[selectedIndex];
  if (part.source !== 'cad') return;
  modelGroup.remove(part.mesh);
  part.mesh.geometry.dispose();
  part.mesh.material.dispose();
  parts.splice(selectedIndex,1);
  selectedIndex=-1;
  clearSelectionHighlight();
  clearPartDimensions();
  clearFaceHighlight();
  lastTapPoint=null;
  $('selectedName').textContent='未選択';
  $('selectedPath').textContent='';
  $('selectedDims').textContent='モデルをタップ';
  $('tapPoint').textContent='タップした部品の外形 X・Y・Z を3D上に自動表示します';
  setSelectedButtons(false);
  renderPartsList();
  recomputeModelStats(true);
  setStatus('CAD部品を削除しました','ok');
}

function clearCadParts() {
  const keep=[];
  for (const part of parts) {
    if (part.source === 'cad') {
      modelGroup.remove(part.mesh);
      part.mesh.geometry.dispose();
      part.mesh.material.dispose();
    } else keep.push(part);
  }
  parts=keep;
  selectedIndex=-1;
  clearSelectionHighlight();
  clearPartDimensions();
  clearFaceHighlight();
  lastTapPoint=null;
  $('selectedName').textContent='未選択';
  $('selectedPath').textContent='';
  $('selectedDims').textContent='モデルをタップ';
  $('tapPoint').textContent='タップした部品の外形 X・Y・Z を3D上に自動表示します';
  setSelectedButtons(false);
  renderPartsList();
  recomputeModelStats(true);
  setStatus('CAD部品を全削除しました','ok');
}

function saveCadStl() {
  const cad=parts.filter(p=>p.source==='cad' && p.mesh.visible);
  if (!cad.length) {
    setStatus('保存するCAD部品がありません','error');
    return;
  }
  const group=buildExportGroup(p=>p.source==='cad');
  const exporter=new STLExporter();
  const data=exporter.parse(group,{binary:true});
  saveBlob(new Blob([data],{type:'model/stl'}), 'oka-cad-' + new Date().toISOString().replace(/[:.]/g,'-') + '.stl');
  setStatus('STLを保存しました','ok');
}

$('addBoxBtn').addEventListener('click',()=>addCadPart('box'));
$('addCylinderBtn').addEventListener('click',()=>addCadPart('cylinder'));
$('applyPosBtn').addEventListener('click',applyCadPosition);
$('deleteCadBtn').addEventListener('click',deleteSelectedCad);
$('clearCadBtn').addEventListener('click',clearCadParts);
$('saveStlBtn').addEventListener('click',saveCadStl);

if(new URLSearchParams(location.search).has('ui-smoke')){
  window.__okaTest={
    state(){
      const part=(selectedIndex>=0&&parts[selectedIndex])?parts[selectedIndex]:null;
      let bounds=null,totalVertices=0;
      if(part){
        part.mesh.geometry.computeBoundingBox();
        const b=part.mesh.geometry.boundingBox;
        bounds={
          min:{x:b.min.x,y:b.min.y,z:b.min.z},
          max:{x:b.max.x,y:b.max.y,z:b.max.z}
        };
        totalVertices=part.mesh.geometry.getAttribute('position')?.count||0;
      }
      const cmd=editCursor>0?editHistory[editCursor-1]:null;
      return {
        selectionMode,selectedAxis,selectedPatch: selectedPatch?{...selectedPatch}:null,
        selectedIndex,editCursor,
        partSize:part?{x:partWorldSize(part).x,y:partWorldSize(part).y,z:partWorldSize(part).z}:null,
        bounds,totalVertices,
        lastCommand:cmd?{
          type:cmd.type,mode:cmd.mode,axis:cmd.axis,side:cmd.side,anchor:cmd.anchor,
          deltaWorldMm:cmd.deltaWorldMm,deltaLocalMm:cmd.deltaLocalMm,
          fromDimensionMm:cmd.fromDimensionMm,toDimensionMm:cmd.toDimensionMm,
          vertexCount:Array.from(cmd.vertexIndices||[]).length,
          moves:Array.isArray(cmd.moves)?cmd.moves.map(m=>({
            side:m.side,
            deltaLocalMm:m.deltaLocalMm,
            vertexCount:Array.from(m.vertexIndices||[]).length
          })):[],
          cuts:Array.isArray(cmd.cuts)?cmd.cuts.map(c=>({
            side:c.side,q:c.q,deltaLocal:c.deltaLocal
          })):[]
        }:null
      };
    },
    extremePatch(axis,side){
      const part=(selectedIndex>=0&&parts[selectedIndex])?parts[selectedIndex]:null;
      if(!part) return null;
      ensureDetailPatches(part);
      for(let i=0;i<(part.patches?.length||0);i++){
        if(patchAxisSide(part,part.patches[i],axis)===side) return i;
      }
      return null;
    },
    positions(){
      const part=(selectedIndex>=0&&parts[selectedIndex])?parts[selectedIndex]:null;
      const attr=part?.mesh?.geometry?.getAttribute('position');
      if(!attr) return [];
      const out=[];
      for(let i=0;i<attr.count;i++) out.push([attr.getX(i),attr.getY(i),attr.getZ(i)]);
      return out;
    },
    addRawTrianglePositions(flat,name='Raw Test'){
      if(!Array.isArray(flat)||flat.length<9||flat.length%9!==0) throw new Error('invalid raw triangle positions');
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(flat,3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material=new THREE.MeshStandardMaterial({
        color:0x69b7e8,roughness:.65,metalness:.04,side:THREE.DoubleSide
      });
      const mesh=new THREE.Mesh(geometry,material);
      mesh.name=name;
      mesh.userData.baseColor=material.color.getHex();
      modelGroup.add(mesh);
      const localBox=geometry.boundingBox.clone();
      const localSize=localBox.getSize(new THREE.Vector3());
      const triangles=triangleCountFor(geometry);
      parts.push({
        mesh,name,path:name,localBox,localSize,triangles,source:'cad',kind:'fixture',baseOffsetZ:0,
        brepFaces:[],patches:null,triToPatch:null,patchMode:null,patchAngle:null,
        basePosition:new Float32Array(geometry.getAttribute('position').array)
      });
      renderPartsList();
      recomputeModelStats(true);
      selectPart(parts.length-1,false);
      return parts.length-1;
    },
    addDenseFeaturePart(){
      const geometries=[];

      const base=new THREE.BoxGeometry(60,20,8,12,2,2);
      geometries.push(base.index?base.toNonIndexed():base);

      const leftBoss=new THREE.BoxGeometry(8,10,6,2,2,2);
      leftBoss.translate(-22,0,7);
      geometries.push(leftBoss.index?leftBoss.toNonIndexed():leftBoss);

      const rightBoss=new THREE.BoxGeometry(8,10,6,2,2,2);
      rightBoss.translate(22,0,7);
      geometries.push(rightBoss.index?rightBoss.toNonIndexed():rightBoss);

      const values=[];
      for(const g of geometries){
        const a=g.getAttribute('position').array;
        for(let i=0;i<a.length;i++) values.push(a[i]);
      }

      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(values,3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const material=new THREE.MeshStandardMaterial({
        color:0x69b7e8,roughness:.65,metalness:.04,side:THREE.DoubleSide
      });
      const mesh=new THREE.Mesh(geometry,material);
      const name='Dense End Feature Test';
      mesh.name=name;
      mesh.userData.baseColor=material.color.getHex();
      modelGroup.add(mesh);

      const localBox=geometry.boundingBox.clone();
      const localSize=localBox.getSize(new THREE.Vector3());
      const triangles=triangleCountFor(geometry);
      parts.push({
        mesh,name,path:name,localBox,localSize,triangles,source:'cad',kind:'test',baseOffsetZ:0,
        brepFaces:[],patches:null,triToPatch:null,patchMode:null,patchAngle:null,
        basePosition:new Float32Array(geometry.getAttribute('position').array)
      });
      renderPartsList();
      recomputeModelStats(true);
      selectPart(parts.length-1,false);
      return parts.length-1;
    },
    addSteppedPart(){
      const shape=new THREE.Shape();
      shape.moveTo(-30,-10);
      shape.lineTo(30,-10);
      shape.lineTo(30,10);
      shape.lineTo(12,10);
      shape.lineTo(12,20);
      shape.lineTo(-6,20);
      shape.lineTo(-6,10);
      shape.lineTo(-30,10);
      shape.closePath();
      const hole=new THREE.Path();
      hole.absellipse(22,0,3,3,0,Math.PI*2,false,0);
      shape.holes.push(hole);
      const geometry=new THREE.ExtrudeGeometry(shape,{depth:8,steps:1,bevelEnabled:false,curveSegments:16});
      geometry.translate(0,0,-4);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material=new THREE.MeshStandardMaterial({
        color:0x69b7e8,roughness:.65,metalness:.04,side:THREE.DoubleSide
      });
      const mesh=new THREE.Mesh(geometry,material);
      const name='Stepped Hole Test';
      mesh.name=name;
      mesh.userData.baseColor=material.color.getHex();
      modelGroup.add(mesh);
      const localBox=geometry.boundingBox.clone();
      const localSize=localBox.getSize(new THREE.Vector3());
      const triangles=triangleCountFor(geometry);
      parts.push({
        mesh,name,path:name,localBox,localSize,triangles,source:'cad',kind:'test',baseOffsetZ:0,
        brepFaces:[],patches:null,triToPatch:null,patchMode:null,patchAngle:null,
        basePosition:new Float32Array(geometry.getAttribute('position').array)
      });
      renderPartsList();
      recomputeModelStats(true);
      selectPart(parts.length-1,false);
      return parts.length-1;
    }
  };
}

setModelButtons(false);
setSelectedButtons(false);
updateDimensionButtons();
setSelectionMode('part');
updateEditHistoryUI();
resetEditConfirmation();
updateAxisPanel();
resize();
