import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

function setStatus(text, type = 'idle') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + type;
}

function setLoading(show, text = '読み込み中…') {
  $('loading').classList.toggle('hidden', !show);
  $('loadingText').textContent = text;
}

function resize() {
  const r = viewer.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
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
}
animate();

function flatArray(value) {
  if (!value) return [];
  const arr = ArrayBuffer.isView(value) ? Array.from(value) : value;
  if (Array.isArray(arr) && Array.isArray(arr[0])) return arr.flat();
  return Array.isArray(arr) ? arr : Array.from(arr);
}

function formatMm(v) {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(1);
  if (a >= 100) return v.toFixed(2);
  if (a >= 10) return v.toFixed(2);
  return v.toFixed(3);
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

function collectNodeNames(root) {
  const names = new Map();
  function walk(node, path = []) {
    if (!node) return;
    const nodeName = safeName(node.name, '');
    const nextPath = nodeName ? [...path, nodeName] : path;
    const label = nextPath.length ? nextPath[nextPath.length - 1] : '';
    for (const idx of node.meshes || []) {
      if (!names.has(idx) && label) names.set(idx, label);
    }
    for (const child of node.children || []) walk(child, nextPath);
  }
  walk(root);
  return names;
}

function disposeModel() {
  clearMeasurement();
  for (const part of parts) {
    modelGroup.remove(part.mesh);
    part.mesh.geometry.dispose();
    part.mesh.material.dispose();
  }
  parts = [];
  selectedIndex = -1;
  modelBox.makeEmpty();
  modelSize.set(0, 0, 0);
  $('partsList').innerHTML = '<div class="empty">STEPを開くとここに部品が並びます</div>';
  $('partCount').textContent = '—';
  $('sizeX').textContent = '—';
  $('sizeY').textContent = '—';
  $('sizeZ').textContent = '—';
  $('selectedName').textContent = '未選択';
  $('selectedDims').textContent = '—';
  updateVisibleCount();
  setModelButtons(false);
  setSelectedButtons(false);
}

function setModelButtons(enabled) {
  ['fitBtn','isoBtn','frontBtn','topBtn','rightBtn','measureBtn','clearMeasureBtn','showAllBtn','wireBtn']
    .forEach(id => $(id).disabled = !enabled);
}

function setSelectedButtons(enabled) {
  ['isolateBtn','hideBtn'].forEach(id => $(id).disabled = !enabled);
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
  const nodeNames = collectNodeNames(result.root);
  const duplicateCount = new Map();

  (result.meshes || []).forEach((meshData, i) => {
    const geometry = createGeometry(meshData);
    if (!geometry) return;

    const baseName = safeName(nodeNames.get(i) || meshData.name, 'Part ' + (i + 1));
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

    parts.push({ mesh, name, localBox, localSize, triangles });
  });

  if (!parts.length) throw new Error('STEP内に表示できる形状が見つかりませんでした。');

  modelBox.setFromObject(modelGroup);
  modelSize = modelBox.getSize(new THREE.Vector3());

  $('sizeX').textContent = formatMm(modelSize.x);
  $('sizeY').textContent = formatMm(modelSize.y);
  $('sizeZ').textContent = formatMm(modelSize.z);
  $('partCount').textContent = String(parts.length);

  renderPartsList();
  updateVisibleCount();
  setModelButtons(true);
  setSelectedButtons(false);
  fitView('iso');
}

function renderPartsList() {
  const list = $('partsList');
  list.innerHTML = '';

  parts.forEach((part, index) => {
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
      updateVisibleCount();
    });

    const nameWrap = document.createElement('div');
    nameWrap.className = 'partName';
    const strong = document.createElement('strong');
    strong.textContent = part.name;
    const small = document.createElement('small');
    small.textContent =
      formatMm(part.localSize.x) + ' × ' +
      formatMm(part.localSize.y) + ' × ' +
      formatMm(part.localSize.z) + ' mm';
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
    part.mesh.material.emissive.setHex(0x000000);
    part.mesh.material.emissiveIntensity = 0;
  }
  document.querySelectorAll('.partRow.selected').forEach(el => el.classList.remove('selected'));
}

