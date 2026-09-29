const { chromium } = require('playwright');
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;
const num=async (page,id)=>Number((await page.locator(id).innerText()).replace(/[^0-9.+-]/g,''));

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push('console: '+m.text());});

  await page.goto('http://127.0.0.1:8000/step-editor-v5/?ui-smoke=1',{
    waitUntil:'networkidle',timeout:90000
  });

  // One box: total and selected-part happen to be equal, and UI must say why.
  await page.click('#addBoxBtn');
  await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');
  if(!near(await num(page,'#totalSizeX'),40)||!near(await num(page,'#sizeX'),40)){
    throw new Error('1部品時の全体X/選択部品Xが40ではない');
  }
  const oneNote=(await page.locator('#sizeScopeNote').innerText()).trim();
  if(!oneNote.includes('1部品')||!oneNote.includes('選択部品サイズ＝全体サイズ')){
    throw new Error('1部品時に全体=部品の説明が出ない: '+oneNote);
  }

  // Add a second, different-sized part. Selected is the cylinder.
  await page.click('#addCylinderBtn');
  await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='2');
  if(!near(await num(page,'#totalSizeX'),40)) throw new Error('2部品時の全体Xが40ではない');
  if(!near(await num(page,'#sizeX'),20)) throw new Error('選択円柱のXが20ではない');
  if((await page.locator('#sizeScopeNote').innerText()).includes('＝全体サイズ')){
    throw new Error('2部品なのに選択部品=全体と表示している');
  }

  // Move selected cylinder far right: overall grows, selected-part dimensions stay 20.
  await page.locator('#posX').fill('100');
  await page.click('#applyPosBtn');
  await page.waitForTimeout(120);

  const totalAfterMove=await num(page,'#totalSizeX');
  const selectedAfterMove=await num(page,'#sizeX');
  if(!near(totalAfterMove,130)) throw new Error('円柱移動後の全体Xが130ではない: '+totalAfterMove);
  if(!near(selectedAfterMove,20)) throw new Error('円柱移動で選択部品Xが20から変化: '+selectedAfterMove);

  // Select box: selected-part cards must switch to box 40×30×10, total remains 130.
  await page.locator('.partRow[data-index="0"] .selectBtn').click();
  await page.waitForTimeout(100);
  if(!near(await num(page,'#totalSizeX'),130)) throw new Error('箱選択で全体Xが変わった');
  if(!near(await num(page,'#sizeX'),40)||
     !near(await num(page,'#sizeY'),30)||
     !near(await num(page,'#sizeZ'),10)){
    throw new Error('箱選択時の選択部品サイズが40×30×10ではない');
  }
  const multiNote=(await page.locator('#sizeScopeNote').innerText()).trim();
  if(!multiNote.includes('Box')||!multiNote.includes('全体サイズとは別')){
    throw new Error('複数部品時の編集対象説明が不明確: '+multiNote);
  }

  // Axis edit must act on selected box only, while whole model remains determined by remote cylinder.
  await page.click('#axisXCard');
  await page.click('#anchorMinBtn');
  await page.locator('#axisTargetInput').fill('60');
  await page.click('#applyAxisTargetBtn');
  await page.waitForTimeout(160);

  const st=await page.evaluate(()=>window.__okaTest.state());
  if(!near(st.partSize.x,60)||!near(st.partSize.y,30)||!near(st.partSize.z,10)){
    throw new Error('軸編集が選択箱だけに反映されていない: '+JSON.stringify(st.partSize));
  }
  if(!near(st.modelSize.x,130)){
    throw new Error('選択箱の編集で全体Xが意図せず変わった: '+st.modelSize.x);
  }
  if(!near(await num(page,'#sizeX'),60)) throw new Error('編集後の選択部品Xカードが60ではない');
  if(!near(await num(page,'#totalSizeX'),130)) throw new Error('編集後の全体Xカードが130ではない');

  // Axis OFF must still work.
  await page.click('#axisXCard');
  await page.waitForTimeout(80);
  if((await page.locator('.axisSignLabel').count())!==0) throw new Error('軸解除後も±表示が残る');
  if(!(await page.locator('#axisEditBadge').innerText()).includes('未選択')) throw new Error('軸解除後が未選択表示ではない');

  if(errors.length) throw new Error(errors.join('\n'));
  console.log('V564_PASS: total-size vs selected-part-size split / selected-only axis edit / axis-off');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
