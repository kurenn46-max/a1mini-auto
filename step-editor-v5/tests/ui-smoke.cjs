const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  const errors = [];

  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });

  await page.goto('http://127.0.0.1:8000/step-editor-v5/?ui-smoke=1', {
    waitUntil: 'networkidle',
    timeout: 90000
  });

  await page.waitForSelector('#addBoxBtn');

  // Real app geometry: 40 x 30 x 10 mm.
  await page.click('#addBoxBtn');
  await page.waitForFunction(() => document.querySelector('#partCount')?.textContent === '1');

  let st = await page.evaluate(() => window.__okaTest.state());
  if (Math.abs(st.partSize.z - 10) > 0.001) throw new Error('初期Z寸法が10mmではない');
  const initialMinZ = st.bounds.min.z;
  const initialMaxZ = st.bounds.max.z;

  // Use actual detailed-face data to choose the +Z end face.
  await page.click('#faceModeBtn');
  const patchIndex = await page.evaluate(() => window.__okaTest.extremePatch('z','max'));
  if (patchIndex == null) throw new Error('+Z端面を検出できない');

  await page.locator('.faceRow[data-face-index="' + patchIndex + '"]').click();
  await page.waitForTimeout(100);

  // Selecting Z must not switch out of detailed-face mode.
  await page.click('#axisZCard');
  await page.waitForTimeout(100);

  const faceActive = await page.locator('#faceModeBtn').evaluate(el => el.classList.contains('active'));
  const partActive = await page.locator('#partModeBtn').evaluate(el => el.classList.contains('active'));
  if (!faceActive || partActive) throw new Error('Z軸選択で詳細面モードが変わった');

  // +Z face is moving, therefore -Z side must be fixed automatically.
  if (!(await page.locator('#anchorMinBtn').evaluate(el => el.classList.contains('active')))) {
    throw new Error('+Z端面選択時に−Z側固定が自動選択されない');
  }
  if (!(await page.locator('#anchorCenterBtn').isDisabled())) {
    throw new Error('Move Face中に中心固定が無効化されていない');
  }

  const plus = (await page.locator('.axisSignLabel.plus').innerText()).trim();
  const minus = (await page.locator('.axisSignLabel.minus').innerText()).trim();
  if (plus !== '＋Z' || minus !== '−Z') throw new Error('±Z表示が不正');

  // Change overall Z from 10 to 20. Only the selected +Z face may move.
  await page.locator('#axisTargetInput').fill('20');
  await page.click('#applyAxisTargetBtn');
  await page.waitForTimeout(150);

  st = await page.evaluate(() => window.__okaTest.state());
  if (Math.abs(st.partSize.z - 20) > 0.001) {
    throw new Error('Move Face後のZ寸法が20mmではない: ' + st.partSize.z);
  }
  if (Math.abs(st.bounds.min.z - initialMinZ) > 0.001) {
    throw new Error('固定した−Z端が動いた: ' + initialMinZ + ' -> ' + st.bounds.min.z);
  }
  if (Math.abs(st.bounds.max.z - (initialMaxZ + 10)) > 0.001) {
    throw new Error('選択した＋Z端が10mm移動していない');
  }

  const cmd = st.lastCommand;
  if (!cmd || cmd.type !== 'axisDimension' || cmd.mode !== 'move-face') {
    throw new Error('軸編集がMove Faceコマンドになっていない');
  }
  if (!(cmd.vertexCount > 0 && cmd.vertexCount < st.totalVertices)) {
    throw new Error('選択面だけでなく全頂点を編集している疑い: ' +
      cmd.vertexCount + '/' + st.totalVertices);
  }
  if (Math.abs(cmd.deltaWorldMm - 10) > 0.001) {
    throw new Error('面移動量が10mmではない');
  }

  // Undo must restore exact original dimension and fixed boundary.
  await page.click('#axisUndoBtn');
  await page.waitForTimeout(120);
  st = await page.evaluate(() => window.__okaTest.state());
  if (Math.abs(st.partSize.z - 10) > 0.001 ||
      Math.abs(st.bounds.min.z - initialMinZ) > 0.001 ||
      Math.abs(st.bounds.max.z - initialMaxZ) > 0.001) {
    throw new Error('戻るで元形状に復元できない');
  }

  if (errors.length) throw new Error(errors.join('\n'));

  console.log('GEOMETRY_TEST_PASS: Move Face / 固定端不動 / 選択面頂点のみ / Z10→20 / Undo復元 OK');
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