function selectPart(index, scrollIntoView = false) {
  if (index < 0 || index >= parts.length) return;
  selectedIndex = index;
  clearSelectionHighlight();

  const part = parts[index];
  part.mesh.material.emissive.setHex(0x168fd2);
  part.mesh.material.emissiveIntensity = 0.35;

  const row = document.querySelector('.partRow[data-index="' + index + '"]');
  if (row) {
    row.classList.add('selected');
    if (scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  $('selectedName').textContent = part.name;
  $('selectedDims').innerHTML =
    'X ' + formatMm(part.localSize.x) + ' mm<br>' +
    'Y ' + formatMm(part.localSize.y) + ' mm<br>' +
    'Z ' + formatMm(part.localSize.z) + ' mm';
  setSelectedButtons(true);
}

function fitView(mode = 'iso') {
  if (!parts.length || modelBox.isEmpty()) return;

  modelBox.setFromObject(modelGroup);
  const center = modelBox.getCenter(new THREE.Vector3());
  const size = modelBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.45;

  let dir;
  if (mode === 'front') dir = new THREE.Vector3(0, -1, 0);
  else if (mode === 'right') dir = new THREE.Vector3(1, 0, 0);
  else if (mode === 'top') dir = new THREE.Vector3(0, 0, 1);
  else dir = new THREE.Vector3(1, -1, 0.78).normalize();

  camera.up.set(0, 0, 1);
  if (mode === 'top') camera.up.set(0, 1, 0);

  camera.near = Math.max(maxDim / 10000, 0.001);
  camera.far = Math.max(maxDim * 1000, 1000);
  camera.updateProjectionMatrix();

  camera.position.copy(center).addScaledVector(dir, dist);
  controls.target.copy(center);
  controls.update();
}

function showAll() {
  for (const part of parts) part.mesh.visible = true;
  document.querySelectorAll('.partRow').forEach(row => row.style.opacity = '1');
  document.querySelectorAll('.eyeBtn').forEach(btn => btn.textContent = '👁');
  updateVisibleCount();
}

function isolateSelected() {
  if (selectedIndex < 0) return;
  parts.forEach((part, i) => part.mesh.visible = i === selectedIndex);
  document.querySelectorAll('.partRow').forEach((row, i) => {
    row.style.opacity = i === selectedIndex ? '1' : '.55';
    row.querySelector('.eyeBtn').textContent = i === selectedIndex ? '👁' : '—';
  });
  updateVisibleCount();
  fitVisible();
}

function fitVisible() {
  const box = new THREE.Box3();
  let hasVisible = false;
  for (const part of parts) {
    if (!part.mesh.visible) continue;
    box.expandByObject(part.mesh);
    hasVisible = true;
  }
  if (!hasVisible) return;
  const original = modelBox.clone();
  modelBox.copy(box);
  fitView('iso');
  modelBox.copy(original);
}

function hideSelected() {
  if (selectedIndex < 0) return;
  parts[selectedIndex].mesh.visible = false;
  const row = document.querySelector('.partRow[data-index="' + selectedIndex + '"]');
  if (row) {
    row.style.opacity = '.55';
    row.querySelector('.eyeBtn').textContent = '—';
  }
  updateVisibleCount();
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

function clearMeasurement() {
  measureMode = false;
  measurePoints = [];
  while (measureGroup.children.length) {
    const obj = measureGroup.children.pop();
    obj.geometry?.dispose?.();
    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
    else obj.material?.dispose?.();
  }
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
  const s = modelBox.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z, 1);
}

function addMeasureMarker(point) {
  const radius = modelScale() / 120;
  const g = new THREE.SphereGeometry(radius, 18, 12);
  const m = new THREE.MeshBasicMaterial({ color: 0xffc857, depthTest: false });
  const dot = new THREE.Mesh(g, m);
  dot.position.copy(point);
  dot.renderOrder = 20;
  measureGroup.add(dot);
}

function finishMeasurement(a, b) {
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
  const material = new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 19;
  measureGroup.add(line);

  const distance = a.distanceTo(b);
  $('measureHud').textContent = '距離 ' + formatMm(distance) + ' mm';
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
  if (Number.isInteger(idx)) selectPart(idx, true);
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
  setLoading(true, 'STEPエンジンを準備中…');

  try {
    const occt = await getOcct();
    setLoading(true, 'STEPを解析中… 大きいファイルは少し待ってください');
    await new Promise(resolve => setTimeout(resolve, 40));

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = occt.ReadStepFile(bytes, {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.003,
      angularDeflection: 0.5
    });

    if (!result?.success) throw new Error('STEPの解析に失敗しました。');

    setLoading(true, '3D表示を作成中…');
    await new Promise(resolve => setTimeout(resolve, 30));
    buildModel(result);

    setStatus('表示完了', 'ok');
    $('fileInfo').textContent =
      file.name + ' ・ ' + formatBytes(file.size) + ' ・ ' + parts.length + '部品';
  } catch (err) {
    console.error(err);
    disposeModel();
    setStatus('読込失敗', 'error');
    const msg = err?.message || String(err);
    $('fileInfo').textContent = 'エラー: ' + msg;
  } finally {
    setLoading(false);
  }
});

$('fitBtn').addEventListener('click', () => fitView('iso'));
$('isoBtn').addEventListener('click', () => fitView('iso'));
$('frontBtn').addEventListener('click', () => fitView('front'));
$('topBtn').addEventListener('click', () => fitView('top'));
$('rightBtn').addEventListener('click', () => fitView('right'));
$('measureBtn').addEventListener('click', startMeasurement);
$('clearMeasureBtn').addEventListener('click', clearMeasurement);
$('showAllBtn').addEventListener('click', () => { showAll(); fitView('iso'); });
$('isolateBtn').addEventListener('click', isolateSelected);
$('hideBtn').addEventListener('click', hideSelected);
$('wireBtn').addEventListener('click', toggleWireframe);
$('gridBtn').addEventListener('click', toggleGrid);

setModelButtons(false);
setSelectedButtons(false);
resize();