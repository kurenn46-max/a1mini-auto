const { chromium } = require('playwright');
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push('console: '+m.text());});

  await page.goto('http://127.0.0.1:8000/step-editor-ai-v1/?ui-smoke=1',{
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

  if(errors.length) throw new Error(errors.join('\n'));
  console.log('AI_V1_PASS: prompt resize / delete / undo / dimension clarity');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
