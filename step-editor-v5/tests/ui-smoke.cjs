const { chromium } = require('playwright');
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;

(async()=>{
  const browser=await chromium.launch({headless:true});

  async function openPage(){
    const page=await browser.newPage({viewport:{width:412,height:915}});
    const errors=[];
    page.on('pageerror',e=>errors.push('pageerror: '+e.message));
    page.on('console',m=>{if(m.type()==='error') errors.push('console: '+m.text());});
    await page.goto('http://127.0.0.1:8000/step-editor-v5/?ui-smoke=1',{
      waitUntil:'networkidle',timeout:90000
    });
    return {page,errors};
  }

  // 1) Axis OFF + X safe stretch on simple box.
  {
    const {page,errors}=await openPage();

    await page.click('#addBoxBtn');
    await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');
    await page.click('#frontBtn');
    await page.waitForTimeout(120);

    const initial=await page.evaluate(()=>window.__okaTest.state());
    if(!near(initial.partSize.x,40)||!near(initial.partSize.y,30)||!near(initial.partSize.z,10)){
      throw new Error('初期箱寸法が40×30×10ではない');
    }

    // Select X.
    await page.click('#axisXCard');
    await page.waitForTimeout(100);
    if(!(await page.locator('#axisXCard').evaluate(el=>el.classList.contains('active')))){
      throw new Error('X軸が選択状態にならない');
    }
    if((await page.locator('.axisSignLabel').count())!==2){
      throw new Error('X選択時に±表示が2個出ない');
    }

    // Tap X again -> true no-axis state.
    await page.click('#axisXCard');
    await page.waitForTimeout(100);
    if(await page.locator('#axisXCard').evaluate(el=>el.classList.contains('active'))){
      throw new Error('同じXを再タップしても軸解除されない');
    }
    if((await page.locator('.axisSignLabel').count())!==0){
      throw new Error('軸解除後も±表示が残る');
    }
    if(!(await page.locator('#axisEditBadge').innerText()).includes('未選択')){
      throw new Error('軸解除後のバッジが未選択ではない');
    }
    if(!(await page.locator('#applyAxisTargetBtn').isDisabled())){
      throw new Error('軸解除後も寸法確定ボタンが有効');
    }

    // Re-select X and verify labels.
    await page.click('#axisXCard');
    const xCard=(await page.locator('#axisXCard span').innerText()).trim();
    if(xCard!=='X・左右') throw new Error('Xカードが左右表示ではない: '+xCard);
    const minusX=(await page.locator('.axisSignLabel.minus').innerText()).trim();
    const plusX=(await page.locator('.axisSignLabel.plus').innerText()).trim();
    if(minusX!=='−X 左'||plusX!=='＋X 右') throw new Error('Xの±表示が不正');

    async function setTarget(mm){
      await page.locator('#axisTargetInput').fill(String(mm));
      await page.click('#applyAxisTargetBtn');
      await page.waitForTimeout(150);
      return await page.evaluate(()=>window.__okaTest.state());
    }
    async function undo(){
      await page.click('#axisUndoBtn');
      await page.waitForTimeout(120);
    }

    // Left fixed -> right side safe cut stretch.
    await page.click('#anchorMinBtn');
    let st=await setTarget(60);
    if(!near(st.partSize.x,60)||!near(st.partSize.y,30)||!near(st.partSize.z,10)){
      throw new Error('左端固定X60の外形寸法が不正');
    }
    if(!near(st.bounds.min.x,initial.bounds.min.x)||!near(st.bounds.max.x,initial.bounds.max.x+20)){
      throw new Error('左端固定の実移動が不正');
    }
    if(st.lastCommand?.mode!=='cut-stretch'||st.lastCommand?.cuts?.length!==1||
       st.lastCommand.cuts[0].side!=='max'){
      throw new Error('X左端固定がcut-stretch max側になっていない');
    }
    await undo();

    // Right fixed -> left side safe cut stretch.
    await page.click('#anchorMaxBtn');
    st=await setTarget(60);
    if(!near(st.bounds.max.x,initial.bounds.max.x)||!near(st.bounds.min.x,initial.bounds.min.x-20)){
      throw new Error('右端固定の実移動が不正');
    }
    if(st.lastCommand?.mode!=='cut-stretch'||st.lastCommand?.cuts?.[0]?.side!=='min'){
      throw new Error('X右端固定がcut-stretch min側になっていない');
    }
    await undo();

    // Center fixed -> both sides move 10.
    await page.click('#anchorCenterBtn');
    st=await setTarget(60);
    if(!near(st.bounds.min.x,initial.bounds.min.x-10)||!near(st.bounds.max.x,initial.bounds.max.x+10)){
      throw new Error('中心固定で左右10mmずつ動いていない');
    }
    if(st.lastCommand?.mode!=='cut-stretch'||st.lastCommand?.cuts?.length!==2){
      throw new Error('X中心固定が2断面cut-stretchではない');
    }
    await undo();

    // Z still switches cleanly and X signs disappear.
    await page.click('#axisZCard');
    if((await page.locator('.axisSignLabel').allInnerTexts()).some(x=>x.includes('X'))){
      throw new Error('Zへ切替後もXの±表示が残る');
    }
    if(!(await page.locator('#anchorMinBtn').innerText()).includes('下端固定')) throw new Error('−Zが下端固定ではない');
    if(!(await page.locator('#anchorMaxBtn').innerText()).includes('上端固定')) throw new Error('＋Zが上端固定ではない');

    if(errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }

  // 2) Feature-rich end geometry: X stretch must not create a new step at the ends.
  {
    const {page,errors}=await openPage();
    await page.evaluate(()=>window.__okaTest.addDenseFeaturePart());
    await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');

    const before=await page.evaluate(()=>window.__okaTest.state());
    const p0=await page.evaluate(()=>window.__okaTest.positions());

    await page.click('#axisXCard');
    await page.click('#anchorCenterBtn');
    await page.locator('#axisTargetInput').fill(String(before.partSize.x+20));
    await page.click('#applyAxisTargetBtn');
    await page.waitForTimeout(160);

    const after=await page.evaluate(()=>window.__okaTest.state());
    const p1=await page.evaluate(()=>window.__okaTest.positions());
    const cmd=after.lastCommand;

    if(cmd?.mode!=='cut-stretch'||cmd?.cuts?.length!==2){
      throw new Error('特徴付き形状のX編集がcut-stretchではない');
    }
    if(!near(after.partSize.x,before.partSize.x+20)||
       !near(after.partSize.y,before.partSize.y)||
       !near(after.partSize.z,before.partSize.z)){
      throw new Error('特徴付き形状でX以外の寸法が変化');
    }

    const cuts=[...cmd.cuts].sort((a,b)=>a.q-b.q);
    const left=cuts[0], right=cuts[1];
    const leftIds=[],rightIds=[];
    for(let i=0;i<p0.length;i++){
      const [x0,y0,z0]=p0[i], [x1,y1,z1]=p1[i];
      if(!near(y0,y1,1e-4)||!near(z0,z1,1e-4)){
        throw new Error('X編集でY/Z頂点が動いた');
      }
      if(x0<left.q-1e-7){
        leftIds.push(i);
        if(!near(x1-x0,-10,1e-3)) throw new Error('左端形状が剛体移動していない');
      }else if(x0>right.q+1e-7){
        rightIds.push(i);
        if(!near(x1-x0,10,1e-3)) throw new Error('右端形状が剛体移動していない');
      }else{
        if(!near(x1,x0,1e-4)) throw new Error('中央固定領域が動いた');
      }
    }
    if(!leftIds.length||!rightIds.length) throw new Error('端形状領域を取得できない');

    // End-shape pairwise distances must remain unchanged.
    for(const ids of [leftIds.slice(0,24),rightIds.slice(0,24)]){
      for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++){
        const i=ids[a],j=ids[b];
        const d0=Math.hypot(
          p0[i][0]-p0[j][0],p0[i][1]-p0[j][1],p0[i][2]-p0[j][2]);
        const d1=Math.hypot(
          p1[i][0]-p1[j][0],p1[i][1]-p1[j][1],p1[i][2]-p1[j][2]);
        if(!near(d0,d1,1e-3)) throw new Error('端側形状に新しい段差/変形が発生');
      }
    }

    await page.click('#axisUndoBtn');
    await page.waitForTimeout(120);
    const undo=await page.evaluate(()=>window.__okaTest.state());
    if(!near(undo.partSize.x,before.partSize.x)||
       !near(undo.partSize.y,before.partSize.y)||
       !near(undo.partSize.z,before.partSize.z)){
      throw new Error('Undoで元寸法へ戻らない');
    }

    if(errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }

  console.log('V563_PASS: axis-off / X safe cut-stretch / end features rigid / other axes unchanged / Undo');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
