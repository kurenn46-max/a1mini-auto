(() => {
  const $ = (id) => document.getElementById(id);
  const svg = $('workSvg');
  const scene = $('scene');
  const bg = $('bg');
  const overlay = $('overlay');
  const status = $('status');
  const coords = $('coords');
  const fileInput = $('file');

  const state = {
    loaded: false,
    iw: 1000,
    ih: 1400,
    scale: 1,
    panX: 0,
    panY: 0,
    mode: 'move',
    pointers: new Map(),
    panStart: null,
    pinch: null,
    pending: null,
    objects: [],
    cal: { O: null, X: null, Y: null, xm: 5, ym: 5, ready: false },
    calStep: 0,
  };

  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs = {}) {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }
  function say(t) { status.textContent = t; }
  function applyTransform() { scene.setAttribute('transform', `translate(${state.panX} ${state.panY}) scale(${state.scale})`); }
  function screenPoint(e) {
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toImage(p) { return { x: (p.x - state.panX) / state.scale, y: (p.y - state.panY) / state.scale }; }

  function fit() {
    if (!state.loaded) return;
    const r = svg.getBoundingClientRect();
    state.scale = Math.min(r.width / state.iw, r.height / state.ih) * 0.96;
    state.panX = (r.width - state.iw * state.scale) / 2;
    state.panY = (r.height - state.ih * state.scale) / 2;
    applyTransform();
  }
  function zoomAt(factor, sx, sy) {
    if (!state.loaded) return;
    const old = state.scale;
    const next = Math.min(12, Math.max(0.05, old * factor));
    const ix = (sx - state.panX) / old;
    const iy = (sy - state.panY) / old;
    state.scale = next;
    state.panX = sx - ix * next;
    state.panY = sy - iy * next;
    applyTransform();
  }

  function worldToImage(x, y) {
    const c = state.cal;
    if (!c.ready) return null;
    const ex = { x: (c.X.x - c.O.x) / c.xm, y: (c.X.y - c.O.y) / c.xm };
    const ey = { x: (c.Y.x - c.O.x) / c.ym, y: (c.Y.y - c.O.y) / c.ym };
    return { x: c.O.x + ex.x * x + ey.x * y, y: c.O.y + ex.y * x + ey.y * y };
  }
  function imageToWorld(p) {
    const c = state.cal;
    if (!c.ready) return null;
    const ax = (c.X.x - c.O.x) / c.xm, ay = (c.X.y - c.O.y) / c.xm;
    const bx = (c.Y.x - c.O.x) / c.ym, by = (c.Y.y - c.O.y) / c.ym;
    const dx = p.x - c.O.x, dy = p.y - c.O.y;
    const det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-9) return null;
    return { x: (dx * by - dy * bx) / det, y: (ax * dy - ay * dx) / det };
  }

  function textNode(x, y, text, color = '#111827', anchor = 'start') {
    const t = el('text', { x, y, fill: color, 'font-size': 20, 'font-weight': 700, 'text-anchor': anchor, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 5, 'stroke-linejoin': 'round' });
    t.textContent = text;
    return t;
  }
  function renderObject(o, g = overlay) {
    if (o.type === 'building') {
      const a = worldToImage(o.front, o.height), b = worldToImage(o.front + o.depth, o.height), c = worldToImage(o.front + o.depth, 0), d = worldToImage(o.front, 0);
      if (!a) return;
      g.appendChild(el('polygon', { points: `${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`, fill: 'rgba(239,68,68,.12)', stroke: '#ef4444', 'stroke-width': 4, 'vector-effect': 'non-scaling-stroke' }));
      g.appendChild(textNode(a.x, a.y - 12, `${o.name}  手前${o.front}m / H${o.height}m / D${o.depth}m`, '#ef4444'));
      g.appendChild(textNode(b.x, b.y - 12, `奥端 ${(o.front + o.depth).toFixed(1)}m`, '#ef4444', 'end'));
    } else if (o.type === 'target') {
      const q = worldToImage(o.r, o.h), base = worldToImage(o.r, 0), left = worldToImage(0, o.h);
      if (!q) return;
      if (o.guide !== 'none') g.appendChild(el('line', { x1: base.x, y1: base.y, x2: q.x, y2: q.y, stroke: '#2563eb', 'stroke-width': 2, 'stroke-dasharray': '9 7', 'vector-effect': 'non-scaling-stroke' }));
      if (o.guide === 'both') g.appendChild(el('line', { x1: left.x, y1: left.y, x2: q.x, y2: q.y, stroke: '#2563eb', 'stroke-width': 2, 'stroke-dasharray': '9 7', 'vector-effect': 'non-scaling-stroke' }));
      g.appendChild(el('circle', { cx: q.x, cy: q.y, r: 8, fill: '#fff', stroke: '#2563eb', 'stroke-width': 4, 'vector-effect': 'non-scaling-stroke' }));
      g.appendChild(textNode(q.x + 13, q.y - 12, `${o.name}  R${o.r}m / H${o.h}m`, '#2563eb'));
    } else if (o.type === 'line' || o.type === 'measure') {
      g.appendChild(el('line', { x1: o.a.x, y1: o.a.y, x2: o.b.x, y2: o.b.y, stroke: o.color || '#ef4444', 'stroke-width': 4, 'vector-effect': 'non-scaling-stroke' }));
      if (o.type === 'measure') {
        const wa = imageToWorld(o.a), wb = imageToWorld(o.b);
        if (wa && wb) {
          const dx = wb.x - wa.x, dy = wb.y - wa.y;
          g.appendChild(textNode((o.a.x + o.b.x) / 2, (o.a.y + o.b.y) / 2 - 12, `ΔR ${Math.abs(dx).toFixed(2)}m / ΔH ${Math.abs(dy).toFixed(2)}m / ${Math.hypot(dx,dy).toFixed(2)}m`, o.color || '#ef4444', 'middle'));
        }
      }
    }
  }
  function render() {
    overlay.replaceChildren();
    for (const o of state.objects) renderObject(o);
    const c = state.cal;
    if (c.O) {
      overlay.appendChild(el('circle', { cx: c.O.x, cy: c.O.y, r: 7, fill: '#7c3aed' }));
      overlay.appendChild(textNode(c.O.x + 10, c.O.y - 10, '原点', '#7c3aed'));
    }
    if (c.X) overlay.appendChild(el('circle', { cx: c.X.x, cy: c.X.y, r: 7, fill: '#16a34a' }));
    if (c.Y) overlay.appendChild(el('circle', { cx: c.Y.x, cy: c.Y.y, r: 7, fill: '#d97706' }));
    if (state.pending) overlay.appendChild(el('circle', { cx: state.pending.x, cy: state.pending.y, r: 7, fill: '#111827' }));
  }

  function setMode(m) {
    state.mode = m;
    state.pending = null;
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    say({move:'移動：1本指で移動、2本指でズーム', measure:'寸法：始点→終点の順に2回タップ', line:'直線：始点→終点の順に2回タップ', coord:'座標：図上をタップ'}[m] || '');
    render();
  }

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const n = new Image();
      n.onload = () => {
        state.loaded = true; state.iw = n.naturalWidth; state.ih = n.naturalHeight;
        bg.setAttribute('href', reader.result); bg.setAttribute('width', state.iw); bg.setAttribute('height', state.ih);
        state.objects = []; state.cal = { O:null, X:null, Y:null, xm:5, ym:5, ready:false }; state.calStep = 0;
        fit(); render(); coords.textContent = '未校正'; say('画像OK。次に「校正」。');
      };
      n.src = reader.result;
    };
    reader.readAsDataURL(f);
  });

  $('calBtn').onclick = () => $('calSheet').classList.add('show');
  $('calStart').onclick = () => {
    if (!state.loaded) return say('先に画像を開いてください');
    state.cal = { O:null, X:null, Y:null, xm:+$('calX').value || 5, ym:+$('calY').value || 5, ready:false };
    state.calStep = 1; $('calSheet').classList.remove('show');
    $('hint').textContent = '校正 1/3：作業半径0m・高さ0mの原点をタップ'; $('hint').style.display = 'block'; render();
  };
  $('buildingBtn').onclick = () => state.cal.ready ? $('buildingSheet').classList.add('show') : say('先に校正してください');
  $('buildingAdd').onclick = () => {
    const front=+$('bFront').value,height=+$('bHeight').value,depth=+$('bDepth').value;
    if (!(front>=0 && height>=0 && depth>=0)) return;
    state.objects.push({type:'building',front,height,depth,name:$('bName').value || '建物'}); $('buildingSheet').classList.remove('show'); render(); say('建物を実寸で描きました');
  };
  $('targetBtn').onclick = () => state.cal.ready ? $('targetSheet').classList.add('show') : say('先に校正してください');
  $('targetAdd').onclick = () => {
    const r=+$('tR').value,h=+$('tH').value; if (!(r>=0 && h>=0)) return;
    state.objects.push({type:'target',r,h,name:$('tName').value || '作業点',guide:$('tGuide').value}); $('targetSheet').classList.remove('show'); render(); say('作業点を実寸で描きました');
  };
  $('undo').onclick = () => { state.objects.pop(); render(); };
  $('clear').onclick = () => { state.objects=[]; render(); };
  $('fit').onclick = fit;
  $('zin').onclick = () => zoomAt(1.3, svg.clientWidth/2, svg.clientHeight/2);
  $('zout').onclick = () => zoomAt(0.77, svg.clientWidth/2, svg.clientHeight/2);
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).classList.remove('show'));

  svg.addEventListener('pointerdown', (e) => {
    if (!state.loaded) return;
    const p = screenPoint(e); state.pointers.set(e.pointerId,p); try{svg.setPointerCapture(e.pointerId)}catch{}
    if (state.pointers.size === 2) {
      const a=[...state.pointers.values()], mid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
      state.pinch={d:Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y),s:state.scale,img:toImage(mid)}; state.panStart=null; return;
    }
    if (state.calStep) {
      const ip=toImage(p);
      if (state.calStep===1) { state.cal.O=ip; state.calStep=2; $('hint').textContent=`校正 2/3：横軸 ${state.cal.xm}m の点をタップ`; }
      else if (state.calStep===2) { state.cal.X=ip; state.calStep=3; $('hint').textContent=`校正 3/3：縦軸 ${state.cal.ym}m の点をタップ`; }
      else { state.cal.Y=ip; state.cal.ready=true; state.calStep=0; $('hint').style.display='none'; coords.textContent='校正OK'; say('校正完了'); }
      render(); return;
    }
    if (state.mode==='move') { state.panStart={screen:p,panX:state.panX,panY:state.panY}; return; }
    const ip=toImage(p);
    if (state.mode==='coord') { const w=imageToWorld(ip); coords.textContent=w?`R ${w.x.toFixed(2)}m / H ${w.y.toFixed(2)}m`:'未校正'; return; }
    if (state.mode==='line' || state.mode==='measure') {
      if (state.mode==='measure' && !state.cal.ready) return say('寸法は校正後に使えます');
      if (!state.pending) { state.pending=ip; say('終点をタップ'); render(); }
      else { state.objects.push({type:state.mode,a:state.pending,b:ip,color:'#ef4444'}); state.pending=null; say('追加しました'); render(); }
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!state.pointers.has(e.pointerId)) return;
    const p=screenPoint(e); state.pointers.set(e.pointerId,p);
    if (state.pointers.size>=2 && state.pinch) {
      const a=[...state.pointers.values()], mid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};
      const d=Math.hypot(a[1].x-a[0].x,a[1].y-a[0].y), ns=Math.min(12,Math.max(.05,state.pinch.s*d/Math.max(1,state.pinch.d)));
      state.scale=ns; state.panX=mid.x-state.pinch.img.x*ns; state.panY=mid.y-state.pinch.img.y*ns; applyTransform(); return;
    }
    if (state.panStart && state.mode==='move') { state.panX=state.panStart.panX+(p.x-state.panStart.screen.x); state.panY=state.panStart.panY+(p.y-state.panStart.screen.y); applyTransform(); }
  });
  function end(e){ state.pointers.delete(e.pointerId); if(state.pointers.size<2)state.pinch=null; if(state.pointers.size===0)state.panStart=null; }
  svg.addEventListener('pointerup',end); svg.addEventListener('pointercancel',end);

  $('save').onclick = () => {
    if (!state.loaded) return say('先に画像を開いてください');
    const clone = svg.cloneNode(true);
    clone.setAttribute('width', state.iw); clone.setAttribute('height', state.ih); clone.setAttribute('viewBox', `0 0 ${state.iw} ${state.ih}`);
    const sc = clone.querySelector('#scene'); sc.setAttribute('transform','');
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml],{type:'image/svg+xml'}), url=URL.createObjectURL(blob), img=new Image();
    img.onload=()=>{const c=document.createElement('canvas');c.width=state.iw;c.height=state.ih;const cx=c.getContext('2d');cx.drawImage(img,0,0);URL.revokeObjectURL(url);c.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='揚程図_作図.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1200)},'image/png')};
    img.src=url;
  };
  window.addEventListener('resize',fit);
  applyTransform(); render(); setMode('move');
})();