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

  await page.waitForSelector('#faceModeBtn');

  // Model-less UI regression test: enable only controls needed for state transitions.
  await page.evaluate(() => {
    document.querySelector('#faceModeBtn').disabled = false;
    document.querySelector('#partModeBtn').disabled = false;
    document.querySelector('#axisZCard').disabled = false;
  });

  await page.click('#faceModeBtn');
  if (!(await page.locator('#faceModeBtn').evaluate(el => el.classList.contains('active')))) {
    throw new Error('詳細面モードへ切り替わらない');
  }

  await page.click('#axisZCard');

  const faceActive = await page.locator('#faceModeBtn').evaluate(el => el.classList.contains('active'));
  const partActive = await page.locator('#partModeBtn').evaluate(el => el.classList.contains('active'));
  const badge = (await page.locator('#axisEditBadge').innerText()).trim();

  if (!faceActive) throw new Error('Z軸タップで詳細面モードが解除された');
  if (partActive) throw new Error('Z軸タップで部品モードへ勝手に切り替わった');
  if (!badge.includes('Z')) throw new Error('Z軸選択状態が表示されない');

  // Tapping detail mode again must clear the temporary axis overlay state.
  await page.click('#faceModeBtn');
  const badgeAfter = (await page.locator('#axisEditBadge').innerText()).trim();
  if (!badgeAfter.includes('未選択')) {
    throw new Error('詳細面モードへ戻しても軸選択が解除されない');
  }

  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  console.log('UI_SMOKE_PASS: 詳細面 → Z軸 → 詳細面保持 / 軸解除 OK');
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
