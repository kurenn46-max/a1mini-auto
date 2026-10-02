(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const cfg = window.APP_CONFIG || {};
  const supabaseLib = window.supabase;
  const client = supabaseLib?.createClient?.(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const loginView = $('#loginView'), appView = $('#appView');
  const grid = $('#calendarGrid'), monthTitle = $('#monthTitle');
  const sheet = $('#eventSheet'), backdrop = $('#sheetBackdrop');
  const inviteSheet = $('#inviteSheet'), inviteBackdrop = $('#inviteBackdrop');
  let current = new Date(); current.setDate(1);
  let selectedDate = iso(new Date());
  let sessionUser = null;
  let allowedUser = null;
  let events = [];
  let refreshTimer = null;

  function iso(d){ const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
  function dateFromIso(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
  function appUrl(){ return location.href.split('#')[0].split('?')[0]; }
  function registerApiUrl(){ return cfg.REGISTER_API_URL || appUrl(); }
  function showToast(t){ const el=$('#toast'); el.textContent=t; el.classList.remove('hidden'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add('hidden'),1800); }
  function setLoginMsg(t){ $('#loginMsg').textContent=t || ''; }

  async function init(){
    if(!client){ setLoginMsg('接続ライブラリを読み込めませんでした。通信状態を確認して。'); return; }
    const {data,error} = await client.auth.getSession();
    if(!error && data.session){
      sessionUser=data.session.user;
      if(await loadAllowedUser()) return enterApp();
      await client.auth.signOut(); sessionUser=null;
    }
    client.auth.onAuthStateChange(async (_event,s)=>{
      if(s?.user && appView.classList.contains('hidden')){
        sessionUser=s.user;
        if(await loadAllowedUser()) enterApp();
      }
    });
  }

  async function loadAllowedUser(){
    if(!client || !sessionUser) return false;
    const {data,error}=await client.from('allowed_users').select('user_id,display_name,slot').eq('user_id',sessionUser.id).maybeSingle();
    if(error || !data) return false;
    allowedUser=data; return true;
  }

  $('#loginBtn').onclick = async () => {
    const email=$('#email').value.trim().toLowerCase(), password=$('#password').value;
    if(!email || !password){ setLoginMsg('メールとパスワードを入力して。'); return; }
    setLoginMsg('ログイン中…');
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error){ setLoginMsg('ログインできませんでした。メールかパスワードを確認して。'); return; }
    sessionUser=data.user;
    if(!(await loadAllowedUser())){
      await client.auth.signOut(); sessionUser=null;
      setLoginMsg('このメールは、このカレンダーの2人に登録されていません。');
      return;
    }
    await enterApp();
  };

  $('#signupBtn').onclick = async () => {
    const email=$('#email').value.trim().toLowerCase(), password=$('#password').value, ownerCode=$('#ownerCode').value.trim();
    if(!email || !/^\S+@\S+\.\S+$/.test(email)){ setLoginMsg('メールアドレスを確認して。'); return; }
    if(password.length < 8){ setLoginMsg('パスワードは8文字以上にして。'); return; }
    setLoginMsg('登録中…');
    try{
      const res=await fetch(registerApiUrl(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'register',email,password,ownerCode})});
      const body=await res.json().catch(()=>({}));
      if(!res.ok){ setLoginMsg(body.error || '登録できませんでした。'); return; }
      const {data,error}=await client.auth.signInWithPassword({email,password});
      if(error){ setLoginMsg('登録は完了しました。もう一度ログインして。'); return; }
      sessionUser=data.user;
      if(!(await loadAllowedUser())){ await client.auth.signOut(); setLoginMsg('利用登録を確認できませんでした。'); return; }
      setLoginMsg(''); await enterApp();
    }catch(_){ setLoginMsg('通信に失敗しました。もう一度試して。'); }
  };

  async function enterApp(){
    loginView.classList.add('hidden'); appView.classList.remove('hidden');
    $('#inviteBtn').classList.toggle('hidden', allowedUser?.slot !== 1);
    await loadMonth(); render();
    clearInterval(refreshTimer);
    refreshTimer=setInterval(async()=>{ if(!document.hidden){ await loadMonth(); render(); } },30000);
  }

  $('#logoutBtn').onclick=async()=>{ clearInterval(refreshTimer); await client.auth.signOut(); sessionUser=null; allowedUser=null; events=[]; appView.classList.add('hidden'); loginView.classList.remove('hidden'); setLoginMsg(''); };

  async function loadMonth(){
    if(!client || !sessionUser) return;
    const start=new Date(current.getFullYear(),current.getMonth(),1);
    const end=new Date(current.getFullYear(),current.getMonth()+1,1);
    const {data,error}=await client.from('calendar_events').select('*').gte('event_date',iso(start)).lt('event_date',iso(end)).order('event_date').order('start_time',{ascending:true,nullsFirst:true});
    if(error){ showToast('予定の読み込みに失敗'); return; }
    events=data||[];
  }

  function render(){
    monthTitle.textContent=`${current.getFullYear()}年${current.getMonth()+1}月`;
    grid.innerHTML='';
    const first=new Date(current.getFullYear(),current.getMonth(),1);
    const mondayIndex=(first.getDay()+6)%7;
    const start=new Date(first); start.setDate(first.getDate()-mondayIndex);
    for(let i=0;i<42;i++){
      const d=new Date(start); d.setDate(start.getDate()+i);
      const id=iso(d), cell=document.createElement('button');
      cell.className='day'; cell.dataset.date=id; cell.type='button';
      if(d.getMonth()!==current.getMonth()) cell.classList.add('out');
      if(id===iso(new Date())) cell.classList.add('today');
      if(id===selectedDate) cell.classList.add('selected');
      const n=document.createElement('div'); n.className='day-num'; n.textContent=d.getDate(); cell.appendChild(n);
      const list=events.filter(e=>e.event_date===id);
      list.slice(0,3).forEach(e=>{
        const chip=document.createElement('div');
        const mine=e.owner_id===sessionUser?.id;
        chip.className=`event-chip ${mine?'mine':'partner'}`;
        chip.textContent=`${e.start_time?String(e.start_time).slice(0,5)+' ':''}${e.title}`;
        chip.onclick=(ev)=>{ev.stopPropagation();openSheet(id,e);};
        cell.appendChild(chip);
      });
      if(list.length>3){const more=document.createElement('div');more.className='more';more.textContent=`+${list.length-3}件`;cell.appendChild(more);}
      cell.onclick=()=>{selectedDate=id;openSheet(id);render();};
      grid.appendChild(cell);
    }
  }

  function setEventFormDisabled(disabled){
    ['#eventTitle','#startTime','#endTime','#eventMemo','#allDay'].forEach(s=>{$(s).disabled=disabled;});
    $('#saveBtn').classList.toggle('hidden',disabled);
  }
  function openSheet(date,event=null){
    selectedDate=date;
    const d=dateFromIso(date); $('#sheetDate').textContent=`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
    const mine=!event || event.owner_id===sessionUser?.id;
    $('#sheetTitle').textContent=event?(mine?'予定を編集':'予定を確認'):'予定を追加';
    $('#eventTitle').value=event?.title||''; $('#startTime').value=event?.start_time?.slice(0,5)||''; $('#endTime').value=event?.end_time?.slice(0,5)||''; $('#eventMemo').value=event?.note||'';
    $('#allDay').checked=!event?.start_time; $('#editingId').value=event?.id||'';
    $('#deleteBtn').classList.toggle('hidden',!event || !mine);
    setEventFormDisabled(!mine);
    sheet.classList.remove('hidden'); backdrop.classList.remove('hidden');
    if(mine) setTimeout(()=>$('#eventTitle').focus(),80);
  }
  function closeSheet(){sheet.classList.add('hidden');backdrop.classList.add('hidden');setEventFormDisabled(false);}
  $('#closeSheet').onclick=closeSheet; backdrop.onclick=closeSheet;
  $('#allDay').onchange=(e)=>{ if(e.target.checked){$('#startTime').value='';$('#endTime').value='';} };

  $('#saveBtn').onclick=async()=>{
    const title=$('#eventTitle').value.trim(); if(!title){showToast('予定名を入力して');return;}
    const id=$('#editingId').value;
    const record={event_date:selectedDate,title,start_time:$('#allDay').checked?null:($('#startTime').value||null),end_time:$('#allDay').checked?null:($('#endTime').value||null),note:$('#eventMemo').value.trim()||null};
    let res;
    if(id) res=await client.from('calendar_events').update(record).eq('id',id).eq('owner_id',sessionUser.id);
    else res=await client.from('calendar_events').insert({...record,owner_id:sessionUser.id,visibility:'shared'});
    if(res.error){showToast('保存できませんでした');return;}
    closeSheet(); await loadMonth(); render(); showToast('保存した');
  };

  $('#deleteBtn').onclick=async()=>{
    const id=$('#editingId').value; if(!id)return;
    const {error}=await client.from('calendar_events').delete().eq('id',id).eq('owner_id',sessionUser.id);
    if(error){showToast('削除できませんでした');return;}
    closeSheet(); await loadMonth(); render(); showToast('削除した');
  };

  async function changeMonth(delta){ current=new Date(current.getFullYear(),current.getMonth()+delta,1);selectedDate=iso(current);await loadMonth();render(); }
  $('#prevBtn').onclick=()=>changeMonth(-1); $('#nextBtn').onclick=()=>changeMonth(1);
  $('#todayBtn').onclick=async()=>{const n=new Date();current=new Date(n.getFullYear(),n.getMonth(),1);selectedDate=iso(n);await loadMonth();render();};
  $('#fab').onclick=()=>openSheet(selectedDate||iso(new Date()));

  let sx=0,sy=0;
  $('#swipeArea').addEventListener('touchstart',e=>{const t=e.changedTouches[0];sx=t.clientX;sy=t.clientY;},{passive:true});
  $('#swipeArea').addEventListener('touchend',e=>{const t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.3)changeMonth(dx<0?1:-1);},{passive:true});
  window.addEventListener('focus',async()=>{ if(sessionUser){await loadMonth();render();} });

  function openInvite(){ inviteSheet.classList.remove('hidden'); inviteBackdrop.classList.remove('hidden'); loadInvite(); }
  function closeInvite(){ inviteSheet.classList.add('hidden'); inviteBackdrop.classList.add('hidden'); }
  $('#inviteBtn').onclick=openInvite; $('#closeInvite').onclick=closeInvite; inviteBackdrop.onclick=closeInvite;

  async function loadInvite(){
    $('#inviteMsg').textContent='確認中…'; $('#inviteEmail').disabled=false; $('#saveInviteBtn').classList.remove('hidden'); $('#replaceInviteBtn').classList.add('hidden'); $('#shareInviteBtn').classList.add('hidden');
    const {data,error}=await client.from('calendar_invites').select('email,used_at').eq('slot',2).maybeSingle();
    if(error){ $('#inviteMsg').textContent='招待状態を確認できませんでした。'; return; }
    if(!data){ $('#inviteEmail').value=''; $('#inviteMsg').textContent=''; return; }
    $('#inviteEmail').value=data.email; $('#inviteEmail').disabled=true; $('#saveInviteBtn').classList.add('hidden');
    $('#shareInviteBtn').classList.remove('hidden');
    if(data.used_at){ $('#inviteMsg').textContent='2人目は登録済みです。'; }
    else { $('#inviteMsg').textContent='このメールだけ2人目として登録できます。'; $('#replaceInviteBtn').classList.remove('hidden'); }
  }

  $('#saveInviteBtn').onclick=async()=>{
    const email=$('#inviteEmail').value.trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(email)){ $('#inviteMsg').textContent='メールアドレスを確認して。'; return; }
    $('#inviteMsg').textContent='登録中…';
    const {error}=await client.from('calendar_invites').insert({email,slot:2,invited_by:sessionUser.id});
    if(error){ $('#inviteMsg').textContent='登録できませんでした。すでに招待済みか確認して。'; return; }
    await loadInvite(); showToast('招待先を登録した');
  };
  $('#replaceInviteBtn').onclick=async()=>{
    const {error}=await client.from('calendar_invites').delete().eq('slot',2).is('used_at',null);
    if(error){ $('#inviteMsg').textContent='招待先を変更できませんでした。'; return; }
    await loadInvite(); $('#inviteEmail').focus();
  };
  $('#shareInviteBtn').onclick=async()=>{
    const email=$('#inviteEmail').value.trim();
    const text=`ふたりカレンダーの招待です。登録メールは ${email} です。`;
    if(navigator.share){ try{ await navigator.share({title:'ふたりカレンダー',text,url:appUrl()}); return; }catch(_){} }
    try{ await navigator.clipboard.writeText(`${text}\n${appUrl()}`); showToast('招待文とURLをコピーした'); }
    catch(_){ showToast('このURLを相手に送って： '+appUrl()); }
  };

  init();
})();
