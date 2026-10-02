const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const mockSupabase = `
    (() => {
      function makeQuery(table) {
        const q = {
          select(){ return q; },
          eq(){ return q; },
          gte(){ return q; },
          lt(){ return q; },
          order(){ return q; },
          is(){ return q; },
          update(){ return q; },
          delete(){ return q; },
          insert(){ return q; },
          maybeSingle(){
            if (table === 'allowed_users') {
              const guest = location.search.includes('role=guest');
              return Promise.resolve({ data: {
                user_id: guest ? 'guest-user' : 'host-user',
                display_name: guest ? 'ゲスト' : 'ホスト',
                slot: guest ? 2 : 1,
                pair_id: 'pair-1'
              }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          single(){ return Promise.resolve({ data: { id: 'event-1' }, error: null }); },
          then(resolve){ resolve({ data: [], error: null }); }
        };
        return q;
      }
      window.supabase = {
        createClient() {
          return {
            auth: {
              getSession() {
                const guest = location.search.includes('role=guest');
                return Promise.resolve({ data: { session: {
                  user: { id: guest ? 'guest-user' : 'host-user' },
                  access_token: guest ? 'guest-token' : 'host-token'
                } }, error: null });
              },
              onAuthStateChange(){ return { data: { subscription: { unsubscribe(){} } } }; },
              signOut(){ window.__signedOut = true; return Promise.resolve({ error: null }); },
              signInWithPassword(){ return Promise.resolve({ data: {}, error: null }); }
            },
            from(table){ return makeQuery(table); }
          };
        }
      };
    })();
  `;

  await page.route('https://cdn.jsdelivr.net/**', route => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: mockSupabase });
  });

  let guestPresent = true;
  await page.route('https://zungfgnlylvtdclehcwt.supabase.co/functions/v1/futari-calendar-manage', async route => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    const isGuest = page.url().includes('role=guest');
    let result = {};

    if (body.action === 'status') {
      result = isGuest
        ? { role: 'guest', pairId: 'pair-1', pairActive: true, guestPresent: true }
        : { role: 'host', pairId: 'pair-1', pairActive: true, guestPresent, guestEmail: guestPresent ? 'guest@example.com' : null };
    } else if (body.action === 'host_remove_guest') {
      guestPresent = false;
      result = { ok: true, pairId: 'pair-1' };
    } else if (body.action === 'host_dissolve') {
      result = { ok: true, oldPairId: 'pair-1', newPairId: 'pair-2' };
    } else if (body.action === 'guest_leave') {
      result = { ok: true, pairId: 'pair-1' };
    } else {
      result = { ok: true };
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });

  async function noHorizontalOverflow() {
    return await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  }

  // Host
  await page.goto('http://127.0.0.1:8000/futari-calendar/?role=host', { waitUntil: 'networkidle' });
  await page.waitForSelector('#appView:not(.hidden)');
  assert.strictEqual(await page.isVisible('#inviteBtn'), true, 'host invite button should be visible');
  assert.strictEqual(await page.isVisible('#pairManageBtn'), true, 'pair manage button should be visible');
  assert.strictEqual(await noHorizontalOverflow(), true, 'host view should not overflow horizontally');

  await page.click('#pairManageBtn');
  await page.waitForSelector('#pairSheet:not(.hidden)');
  await page.waitForFunction(() => document.querySelector('#pairRole')?.textContent === 'ホスト');
  assert.strictEqual(await page.isVisible('#hostPairControls'), true, 'host controls should be visible');
  assert.strictEqual(await page.isVisible('#guestPairControls'), false, 'guest controls should be hidden for host');
  assert.strictEqual(await page.isVisible('#removeGuestBtn'), true, 'remove guest should be available');

  page.once('dialog', d => d.accept());
  await page.click('#removeGuestBtn');
  await page.waitForFunction(() => document.querySelector('#pairStatus')?.textContent.includes('現在ゲストはいません'));

  page.once('dialog', d => d.accept());
  await page.click('#dissolvePairBtn');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('ペアを解散'));

  // Guest
  await page.goto('http://127.0.0.1:8000/futari-calendar/?role=guest', { waitUntil: 'networkidle' });
  await page.waitForSelector('#appView:not(.hidden)');
  assert.strictEqual(await page.isVisible('#inviteBtn'), false, 'guest invite button should be hidden');
  assert.strictEqual(await noHorizontalOverflow(), true, 'guest view should not overflow horizontally');

  await page.click('#pairManageBtn');
  await page.waitForFunction(() => document.querySelector('#pairRole')?.textContent === 'ゲスト');
  assert.strictEqual(await page.isVisible('#hostPairControls'), false, 'host controls should be hidden for guest');
  assert.strictEqual(await page.isVisible('#guestPairControls'), true, 'guest controls should be visible');

  page.once('dialog', d => d.accept());
  await page.click('#guestLeaveBtn');
  await page.waitForSelector('#loginView:not(.hidden)');
  assert.ok((await page.textContent('#loginMsg')).includes('退出'), 'guest leave should return to login with message');

  assert.deepStrictEqual(errors, [], 'page should have no JS errors');
  console.log('FUTARI_CALENDAR_UI_SMOKE_OK');
  await browser.close();
})().catch(async err => {
  console.error(err);
  process.exit(1);
});