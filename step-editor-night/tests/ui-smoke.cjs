const { chromium } = require('playwright');
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push('console: '+m.text());});

  await page.goto('http://127.0.0.1:8000/step-editor-night/?ui-smoke=1',{
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

  if(errors.length) throw new Error(errors.join('\n'));
  console.log('NIGHT_CMD_PASS: absolute / relative / anchor / match / undo / axis-off / fullwidth / conflict reject');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
