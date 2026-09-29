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
}

function disposeModel() {
  clearMeasurement();
  clearPartDimensions();
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
  updateVisibleCount();
  setModelButtons(false);
  setSelectedButtons(false);
}

function setModelButtons(enabled) {
  [
    'fitBtn','isoBtn','frontBtn','rightBtn','backBtn','leftBtn','topBtn','bottomBtn',
    'modelDimBtn','measureBtn','clearMeasureBtn','unitBtn','saveGlbBtn',
    'showAllBtn','wireBtn'
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
      mesh, name, path: info.path || name, localBox, localSize, triangles, source:'step'
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
      formatLengthValue(size.z) + ' ' + unitName();
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

  const isCad = part.source === 'cad';
  $('applyPosBtn').disabled = !isCad;
  $('deleteCadBtn').disabled = !isCad;
  if (isCad) {
    $('posX').value = Number(part.mesh.position.x.toFixed(3));
    $('posY').value = Number(part.mesh.position.y.toFixed(3));
    const baseZ = Number(part.baseOffsetZ || 0);
    $('posZ').value = Number((part.mesh.position.z - baseZ).toFixed(3));
  }

  if (selectedDimsOn && part.mesh.visible) {
    showBoxDimensions(new THREE.Box3().setFromObject(part.mesh), 'part');
  } else {
    clearPartDimensions();
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
});

renderer.domElement.addEventListener('pointerup', (e) => {
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
  if (Number.isInteger(idx)) selectPart(idx, true, hits[0].point);
});

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
    setStatus('表示完了・部品をタップ', 'ok');
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
      mesh,name,path:name,localBox,localSize,triangles,source:'cad',kind,baseOffsetZ
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

setModelButtons(false);
setSelectedButtons(false);
updateDimensionButtons();
resize();
