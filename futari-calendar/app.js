(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const cfg = window.APP_CONFIG || {};
  const supabaseLib = window.supabase;
  const client = supabaseLib?.createClient?.(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const loginView = $('#loginView');
  const appView = $('#appView');
  const grid = $('#calendarGrid');
  const monthTitle = $('#monthTitle');
  const sheet = $('#eventSheet');
  const backdrop = $('#sheetBackdrop');
  const inviteSheet = $('#inviteSheet');
  const inviteBackdrop = $('#inviteBackdrop');
  const pairSheet = $('#pairSheet');
  const pairBackdrop = $('#pairBackdrop');

  let current = new Date();
  current.setDate(1);
  let selectedDate = iso(new Date());
  let sessionUser = null;
  let allowedUser = null;
  let events = [];
  let refreshTimer = null;

  function iso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function dateFromIso(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function appUrl() {
    return location.href.split('#')[0].split('?')[0];
  }

  function registerApiUrl() {
    return cfg.REGISTER_API_URL || appUrl();
  }

  function manageApiUrl() {
    return cfg.MANAGE_API_URL || '';
  }

  function showToast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 1900);
  }

  function setLoginMsg(text) {
    $('#loginMsg').textContent = text || '';
  }

  async function loadAllowedUser() {
    if (!client || !sessionUser) {
      allowedUser = null;
      return 'missing';
    }

    const { data, error } = await client
      .from('allowed_users')
      .select('user_id,display_name,slot,pair_id')
      .eq('user_id', sessionUser.id)
      .maybeSingle();

    if (error) return 'error';
    if (!data) {
      allowedUser = null;
      return 'missing';
    }

    allowedUser = data;
    return 'ok';
  }

  async function manageCall(action, payload = {}) {
    if (!client || !manageApiUrl()) throw new Error('管理機能に接続できません。');

    const { data } = await client.auth.getSession();
    const session = data?.session;
    if (!session?.access_token) throw new Error('ログインが必要です。');

    const res = await fetch(manageApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': cfg.SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify({ action, ...payload })
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || '処理できませんでした。');
    return body;
  }

  async function init() {
    if (!client) {
      setLoginMsg('接続ライブラリを読み込めませんでした。通信状態を確認して。');
      return;
    }

    const { data, error } = await client.auth.getSession();
    if (!error && data.session) {
      sessionUser = data.session.user;
      const state = await loadAllowedUser();
      if (state === 'ok') return enterApp();
      await client.auth.signOut();
      sessionUser = null;
      allowedUser = null;
    }

    client.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user && appView.classList.contains('hidden')) {
        sessionUser = session.user;
        const state = await loadAllowedUser();
        if (state === 'ok') enterApp();
      }
    });
  }

  $('#loginBtn').onclick = async () => {
    const email = $('#email').value.trim().toLowerCase();
    const password = $('#password').value;

    if (!email || !password) {
      setLoginMsg('メールとパスワードを入力して。');
      return;
    }

    setLoginMsg('ログイン中…');
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error) {
      setLoginMsg('ログインできませんでした。メールかパスワードを確認して。');
      return;
    }

    sessionUser = data.user;
    const state = await loadAllowedUser();

    if (state !== 'ok') {
      await client.auth.signOut();
      sessionUser = null;
      allowedUser = null;
      setLoginMsg(state === 'missing'
        ? 'このメールは現在この共有カレンダーのメンバーではありません。'
        : 'メンバー情報を確認できませんでした。もう一度試して。');
      return;
    }

    await enterApp();
  };

  $('#signupBtn').onclick = async () => {
    const email = $('#email').value.trim().toLowerCase();
    const password = $('#password').value;
    const ownerCode = $('#ownerCode').value.trim();

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setLoginMsg('メールアドレスを確認して。');
      return;
    }

    if (password.length < 8) {
      setLoginMsg('パスワードは8文字以上にして。');
      return;
    }

    setLoginMsg('登録中…');

    try {
      const res = await fetch(registerApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register', email, password, ownerCode })
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLoginMsg(body.error || '登録できませんでした。');
        return;
      }

      const { data, error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        setLoginMsg('登録は完了しました。もう一度ログインして。');
        return;
      }

      sessionUser = data.user;
      const state = await loadAllowedUser();

      if (state !== 'ok') {
        await client.auth.signOut();
        sessionUser = null;
        allowedUser = null;
        setLoginMsg('利用登録を確認できませんでした。');
        return;
      }

      setLoginMsg('');
      await enterApp();
    } catch (_) {
      setLoginMsg('通信に失敗しました。もう一度試して。');
    }
  };

  async function enterApp() {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    $('#inviteBtn').classList.toggle('hidden', allowedUser?.slot !== 1);

    await loadMonth();
    render();

    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      if (document.hidden) return;

      const state = await loadAllowedUser();

      if (state === 'missing') {
        await leaveAppToLogin('共有カレンダーから退出しました。');
        return;
      }

      if (state === 'ok') {
        await loadMonth();
        render();
      }
    }, 30000);
  }

  async function leaveAppToLogin(message = '') {
    clearInterval(refreshTimer);
    closeSheet();
    closeInvite();
    closePair();

    try { await client.auth.signOut(); } catch (_) {}

    sessionUser = null;
    allowedUser = null;
    events = [];
    appView.classList.add('hidden');
    loginView.classList.remove('hidden');
    setLoginMsg(message);
  }

  async function logout() {
    await leaveAppToLogin('');
  }

  $('#logoutBtn').onclick = logout;
  $('#pairLogoutBtn').onclick = logout;

  async function loadMonth() {
    if (!client || !sessionUser) return;

    const start = new Date(current.getFullYear(), current.getMonth(), 1);
    const end = new Date(current.getFullYear(), current.getMonth() + 1, 1);

    const { data, error } = await client
      .from('calendar_events')
      .select('*')
      .gte('event_date', iso(start))
      .lt('event_date', iso(end))
      .order('event_date')
      .order('start_time', { ascending: true, nullsFirst: true });

    if (error) {
      showToast('予定の読み込みに失敗');
      return;
    }

    events = data || [];
  }

  function render() {
    monthTitle.textContent = `${current.getFullYear()}年${current.getMonth() + 1}月`;
    grid.innerHTML = '';

    const first = new Date(current.getFullYear(), current.getMonth(), 1);
    const mondayIndex = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayIndex);

    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);

      const id = iso(d);
      const cell = document.createElement('button');
      cell.className = 'day';
      cell.dataset.date = id;
      cell.type = 'button';

      if (d.getMonth() !== current.getMonth()) cell.classList.add('out');
      if (id === iso(new Date())) cell.classList.add('today');
      if (id === selectedDate) cell.classList.add('selected');

      const n = document.createElement('div');
      n.className = 'day-num';
      n.textContent = d.getDate();
      cell.appendChild(n);

      const list = events.filter((e) => e.event_date === id);

      list.slice(0, 3).forEach((e) => {
        const chip = document.createElement('div');
        const mine = e.owner_id === sessionUser?.id;
        chip.className = `event-chip ${mine ? 'mine' : 'partner'}`;
        chip.textContent = `${e.start_time ? String(e.start_time).slice(0, 5) + ' ' : ''}${e.title}`;
        chip.onclick = (ev) => {
          ev.stopPropagation();
          openSheet(id, e);
        };
        cell.appendChild(chip);
      });

      if (list.length > 3) {
        const more = document.createElement('div');
        more.className = 'more';
        more.textContent = `+${list.length - 3}件`;
        cell.appendChild(more);
      }

      cell.onclick = () => {
        selectedDate = id;
        openSheet(id);
        render();
      };

      grid.appendChild(cell);
    }
  }

  function setEventFormDisabled(disabled) {
    ['#eventTitle', '#startTime', '#endTime', '#eventMemo', '#allDay'].forEach((s) => {
      $(s).disabled = disabled;
    });
    $('#saveBtn').classList.toggle('hidden', disabled);
  }

  function openSheet(date, event = null) {
    selectedDate = date;
    const d = dateFromIso(date);

    $('#sheetDate').textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

    const mine = !event || event.owner_id === sessionUser?.id;

    $('#sheetTitle').textContent = event
      ? (mine ? '予定を編集' : '予定を確認')
      : '予定を追加';

    $('#eventTitle').value = event?.title || '';
    $('#startTime').value = event?.start_time?.slice(0, 5) || '';
    $('#endTime').value = event?.end_time?.slice(0, 5) || '';
    $('#eventMemo').value = event?.note || '';
    $('#allDay').checked = !event?.start_time;
    $('#editingId').value = event?.id || '';

    $('#deleteBtn').classList.toggle('hidden', !event || !mine);
    setEventFormDisabled(!mine);

    sheet.classList.remove('hidden');
    backdrop.classList.remove('hidden');

    if (mine) setTimeout(() => $('#eventTitle').focus(), 80);
  }

  function closeSheet() {
    sheet.classList.add('hidden');
    backdrop.classList.add('hidden');
    setEventFormDisabled(false);
  }

  $('#closeSheet').onclick = closeSheet;
  backdrop.onclick = closeSheet;

  $('#allDay').onchange = (e) => {
    if (e.target.checked) {
      $('#startTime').value = '';
      $('#endTime').value = '';
    }
  };

  $('#saveBtn').onclick = async () => {
    const title = $('#eventTitle').value.trim();

    if (!title) {
      showToast('予定名を入力して');
      return;
    }

    if (!allowedUser?.pair_id) {
      showToast('共有状態を確認できません');
      return;
    }

    const id = $('#editingId').value;

    const record = {
      event_date: selectedDate,
      title,
      start_time: $('#allDay').checked ? null : ($('#startTime').value || null),
      end_time: $('#allDay').checked ? null : ($('#endTime').value || null),
      note: $('#eventMemo').value.trim() || null
    };

    let res;

    if (id) {
      res = await client
        .from('calendar_events')
        .update(record)
        .eq('id', id)
        .eq('owner_id', sessionUser.id);
    } else {
      res = await client
        .from('calendar_events')
        .insert({
          ...record,
          owner_id: sessionUser.id,
          pair_id: allowedUser.pair_id,
          visibility: 'shared'
        });
    }

    if (res.error) {
      showToast('保存できませんでした');
      return;
    }

    closeSheet();
    await loadMonth();
    render();
    showToast('保存した');
  };

  $('#deleteBtn').onclick = async () => {
    const id = $('#editingId').value;
    if (!id) return;

    const { error } = await client
      .from('calendar_events')
      .delete()
      .eq('id', id)
      .eq('owner_id', sessionUser.id);

    if (error) {
      showToast('削除できませんでした');
      return;
    }

    closeSheet();
    await loadMonth();
    render();
    showToast('削除した');
  };

  async function changeMonth(delta) {
    current = new Date(current.getFullYear(), current.getMonth() + delta, 1);
    selectedDate = iso(current);
    await loadMonth();
    render();
  }

  $('#prevBtn').onclick = () => changeMonth(-1);
  $('#nextBtn').onclick = () => changeMonth(1);

  $('#todayBtn').onclick = async () => {
    const now = new Date();
    current = new Date(now.getFullYear(), now.getMonth(), 1);
    selectedDate = iso(now);
    await loadMonth();
    render();
  };

  $('#fab').onclick = () => openSheet(selectedDate || iso(new Date()));

  let sx = 0;
  let sy = 0;

  $('#swipeArea').addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    sx = t.clientX;
    sy = t.clientY;
  }, { passive: true });

  $('#swipeArea').addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;

    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      changeMonth(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  window.addEventListener('focus', async () => {
    if (!sessionUser) return;

    const state = await loadAllowedUser();

    if (state === 'missing') {
      await leaveAppToLogin('共有カレンダーから退出しました。');
      return;
    }

    if (state === 'ok') {
      await loadMonth();
      render();
    }
  });

  function openInvite() {
    inviteSheet.classList.remove('hidden');
    inviteBackdrop.classList.remove('hidden');
    loadInvite();
  }

  function closeInvite() {
    inviteSheet.classList.add('hidden');
    inviteBackdrop.classList.add('hidden');
  }

  $('#inviteBtn').onclick = openInvite;
  $('#closeInvite').onclick = closeInvite;
  inviteBackdrop.onclick = closeInvite;

  async function loadInvite() {
    $('#inviteMsg').textContent = '確認中…';
    $('#inviteEmail').disabled = true;
    $('#saveInviteBtn').classList.add('hidden');
    $('#replaceInviteBtn').classList.add('hidden');
    $('#shareInviteBtn').classList.add('hidden');

    try {
      const status = await manageCall('status');

      if (status.role !== 'host') {
        $('#inviteMsg').textContent = 'ホストだけが招待できます。';
        return;
      }

      if (status.guestPresent) {
        $('#inviteEmail').value = status.guestEmail || '';
        $('#inviteMsg').textContent = '2人目は登録済みです。';
        return;
      }

      if (status.pendingEmail) {
        $('#inviteEmail').value = status.pendingEmail;
        $('#inviteMsg').textContent = 'このメールだけ2人目として登録できます。';
        $('#replaceInviteBtn').classList.remove('hidden');
        $('#shareInviteBtn').classList.remove('hidden');
        return;
      }

      $('#inviteEmail').value = '';
      $('#inviteEmail').disabled = false;
      $('#inviteMsg').textContent = '';
      $('#saveInviteBtn').classList.remove('hidden');
    } catch (e) {
      $('#inviteMsg').textContent = e.message || '招待状態を確認できませんでした。';
    }
  }

  $('#saveInviteBtn').onclick = async () => {
    const email = $('#inviteEmail').value.trim().toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      $('#inviteMsg').textContent = 'メールアドレスを確認して。';
      return;
    }

    $('#inviteMsg').textContent = '登録中…';

    try {
      await manageCall('host_set_invite', { email });
      await loadInvite();
      showToast('招待先を登録した');
    } catch (e) {
      $('#inviteMsg').textContent = e.message || '登録できませんでした。';
    }
  };

  $('#replaceInviteBtn').onclick = async () => {
    try {
      await manageCall('host_cancel_invite');
      await loadInvite();
      $('#inviteEmail').focus();
    } catch (e) {
      $('#inviteMsg').textContent = e.message || '招待先を変更できませんでした。';
    }
  };

  $('#shareInviteBtn').onclick = async () => {
    const email = $('#inviteEmail').value.trim();
    const text = `ふたりカレンダーの招待です。登録メールは ${email} です。`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'ふたりカレンダー', text, url: appUrl() });
        return;
      } catch (_) {}
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${appUrl()}`);
      showToast('招待文とURLをコピーした');
    } catch (_) {
      showToast('このURLを相手に送って： ' + appUrl());
    }
  };

  function openPair() {
    pairSheet.classList.remove('hidden');
    pairBackdrop.classList.remove('hidden');
    loadPairStatus();
  }

  function closePair() {
    pairSheet.classList.add('hidden');
    pairBackdrop.classList.add('hidden');
  }

  $('#pairManageBtn').onclick = openPair;
  $('#closePair').onclick = closePair;
  pairBackdrop.onclick = closePair;

  async function loadPairStatus() {
    $('#pairRole').textContent = '確認中';
    $('#pairStatus').textContent = '状態を確認しています…';
    $('#pairMsg').textContent = '';
    $('#hostPairControls').classList.add('hidden');
    $('#guestPairControls').classList.add('hidden');
    $('#removeGuestBtn').classList.add('hidden');

    try {
      const status = await manageCall('status');

      if (status.role === 'host') {
        $('#pairRole').textContent = 'ホスト';
        $('#hostPairControls').classList.remove('hidden');

        if (status.guestPresent) {
          $('#pairStatus').textContent = status.guestEmail
            ? `ゲスト参加中：${status.guestEmail}`
            : 'ゲスト参加中';
          $('#removeGuestBtn').classList.remove('hidden');
        } else if (status.pendingEmail) {
          $('#pairStatus').textContent = `招待待ち：${status.pendingEmail}`;
        } else {
          $('#pairStatus').textContent = '現在ゲストはいません';
        }
      } else {
        $('#pairRole').textContent = 'ゲスト';
        $('#pairStatus').textContent = 'ホストの共有カレンダーに参加中';
        $('#guestPairControls').classList.remove('hidden');
      }
    } catch (e) {
      $('#pairRole').textContent = '確認失敗';
      $('#pairStatus').textContent = '';
      $('#pairMsg').textContent = e.message || '状態を確認できませんでした。';
    }
  }

  $('#removeGuestBtn').onclick = async () => {
    const ok = confirm('ゲストを退出させますか？\n\n同じ共有カレンダーは残るので、次に別のゲストを招待すると今までの共有履歴も引き継ぎます。');
    if (!ok) return;

    $('#pairMsg').textContent = '処理中…';

    try {
      await manageCall('host_remove_guest');
      $('#pairMsg').textContent = '';
      await loadPairStatus();
      showToast('ゲストを退出させた');
    } catch (e) {
      $('#pairMsg').textContent = e.message || '退出処理に失敗しました。';
    }
  };

  $('#dissolvePairBtn').onclick = async () => {
    const ok = confirm('ペアを解散しますか？\n\n現在のペアを終了し、新しい共有カレンダーへ切り替えます。次に招待するゲストには前のペアの共有履歴を見せません。');
    if (!ok) return;

    $('#pairMsg').textContent = '解散処理中…';

    try {
      await manageCall('host_dissolve');

      const state = await loadAllowedUser();
      if (state !== 'ok') throw new Error('新しい共有カレンダーを確認できませんでした。');

      $('#inviteBtn').classList.remove('hidden');
      await loadMonth();
      render();
      await loadPairStatus();
      showToast('ペアを解散して新しい共有に切り替えた');
    } catch (e) {
      $('#pairMsg').textContent = e.message || '解散処理に失敗しました。';
    }
  };

  $('#guestLeaveBtn').onclick = async () => {
    const ok = confirm('この共有カレンダーから退出しますか？\n\nホスト側の共有カレンダーや予定は残ります。');
    if (!ok) return;

    $('#pairMsg').textContent = '退出処理中…';

    try {
      await manageCall('guest_leave');
      await leaveAppToLogin('共有カレンダーから退出しました。');
    } catch (e) {
      $('#pairMsg').textContent = e.message || '退出処理に失敗しました。';
    }
  };

  init();
})();