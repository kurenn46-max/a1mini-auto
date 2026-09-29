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

  // Build a real CAD part in the app so we can exercise the actual Three.js UI state.
  await page.click('#addBoxBtn');
  await page.waitForFunction(() => document.querySelector('#partCount')?.textContent === '1');

  // Enter detailed-face mode.
  await page.click('#faceModeBtn');
  if (!(await page.locator('#faceModeBtn').evaluate(el => el.classList.contains('active')))) {
    throw new Error('詳細面モードへ切り替わらない');
  }

  // Select an actual face from the list so face dimensions/highlight exist.
  await page.waitForSelector('.faceRow');
  await page.locator('.faceRow').first().click();
  await page.waitForTimeout(100);

  const beforeTexts = await page.locator('.dimensionLabel').allInnerTexts();
  if (!beforeTexts.length) throw new Error('詳細面選択後に寸法表示が出ていない');

  const selectedFaceBefore = await page.locator('.faceRow.selected').count();
  if (!selectedFaceBefore) throw new Error('詳細面が選択状態になっていない');

  // Tap Z axis. Requirement: add ONLY +/- signs. Do not change mode, face selection, or dimension labels.
  await page.click('#axisZCard');
  await page.waitForTimeout(100);

  const faceActive = await page.locator('#faceModeBtn').evaluate(el => el.classList.contains('active'));
  const partActive = await page.locator('#partModeBtn').evaluate(el => el.classList.contains('active'));
  const zActive = await page.locator('#axisZCard').evaluate(el => el.classList.contains('active'));
  const afterTexts = await page.locator('.dimensionLabel').allInnerTexts();
  const selectedFaceAfter = await page.locator('.faceRow.selected').count();

  if (!faceActive) throw new Error('Z軸タップで詳細面モードが解除された');
  if (partActive) throw new Error('Z軸タップで部品モードへ勝手に切り替わった');
  if (!zActive) throw new Error('Z軸カードが選択状態にならない');
  if (!selectedFaceAfter) throw new Error('Z軸タップで詳細面の選択が消えた');

  if (JSON.stringify(beforeTexts) !== JSON.stringify(afterTexts)) {
    throw new Error('Z軸タップで既存の詳細面寸法表示が変わった: ' +
      JSON.stringify(beforeTexts) + ' -> ' + JSON.stringify(afterTexts));
  }

  const plus = (await page.locator('.axisSignLabel.plus').innerText()).trim();
  const minus = (await page.locator('.axisSignLabel.minus').innerText()).trim();
  if (plus !== '＋Z' || minus !== '−Z') {
    throw new Error('±Z表示が不正: ' + minus + ' / ' + plus);
  }

  // Undo control must still exist; this was one of the regressions the user noticed earlier.
  if (!(await page.locator('#axisUndoBtn').count()) || !(await page.locator('#undoBtn').count())) {
    throw new Error('戻るボタンが欠落している');
  }

  if (errors.length) throw new Error(errors.join('\n'));

  console.log('UI_SMOKE_PASS: 第2起点動作維持 + 詳細面/寸法そのまま + ±Zだけ追加 + 戻るボタン維持');
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
