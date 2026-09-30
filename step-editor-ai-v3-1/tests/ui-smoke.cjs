const { chromium } = require('playwright');
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push('console: '+m.text());});

  await page.goto('http://127.0.0.1:8000/step-editor-ai-v3-1/?ui-smoke=1',{
    waitUntil:'networkidle',timeout:90000
  });

  if(!(await page.locator('#nightPrompt').count())) throw new Error('ナイト入力欄がない');
  if(!(await page.locator('#nightRunBtn').count())) throw new Error('ナイト実行ボタンがない');

  await page.click('#addBoxBtn');
  await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');
  let st=await page.evaluate(()=>window.__okaTest.state());
  if(!near(st.partSize.x,40)||!near(st.partSize.y,30)||!near(st.partSize.z,10)){
    throw new Error('初期箱が40×30×10ではない');
  }

  async function night(text){
    await page.locator('#nightPrompt').fill(text);
    await page.click('#nightRunBtn');
    await page.waitForTimeout(180);
    return {
      state:await page.evaluate(()=>window.__okaTest.state()),
      reply:(await page.locator('#nightReply').innerText()).trim(),
      status:(await page.locator('#status').innerText()).trim()
    };
  }

  // Absolute size + physical anchor.
  let r=await night('ナイト、Xを60mm、左固定');
  if(!near(r.state.partSize.x,60)||!near(r.state.partSize.y,30)||!near(r.state.partSize.z,10)){
    throw new Error('X60 左固定が反映されない: '+JSON.stringify(r.state.partSize));
  }
  if(r.state.lastCommand?.axis!=='x'||r.state.lastCommand?.anchor!=='min'){
    throw new Error('X60 左固定のコマンド解釈が不正');
  }
  if(!r.reply.includes('X')||!r.reply.includes('60')) throw new Error('ナイト返答が不明確: '+r.reply);

  // Undo via prompt.
  r=await night('元に戻して');
  if(!near(r.state.partSize.x,40)||r.state.editCursor!==0){
    throw new Error('プロンプトUndoでX40に戻らない');
  }

  // Full-width text must normalize.
  r=await night('Ｚを２０ｍｍ、下固定');
  if(!near(r.state.partSize.z,20)||r.state.lastCommand?.axis!=='z'||r.state.lastCommand?.anchor!=='min'){
    throw new Error('全角Z20 下固定を解釈できない');
  }

  // Match one axis to another.
  r=await night('YをXに合わせて');
  if(!near(r.state.partSize.y,r.state.partSize.x)){
    throw new Error('YをXに合わせる命令が反映されない');
  }

  // Relative edit.
  const beforeX=r.state.partSize.x;
  r=await night('Xを10mm伸ばして、右固定');
  if(!near(r.state.partSize.x,beforeX+10)||r.state.lastCommand?.anchor!=='max'){
    throw new Error('X +10 右固定が反映されない');
  }

  // Axis off.
  r=await night('軸解除');
  if(r.state.selectedAxis!==null) throw new Error('プロンプトで軸解除できない');
  if((await page.locator('.axisSignLabel').count())!==0) throw new Error('軸解除後も±表示が残る');

  // Contradictory physical direction must be rejected without creating an edit.
  const cursorBefore=r.state.editCursor;
  r=await night('Zを30mm、左固定');
  if(r.state.editCursor!==cursorBefore) throw new Error('矛盾コマンドを実行してしまった');
  if(!r.reply.includes('方向が合ってへん')) throw new Error('矛盾理由を返していない: '+r.reply);

  // Gibberish must not edit.
  const cursor2=r.state.editCursor;
  r=await night('なんとなくええ感じにして');
  if(r.state.editCursor!==cursor2) throw new Error('曖昧コマンドで編集してしまった');

  // Delete selected part by prompt, then undo restore.
  await page.click('#addCylinderBtn');
  await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='2');
  let delState=await page.evaluate(()=>window.__okaTest.state());
  if(delState.activePartCount!==2) throw new Error('削除テスト開始時に2部品ではない');

  r=await night('このパーツを消して');
  if(r.state.activePartCount!==1) throw new Error('このパーツ削除で部品数が1にならない');
  if(!r.state.deletedPartNames.some(n=>n.includes('Cylinder'))) throw new Error('選択Cylinderが削除状態になっていない');
  if(r.state.selectedIndex!==-1) throw new Error('削除後も削除パーツが選択中');
  if((await page.evaluate(()=>window.__okaTest.exportableCount()))!==1){
    throw new Error('削除パーツがSTL/GLB出力対象から外れていない');
  }
  if(!r.reply.includes('削除した')) throw new Error('削除成功の返答がない: '+r.reply);

  r=await night('元に戻して');
  if(r.state.activePartCount!==2) throw new Error('Undoで削除パーツが復元されない');
  if(r.state.deletedPartNames.length!==0) throw new Error('Undo後もdeleted状態が残る');
  if((await page.evaluate(()=>window.__okaTest.exportableCount()))!==2){
    throw new Error('Undo後に出力対象が2部品へ戻らない');
  }

  // Named part delete.
  r=await night('Box 1を削除');
  if(r.state.activePartCount!==1) throw new Error('名前指定削除で部品数が1にならない');
  if(!r.state.deletedPartNames.includes('Box 1')) throw new Error('Box 1名前指定削除が効いていない');
  if(r.state.activePartNames.includes('Box 1')) throw new Error('削除したBox 1がactiveに残る');

  r=await night('元に戻して');
  if(r.state.activePartCount!==2) throw new Error('名前指定削除のUndoが効かない');

  // Detailed face must not replace 3D dimensions with zero-thickness face extents.
  await page.locator('.partRow[data-index="0"] .selectBtn').click();
  const faceIndex=await page.evaluate(()=>window.__okaTest.extremePatch('z','max'));
  if(faceIndex===null) throw new Error('詳細面テスト用の面が見つからない');
  await page.evaluate(i=>window.__okaTest.selectPatch(0,i),faceIndex);
  await page.waitForTimeout(100);
  let dimState=await page.evaluate(()=>window.__okaTest.dimensionState());
  if(dimState.owner!=='part'){
    throw new Error('詳細面選択で3D寸法が部品全体ではない: '+JSON.stringify(dimState));
  }
  if(dimState.labels.some(x=>/\b0(?:\.0+)?\s*mm\b/.test(x))){
    throw new Error('詳細面選択で0mm寸法が3Dに出ている: '+JSON.stringify(dimState.labels));
  }

  // Deleting selected component must switch 3D dimensions to remaining model overall size.
  await page.locator('.partRow[data-index="1"] .selectBtn').click();
  r=await night('このパーツを消して');
  dimState=await page.evaluate(()=>window.__okaTest.dimensionState());
  if(dimState.owner!=='model'){
    throw new Error('パーツ削除後にモデル全体寸法へ切り替わらない: '+JSON.stringify(dimState));
  }
  if(dimState.labels.some(x=>/\b0(?:\.0+)?\s*mm\b/.test(x))){
    throw new Error('パーツ削除後のモデル寸法に0mmが混ざる: '+JSON.stringify(dimState.labels));
  }
  r=await night('元に戻して');

  // Round-bar dedicated edit: preserve circular diameter and edit length with fixed side.
  await page.locator('.partRow[data-index="1"] .selectBtn').click();
  let rb=await page.evaluate(()=>window.__okaTest.state());
  if(!rb.roundBar || rb.roundBar.axis!=='z' || !near(rb.roundBar.diameter,20) || !near(rb.roundBar.length,20)){
    throw new Error('CAD円柱を丸棒として認識できない: '+JSON.stringify(rb.roundBar));
  }

  r=await night('直径10mm、長さ60mm、下固定');
  if(!r.state.roundBar || !near(r.state.roundBar.diameter,10,0.02) || !near(r.state.roundBar.length,60,0.02)){
    throw new Error('丸棒 Ø10×60 が反映されない: '+JSON.stringify(r.state.roundBar));
  }
  if(!near(r.state.partSize.x,10,0.02)||!near(r.state.partSize.y,10,0.02)||!near(r.state.partSize.z,60,0.02)){
    throw new Error('丸棒編集で真円外形を維持できない: '+JSON.stringify(r.state.partSize));
  }
  if(r.state.lastCommand?.type!=='roundBar' || r.state.lastCommand?.anchor!=='min'){
    throw new Error('丸棒専用コマンド/固定側が記録されていない');
  }

  r=await night('元に戻して');
  if(!r.state.roundBar || !near(r.state.roundBar.diameter,20,0.02)||!near(r.state.roundBar.length,20,0.02)){
    throw new Error('丸棒編集Undoで元寸法へ戻らない');
  }

  r=await night('長さを10mm伸ばして、下固定');
  if(!near(r.state.roundBar.length,30,0.02)||!near(r.state.roundBar.diameter,20,0.02)){
    throw new Error('丸棒 長さ+10 が正しくない: '+JSON.stringify(r.state.roundBar));
  }
  r=await night('直径を2mm細く');
  if(!near(r.state.roundBar.diameter,18,0.02)||!near(r.state.roundBar.length,30,0.02)){
    throw new Error('丸棒 直径-2 が正しくない: '+JSON.stringify(r.state.roundBar));
  }

  // Unmarked imported-like cylinder: shape detector must recognize a straight round bar.
  await page.evaluate(()=>window.__okaTest.addUnmarkedCylinder(12,36));
  rb=await page.evaluate(()=>window.__okaTest.state());
  if(!rb.roundBar || rb.roundBar.confidence!=='high' || rb.roundBar.axis!=='z'){
    throw new Error('形状由来の丸棒自動認識に失敗: '+JSON.stringify(rb.roundBar));
  }
  r=await night('直径16mm、長さ48mm、中心固定');
  if(!r.state.roundBar || !near(r.state.roundBar.diameter,16,0.03)||!near(r.state.roundBar.length,48,0.03)){
    throw new Error('自動認識丸棒の編集に失敗: '+JSON.stringify(r.state.roundBar));
  }
  if(!near(r.state.partSize.x,16,0.03)||!near(r.state.partSize.y,16,0.03)||!near(r.state.partSize.z,48,0.03)){
    throw new Error('自動認識丸棒が真円/長さを維持していない: '+JSON.stringify(r.state.partSize));
  }

  // Hole move: select a simple Z-axis through-hole and move center while keeping diameter.
  const holePart=await page.evaluate(()=>window.__okaTest.addHolePlateFixture());
  const holePatch=await page.evaluate(i=>window.__okaTest.firstMovableHolePatch(i),holePart);
  if(holePatch===null) throw new Error('移動可能な貫通穴を検出できない');
  await page.evaluate(([pi,fi])=>window.__okaTest.selectPatch(pi,fi),[holePart,holePatch]);
  await page.waitForTimeout(100);

  let hs=await page.evaluate(()=>window.__okaTest.selectedHoleState());
  if(!hs || hs.axis!=='z' || !near(hs.diameter,6,0.08) || !near(hs.center.x,0,0.05) || !near(hs.center.y,0,0.05)){
    throw new Error('穴初期状態が不正: '+JSON.stringify(hs));
  }

  r=await night('この穴を右へ4mm');
  hs=await page.evaluate(()=>window.__okaTest.selectedHoleState());
  if(!r.state.lastCommand || r.state.lastCommand.type!=='holeMove'){
    throw new Error('穴移動が専用コマンドで記録されていない');
  }
  if(!hs || !near(hs.center.x,4,0.05) || !near(hs.center.y,0,0.05) || !near(hs.diameter,6,0.08)){
    throw new Error('穴右4mm移動または穴径維持に失敗: '+JSON.stringify(hs));
  }

  r=await night('元に戻して');
  hs=await page.evaluate(()=>window.__okaTest.selectedHoleState());
  if(!hs || !near(hs.center.x,0,0.05) || !near(hs.center.y,0,0.05) || !near(hs.diameter,6,0.08)){
    throw new Error('穴移動Undoで元位置へ戻らない: '+JSON.stringify(hs));
  }

  r=await night('穴中心をX=5mm、Y=-3mmに');
  hs=await page.evaluate(()=>window.__okaTest.selectedHoleState());
  if(!hs || !near(hs.center.x,5,0.05) || !near(hs.center.y,-3,0.05) || !near(hs.diameter,6,0.08)){
    throw new Error('穴中心絶対座標指定が不正: '+JSON.stringify(hs));
  }

  // Hole-axis movement must be rejected.
  const holeCursor=r.state.editCursor;
  r=await night('この穴を上へ2mm');
  if(r.state.editCursor!==holeCursor) throw new Error('穴軸方向Zへ移動してしまった');
  if(!r.reply.includes('軸方向')) throw new Error('穴軸方向拒否理由が不明: '+r.reply);

  // Moving outside the part must be rejected.
  const holeCursor2=r.state.editCursor;
  r=await night('この穴を右へ100mm');
  if(r.state.editCursor!==holeCursor2) throw new Error('外周を越える穴移動を実行してしまった');
  if(!r.reply.includes('外周')) throw new Error('外周安全拒否が不明: '+r.reply);


  // Real pointer drag test for hole movement.
  const dragPart=await page.evaluate(()=>window.__okaTest.addHolePlateFixture());
  const dragPatch=await page.evaluate(i=>window.__okaTest.firstMovableHolePatch(i),dragPart);
  if(dragPatch===null) throw new Error('指ドラッグ用の貫通穴を検出できない');
  await page.click('#faceModeBtn');
  await page.evaluate(([pi,fi])=>window.__okaTest.selectPatch(pi,fi),[dragPart,dragPatch]);
  await page.waitForTimeout(120);
  const dragBefore=await page.evaluate(()=>window.__okaTest.selectedHoleState());
  const pt=await page.evaluate(()=>window.__okaTest.selectedPatchScreenPoint());
  if(!pt) throw new Error('指ドラッグ開始点を取得できない');
  const enabled=await page.evaluate(()=>window.__okaTest.toggleTouchDrag());
  if(!enabled) throw new Error('指ドラッグ補助をONにできない');

  const canvas=page.locator('#viewer canvas');
  await canvas.dispatchEvent('pointerdown',{
    pointerId:71,pointerType:'touch',isPrimary:true,buttons:1,button:0,
    clientX:pt.x,clientY:pt.y
  });
  await canvas.dispatchEvent('pointermove',{
    pointerId:71,pointerType:'touch',isPrimary:true,buttons:1,button:0,
    clientX:pt.x+34,clientY:pt.y+12
  });
  await canvas.dispatchEvent('pointerup',{
    pointerId:71,pointerType:'touch',isPrimary:true,buttons:0,button:0,
    clientX:pt.x+34,clientY:pt.y+12
  });
  await page.waitForTimeout(250);

  const dragAfter=await page.evaluate(()=>window.__okaTest.selectedHoleState());
  const dragState=await page.evaluate(()=>window.__okaTest.state());
  if(!dragAfter) throw new Error('ドラッグ後に穴を再認識できない');
  const moved=Math.hypot(
    dragAfter.center.x-dragBefore.center.x,
    dragAfter.center.y-dragBefore.center.y,
    dragAfter.center.z-dragBefore.center.z
  );
  if(moved<0.3) throw new Error('実ポインタードラッグで穴が移動していない: '+moved);
  if(!near(dragAfter.diameter,dragBefore.diameter,0.08)){
    throw new Error('指ドラッグで穴径が変わった');
  }
  if(dragState.lastCommand?.type!=='holeMove' || dragState.lastCommand?.inputMethod!=='night-hole-move'){
    throw new Error('指ドラッグがholeMoveとして確定されていない: '+JSON.stringify(dragState.lastCommand));
  }

  if(errors.length) throw new Error(errors.join('\n'));
  console.log('AI_V3_1_PASS: base / round-bar / hole move / real touch pointer drag / undo / safety');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
