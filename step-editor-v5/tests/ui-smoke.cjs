const { chromium } = require('playwright');
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];
  page.on('pageerror',e=>errors.push('pageerror: '+e.message));
  page.on('console',m=>{if(m.type()==='error') errors.push('console: '+m.text());});

  await page.goto('http://127.0.0.1:8000/step-editor-v5/?ui-smoke=1',{
    waitUntil:'networkidle',timeout:90000
  });

  await page.click('#addBoxBtn');
  await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');
  await page.click('#frontBtn');
  await page.waitForTimeout(120);

  const initial=await page.evaluate(()=>window.__okaTest.state());
  if(!near(initial.partSize.x,40)||!near(initial.partSize.y,30)||!near(initial.partSize.z,10)){
    throw new Error('初期箱寸法が40×30×10ではない');
  }

  // X means left/right everywhere.
  await page.click('#axisXCard');
  await page.waitForTimeout(100);

  const xCard=(await page.locator('#axisXCard span').innerText()).trim();
  if(xCard!=='X・左右') throw new Error('Xカードが左右表示ではない: '+xCard);

  const minXText=(await page.locator('#anchorMinBtn').innerText()).trim();
  const maxXText=(await page.locator('#anchorMaxBtn').innerText()).trim();
  if(!minXText.includes('左端固定')||!minXText.includes('−X')) throw new Error('−X固定が左端表示ではない');
  if(!maxXText.includes('右端固定')||!maxXText.includes('＋X')) throw new Error('＋X固定が右端表示ではない');

  const minusX=(await page.locator('.axisSignLabel.minus').innerText()).trim();
  const plusX=(await page.locator('.axisSignLabel.plus').innerText()).trim();
  if(minusX!=='−X 左'||plusX!=='＋X 右') throw new Error('Xの±ラベルが不正: '+minusX+' / '+plusX);

  const mx=await page.locator('.axisSignLabel.minus').boundingBox();
  const px=await page.locator('.axisSignLabel.plus').boundingBox();
  if(!mx||!px||!(mx.x<px.x)) throw new Error('正面表示で−Xが左、＋Xが右になっていない');

  async function setTarget(mm){
    await page.locator('#axisTargetInput').fill(String(mm));
    await page.click('#applyAxisTargetBtn');
    await page.waitForTimeout(140);
    return await page.evaluate(()=>window.__okaTest.state());
  }
  async function undo(){
    await page.click('#axisUndoBtn');
    await page.waitForTimeout(120);
  }

  // Left fixed -> right moves.
  await page.click('#anchorMinBtn');
  let st=await setTarget(60);
  if(!near(st.partSize.x,60)||!near(st.partSize.y,30)||!near(st.partSize.z,10)){
    throw new Error('左端固定X60の寸法結果が不正');
  }
  if(!near(st.bounds.min.x,initial.bounds.min.x)||!near(st.bounds.max.x,initial.bounds.max.x+20)){
    throw new Error('左端固定なのに左右の実移動が不正');
  }
  if(st.lastCommand?.mode!=='move-end-plane'||st.lastCommand?.moves?.length!==1||
     st.lastCommand.moves[0].side!=='max'){
    throw new Error('左端固定が右端move-end-planeになっていない');
  }
  await undo();

  // Right fixed -> left moves.
  await page.click('#anchorMaxBtn');
  st=await setTarget(60);
  if(!near(st.bounds.max.x,initial.bounds.max.x)||!near(st.bounds.min.x,initial.bounds.min.x-20)){
    throw new Error('右端固定なのに左右の実移動が不正');
  }
  if(st.lastCommand?.mode!=='move-end-plane'||st.lastCommand?.moves?.[0]?.side!=='min'){
    throw new Error('右端固定が左端move-end-planeになっていない');
  }
  await undo();

  // Center fixed -> both ends move equally.
  await page.click('#anchorCenterBtn');
  st=await setTarget(60);
  if(!near(st.bounds.min.x,initial.bounds.min.x-10)||!near(st.bounds.max.x,initial.bounds.max.x+10)){
    throw new Error('中心固定で左右10mmずつ動いていない');
  }
  if(st.lastCommand?.moves?.length!==2) throw new Error('中心固定が両端2移動ではない');
  await undo();

  // Z means up/down and replaces X signs completely.
  await page.click('#axisZCard');
  await page.waitForTimeout(100);
  const zCard=(await page.locator('#axisZCard span').innerText()).trim();
  if(zCard!=='Z・上下') throw new Error('Zカードが上下表示ではない');
  const minZText=(await page.locator('#anchorMinBtn').innerText()).trim();
  const maxZText=(await page.locator('#anchorMaxBtn').innerText()).trim();
  if(!minZText.includes('下端固定')||!minZText.includes('−Z')) throw new Error('−Z固定が下端表示ではない');
  if(!maxZText.includes('上端固定')||!maxZText.includes('＋Z')) throw new Error('＋Z固定が上端表示ではない');

  const minusZ=(await page.locator('.axisSignLabel.minus').innerText()).trim();
  const plusZ=(await page.locator('.axisSignLabel.plus').innerText()).trim();
  if(minusZ!=='−Z 下'||plusZ!=='＋Z 上') throw new Error('Zの±ラベルが不正: '+minusZ+' / '+plusZ);
  if((await page.locator('.axisSignLabel').allInnerTexts()).some(x=>x.includes('X'))){
    throw new Error('Zへ切替後もXの±表示が残っている');
  }

  const mz=await page.locator('.axisSignLabel.minus').boundingBox();
  const pz=await page.locator('.axisSignLabel.plus').boundingBox();
  if(!mz||!pz||!(mz.y>pz.y)) throw new Error('正面表示で−Zが下、＋Zが上になっていない');

  // Y wording is front/back.
  await page.click('#axisYCard');
  const yCard=(await page.locator('#axisYCard span').innerText()).trim();
  if(yCard!=='Y・前後') throw new Error('Yカードが前後表示ではない');
  if(!(await page.locator('#anchorMinBtn').innerText()).includes('手前固定')) throw new Error('−Yが手前固定ではない');
  if(!(await page.locator('#anchorMaxBtn').innerText()).includes('奥固定')) throw new Error('＋Yが奥固定ではない');

  if(errors.length) throw new Error(errors.join('\n'));
  console.log('AXIS_DIR_PASS: X左右 / Y前後 / Z上下 / 固定端実移動 / ±位置 / Undo');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
