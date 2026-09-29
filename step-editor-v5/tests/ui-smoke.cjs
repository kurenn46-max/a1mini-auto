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

  // Build a real 40 x 30 x 10 CAD part inside the app.
  await page.click('#addBoxBtn');
  await page.waitForFunction(() => document.querySelector('#partCount')?.textContent === '1');

  // Enter detailed-face mode first.
  await page.click('#faceModeBtn');
  if (!(await page.locator('#faceModeBtn').evaluate(el => el.classList.contains('active')))) {
    throw new Error('詳細面モードへ切り替わらない');
  }

  // Select Z axis. This must NOT change the selection mode.
  await page.click('#axisZCard');

  const faceActive = await page.locator('#faceModeBtn').evaluate(el => el.classList.contains('active'));
  const partActive = await page.locator('#partModeBtn').evaluate(el => el.classList.contains('active'));
  const zActive = await page.locator('#axisZCard').evaluate(el => el.classList.contains('active'));
  const badge = (await page.locator('#axisEditBadge').innerText()).trim();

  if (!faceActive) throw new Error('Z軸タップで詳細面モードが解除された');
  if (partActive) throw new Error('Z軸タップで部品モードへ勝手に切り替わった');
  if (!zActive || !badge.includes('Z')) throw new Error('Z軸選択状態が表示されない');

  // Axis overlay must show only selected Z dimension, not X/Y.
  const zDim = (await page.locator('.dimensionLabel.axisZ').innerText()).trim();
  if (!zDim.includes('Z 10')) throw new Error('Z全体寸法が10mmとして表示されない: ' + zDim);
  if (await page.locator('.dimensionLabel.axisX').count()) throw new Error('Z軸選択中にX寸法が残っている');
  if (await page.locator('.dimensionLabel.axisY').count()) throw new Error('Z軸選択中にY寸法が残っている');

  const plus = (await page.locator('.axisSignLabel.plus').innerText()).trim();
  const minus = (await page.locator('.axisSignLabel.minus').innerText()).trim();
  if (plus !== '＋Z' || minus !== '−Z') {
    throw new Error('±Z表示が不正: ' + minus + ' / ' + plus);
  }

  // Explicitly choosing detail mode again clears the temporary axis overlay.
  await page.click('#faceModeBtn');
  if (await page.locator('.axisSignLabel').count()) {
    throw new Error('詳細面モードを選び直しても±軸表示が残る');
  }
  if (await page.locator('#axisZCard').evaluate(el => el.classList.contains('active'))) {
    throw new Error('詳細面モードを選び直してもZ軸選択が残る');
  }

  if (errors.length) throw new Error(errors.join('\n'));

  console.log('UI_SMOKE_PASS: CAD作成 → 詳細面 → Z軸 overlay → 詳細面維持 / Z寸法のみ / ±Z / 軸解除 OK');
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
