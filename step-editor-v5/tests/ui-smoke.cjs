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
  await page.click('#addBoxBtn');
  await page.waitForFunction(() => document.querySelector('#partCount')?.textContent === '1');

  const initial = await page.evaluate(() => window.__okaTest.state());
  if (Math.abs(initial.partSize.x-40)>0.001 || Math.abs(initial.partSize.y-30)>0.001 || Math.abs(initial.partSize.z-10)>0.001) {
    throw new Error('初期箱寸法が40x30x10ではない');
  }

  // Axis select alone must enable controls. No detailed face required.
  await page.click('#axisZCard');
  if (await page.locator('#applyAxisTargetBtn').isDisabled()) {
    throw new Error('Z軸選択だけで寸法確定ボタンが有効にならない');
  }
  if (await page.locator('#anchorMinBtn').isDisabled() ||
      await page.locator('#anchorCenterBtn').isDisabled() ||
      await page.locator('#anchorMaxBtn').isDisabled()) {
    throw new Error('固定方法ボタンが無効のまま');
  }

  async function state(){ return await page.evaluate(() => window.__okaTest.state()); }
  async function setTarget(mm){
    await page.locator('#axisTargetInput').fill(String(mm));
    await page.click('#applyAxisTargetBtn');
    await page.waitForTimeout(120);
  }
  async function undo(){
    await page.click('#axisUndoBtn');
    await page.waitForTimeout(100);
  }

  // Case 1: -Z fixed, +Z moves.
  await page.click('#anchorMinBtn');
  await setTarget(20);
  let st = await state();
  if (Math.abs(st.partSize.z-20)>0.001) throw new Error('−Z固定でZ20にならない');
  if (Math.abs(st.partSize.x-40)>0.001 || Math.abs(st.partSize.y-30)>0.001) {
    throw new Error('Z編集でX/Y寸法が変わった');
  }
  if (Math.abs(st.bounds.min.z-initial.bounds.min.z)>0.001) {
    throw new Error('−Z固定なのに−Z端が動いた');
  }
  if (Math.abs(st.bounds.max.z-(initial.bounds.max.z+10))>0.001) {
    throw new Error('＋Z端が10mm動いていない');
  }
  if (st.lastCommand?.mode !== 'move-end-plane' || st.lastCommand?.moves?.length !== 1 ||
      st.lastCommand.moves[0].side !== 'max') {
    throw new Error('−Z固定が＋Z端面移動コマンドになっていない');
  }
  const moved1 = st.lastCommand.moves[0].vertexCount;
  if (!(moved1 > 0 && moved1 < st.totalVertices)) {
    throw new Error('−Z固定で全頂点を動かしている疑い');
  }
  await undo();

  // Case 2: +Z fixed, -Z moves.
  await page.click('#anchorMaxBtn');
  await setTarget(20);
  st = await state();
  if (Math.abs(st.partSize.z-20)>0.001) throw new Error('＋Z固定でZ20にならない');
  if (Math.abs(st.bounds.max.z-initial.bounds.max.z)>0.001) {
    throw new Error('＋Z固定なのに＋Z端が動いた');
  }
  if (Math.abs(st.bounds.min.z-(initial.bounds.min.z-10))>0.001) {
    throw new Error('−Z端が10mm動いていない');
  }
  if (st.lastCommand?.moves?.length !== 1 || st.lastCommand.moves[0].side !== 'min') {
    throw new Error('＋Z固定が−Z端面移動コマンドになっていない');
  }
  await undo();

  // Case 3: center fixed, both ends move half.
  await page.click('#anchorCenterBtn');
  await setTarget(20);
  st = await state();
  if (Math.abs(st.partSize.z-20)>0.001) throw new Error('中心固定でZ20にならない: '+JSON.stringify(st));
  if (Math.abs(st.bounds.min.z-(initial.bounds.min.z-5))>0.001 ||
      Math.abs(st.bounds.max.z-(initial.bounds.max.z+5))>0.001) {
    throw new Error('中心固定で両端が5mmずつ動いていない');
  }
  if (st.lastCommand?.moves?.length !== 2) {
    throw new Error('中心固定が両端2面移動になっていない');
  }
  const movedTotal = st.lastCommand.moves.reduce((n,m)=>n+m.vertexCount,0);
  if (!(movedTotal > 0 && movedTotal < st.totalVertices)) {
    throw new Error('中心固定で全頂点を動かしている疑い');
  }
  await undo();

  // Undo restores original exactly.
  st = await state();
  if (Math.abs(st.partSize.x-40)>0.001 || Math.abs(st.partSize.y-30)>0.001 || Math.abs(st.partSize.z-10)>0.001 ||
      Math.abs(st.bounds.min.z-initial.bounds.min.z)>0.001 ||
      Math.abs(st.bounds.max.z-initial.bounds.max.z)>0.001) {
    throw new Error('Undoで元形状へ戻っていない');
  }

  // Sign overlay must still work.
  const plus = (await page.locator('.axisSignLabel.plus').innerText()).trim();
  const minus = (await page.locator('.axisSignLabel.minus').innerText()).trim();
  if (plus !== '＋Z' || minus !== '−Z') throw new Error('±Z表示が不正');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('GEOMETRY_TEST_PASS: face不要 / 3固定方式 / end-plane only / XY不変 / Undo復元 / ±Z OK');
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
