(()=>{'use strict';
const $=s=>document.querySelector(s), KEY='futari-calendar-demo-events-v1';
let current=new Date();current.setDate(1);let selectedDate=iso(new Date());let events=load();
function iso(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function dateFromIso(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
function load(){try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}}
function persist(){localStorage.setItem(KEY,JSON.stringify(events))}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.remove('hidden');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.add('hidden'),1700)}
function render(){ $('#monthTitle').textContent=current.getFullYear()+'年'+(current.getMonth()+1)+'月'; const g=$('#calendarGrid');g.innerHTML='';
 const first=new Date(current.getFullYear(),current.getMonth(),1), mi=(first.getDay()+6)%7, start=new Date(first);start.setDate(first.getDate()-mi);
 for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const id=iso(d),b=document.createElement('button');b.className='day';b.type='button';b.dataset.date=id;if(d.getMonth()!=current.getMonth())b.classList.add('out');if(id===iso(new Date()))b.classList.add('today');if(id===selectedDate)b.classList.add('selected');
 const n=document.createElement('div');n.className='day-num';n.textContent=d.getDate();b.appendChild(n);const list=events.filter(e=>e.event_date===id);
 list.slice(0,3).forEach(e=>{const c=document.createElement('div');c.className='event-chip '+(e.owner==='mine'?'mine':'partner');c.textContent=(e.start_time?e.start_time+' ':'')+e.title;c.onclick=ev=>{ev.stopPropagation();openSheet(id,e)};b.appendChild(c)});
 if(list.length>3){const m=document.createElement('div');m.className='more';m.textContent='+'+(list.length-3)+'件';b.appendChild(m)}
 b.onclick=()=>{selectedDate=id;openSheet(id);render()};g.appendChild(b)}
}
function openSheet(date,e=null){selectedDate=date;const d=dateFromIso(date);$('#sheetDate').textContent=d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';const mine=!e||e.owner==='mine';$('#sheetTitle').textContent=e?(mine?'予定を編集':'相手予定を確認'):'予定を追加';$('#eventTitle').value=e?.title||'';$('#startTime').value=e?.start_time||'';$('#endTime').value=e?.end_time||'';$('#eventMemo').value=e?.note||'';$('#allDay').checked=!e?.start_time;$('#editingId').value=e?.id||'';['eventTitle','startTime','endTime','eventMemo','allDay'].forEach(id=>$('#'+id).disabled=!mine);$('#saveBtn').classList.toggle('hidden',!mine);$('#deleteBtn').classList.toggle('hidden',!e||!mine);$('#eventSheet').classList.remove('hidden');$('#sheetBackdrop').classList.remove('hidden');}
function closeSheet(){ $('#eventSheet').classList.add('hidden');$('#sheetBackdrop').classList.add('hidden');['eventTitle','startTime','endTime','eventMemo','allDay'].forEach(id=>$('#'+id).disabled=false)}
$('#closeSheet').onclick=closeSheet;$('#sheetBackdrop').onclick=closeSheet;$('#allDay').onchange=e=>{if(e.target.checked){$('#startTime').value='';$('#endTime').value=''}}
$('#saveBtn').onclick=()=>{const title=$('#eventTitle').value.trim();if(!title){toast('予定名を入力して');return}const id=$('#editingId').value, rec={id:id||crypto.randomUUID(),event_date:selectedDate,title,start_time:$('#allDay').checked?'':$('#startTime').value,end_time:$('#allDay').checked?'':$('#endTime').value,note:$('#eventMemo').value.trim(),owner:'mine'};if(id)events=events.map(e=>e.id===id?rec:e);else events.push(rec);persist();closeSheet();render();toast('保存した')};
$('#deleteBtn').onclick=()=>{const id=$('#editingId').value;events=events.filter(e=>e.id!==id);persist();closeSheet();render();toast('削除した')};
async function changeMonth(n){current=new Date(current.getFullYear(),current.getMonth()+n,1);selectedDate=iso(current);render()}
$('#prevBtn').onclick=()=>changeMonth(-1);$('#nextBtn').onclick=()=>changeMonth(1);$('#todayBtn').onclick=()=>{const n=new Date();current=new Date(n.getFullYear(),n.getMonth(),1);selectedDate=iso(n);render()};$('#fab').onclick=()=>openSheet(selectedDate);
let sx=0,sy=0;$('#swipeArea').addEventListener('touchstart',e=>{const t=e.changedTouches[0];sx=t.clientX;sy=t.clientY},{passive:true});$('#swipeArea').addEventListener('touchend',e=>{const t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.3)changeMonth(dx<0?1:-1)},{passive:true});
$('#partnerSampleBtn').onclick=()=>{const d=selectedDate||iso(new Date());events.push({id:crypto.randomUUID(),event_date:d,title:'相手予定サンプル',start_time:'14:00',end_time:'',note:'デモ用。編集できない表示を確認できます。',owner:'partner'});persist();render();toast('相手予定サンプルを追加')};
function closeInvite(){ $('#inviteSheet').classList.add('hidden');$('#inviteBackdrop').classList.add('hidden')}
$('#inviteBtn').onclick=()=>{$('#inviteMsg').textContent='';$('#inviteEmail').value='';$('#inviteSheet').classList.remove('hidden');$('#inviteBackdrop').classList.remove('hidden')};$('#closeInvite').onclick=closeInvite;$('#inviteBackdrop').onclick=closeInvite;$('#saveInviteBtn').onclick=()=>{const e=$('#inviteEmail').value.trim();$('#inviteMsg').textContent=e?'デモなので送信はしていません。本番ではこのメールだけ招待されます。':'メールを入力して。';if(e)toast('招待画面の動作OK')};
render();
})();