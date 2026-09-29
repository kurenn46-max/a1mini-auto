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

  // 1) Simple box: all three fixed-side modes, exact dimensions, undo.
  {
    const {page,errors}=await openPage();
    await page.click('#addBoxBtn');
    await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');
    const initial=await page.evaluate(()=>window.__okaTest.state());

    if(!near(initial.partSize.x,40)||!near(initial.partSize.y,30)||!near(initial.partSize.z,10)){
      throw new Error('初期箱寸法が40×30×10ではない');
    }

    await page.click('#axisZCard');
    if(await page.locator('#applyAxisTargetBtn').isDisabled()) throw new Error('軸編集ボタンが無効');

    async function setTarget(mm){
      await page.locator('#axisTargetInput').fill(String(mm));
      await page.click('#applyAxisTargetBtn');
      await page.waitForTimeout(120);
      return await page.evaluate(()=>window.__okaTest.state());
    }
    async function undo(){
      await page.click('#axisUndoBtn');
      await page.waitForTimeout(100);
    }

    await page.click('#anchorMinBtn');
    let st=await setTarget(20);
    if(!near(st.partSize.z,20)||!near(st.partSize.x,40)||!near(st.partSize.y,30)){
      throw new Error('−Z固定の寸法結果が不正');
    }
    if(!near(st.bounds.min.z,initial.bounds.min.z)||!near(st.bounds.max.z,initial.bounds.max.z+10)){
      throw new Error('−Z固定の端位置が不正');
    }
    if(st.lastCommand?.mode!=='cut-stretch'||st.lastCommand?.cuts?.length!==1||
       st.lastCommand.cuts[0].side!=='max'){
      throw new Error('−Z固定がcut-stretch max側ではない');
    }
    await undo();

    await page.click('#anchorMaxBtn');
    st=await setTarget(20);
    if(!near(st.partSize.z,20)||
       !near(st.bounds.max.z,initial.bounds.max.z)||
       !near(st.bounds.min.z,initial.bounds.min.z-10)){
      throw new Error('＋Z固定の結果が不正');
    }
    if(st.lastCommand?.mode!=='cut-stretch'||st.lastCommand?.cuts?.length!==1||
       st.lastCommand.cuts[0].side!=='min'){
      throw new Error('＋Z固定がcut-stretch min側ではない');
    }
    await undo();

    await page.click('#anchorCenterBtn');
    st=await setTarget(20);
    if(!near(st.partSize.z,20)||
       !near(st.bounds.min.z,initial.bounds.min.z-5)||
       !near(st.bounds.max.z,initial.bounds.max.z+5)){
      throw new Error('中心固定で両端が5mmずつ動いていない');
    }
    if(st.lastCommand?.mode!=='cut-stretch'||st.lastCommand?.cuts?.length!==2){
      throw new Error('中心固定が2断面cut-stretchではない');
    }
    await undo();

    st=await page.evaluate(()=>window.__okaTest.state());
    if(!near(st.partSize.x,40)||!near(st.partSize.y,30)||!near(st.partSize.z,10)){
      throw new Error('Undoで箱が元寸法に戻らない');
    }

    const plus=(await page.locator('.axisSignLabel.plus').innerText()).trim();
    const minus=(await page.locator('.axisSignLabel.minus').innerText()).trim();
    if(plus!=='＋Z'||minus!=='−Z') throw new Error('±Z表示が不正');

    if(errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }

  // 2) Dense end-feature geometry: both end features must move rigidly.
  {
    const {page,errors}=await openPage();
    await page.evaluate(()=>window.__okaTest.addDenseFeaturePart());
    await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');

    const before=await page.evaluate(()=>window.__okaTest.state());
    const p0=await page.evaluate(()=>window.__okaTest.positions());
    const oldX=before.partSize.x;

    await page.click('#axisXCard');
    await page.click('#anchorCenterBtn');
    await page.locator('#axisTargetInput').fill(String(oldX+20));
    await page.click('#applyAxisTargetBtn');
    await page.waitForTimeout(140);

    const after=await page.evaluate(()=>window.__okaTest.state());
    const p1=await page.evaluate(()=>window.__okaTest.positions());
    const cmd=after.lastCommand;

    if(!near(after.partSize.x,oldX+20)||
       !near(after.partSize.y,before.partSize.y)||
       !near(after.partSize.z,before.partSize.z)){
      throw new Error('端特徴付き形状のX伸長で外形寸法が不正: '+JSON.stringify({before,after,cmd}));
    }
    if(cmd?.mode!=='cut-stretch'||cmd?.cuts?.length!==2){
      throw new Error('端特徴付き形状が中心2断面cut-stretchになっていない');
    }

    const cuts=[...cmd.cuts].sort((a,b)=>a.q-b.q);
    const left=cuts[0], right=cuts[1];
    const leftIds=[],rightIds=[];
    for(let i=0;i<p0.length;i++){
      const [x0,y0,z0]=p0[i], [x1,y1,z1]=p1[i];
      if(!near(y0,y1,1e-4)||!near(z0,z1,1e-4)){
        throw new Error('X編集なのにY/Z頂点が変化');
      }
      if(x0<left.q-1e-7){
        leftIds.push(i);
        if(!near(x1-x0,-10,1e-3)) throw new Error('左端特徴が剛体−10mm移動していない');
      }else if(x0>right.q+1e-7){
        rightIds.push(i);
        if(!near(x1-x0,10,1e-3)) throw new Error('右端特徴が剛体＋10mm移動していない');
      }else{
        if(!near(x1,x0,1e-4)) throw new Error('中央固定領域の頂点が動いた');
      }
    }
    if(!leftIds.length||!rightIds.length) throw new Error('左右端の剛体領域が取れていない');

    // Local distances inside each moved end region must remain exactly unchanged.
    for(const ids of [leftIds.slice(0,20),rightIds.slice(0,20)]){
      for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++){
        const i=ids[a],j=ids[b];
        const d0=Math.hypot(
          p0[i][0]-p0[j][0],p0[i][1]-p0[j][1],p0[i][2]-p0[j][2]);
        const d1=Math.hypot(
          p1[i][0]-p1[j][0],p1[i][1]-p1[j][1],p1[i][2]-p1[j][2]);
        if(!near(d0,d1,1e-3)) throw new Error('端側の段差/ボス形状が変形した');
      }
    }

    await page.click('#axisUndoBtn');
    await page.waitForTimeout(120);
    const undo=await page.evaluate(()=>window.__okaTest.state());
    const pu=await page.evaluate(()=>window.__okaTest.positions());
    if(!near(undo.partSize.x,before.partSize.x)||
       !near(undo.partSize.y,before.partSize.y)||
       !near(undo.partSize.z,before.partSize.z)){
      throw new Error('端特徴付き形状Undoで寸法が戻らない');
    }
    for(let i=0;i<p0.length;i++) for(let k=0;k<3;k++){
      if(!near(p0[i][k],pu[i][k],1e-4)) throw new Error('Undoで頂点が完全復元されない');
    }

    if(errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }

  // 3) Coarse stepped + holed mesh: unsafe geometry must be refused, not corrupted.
  {
    const {page,errors}=await openPage();
    await page.evaluate(()=>window.__okaTest.addSteppedPart());
    await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');

    const before=await page.evaluate(()=>window.__okaTest.state());
    const p0=await page.evaluate(()=>window.__okaTest.positions());
    await page.click('#axisXCard');
    await page.click('#anchorCenterBtn');
    await page.locator('#axisTargetInput').fill(String(before.partSize.x+20));
    await page.click('#applyAxisTargetBtn');
    await page.waitForTimeout(140);

    const after=await page.evaluate(()=>window.__okaTest.state());
    const p1=await page.evaluate(()=>window.__okaTest.positions());

    if(after.editCursor!==0||after.lastCommand!==null){
      throw new Error('危険形状なのに編集コマンドが確定された');
    }
    if(!near(after.partSize.x,before.partSize.x)||
       !near(after.partSize.y,before.partSize.y)||
       !near(after.partSize.z,before.partSize.z)){
      throw new Error('拒否した危険形状が変形している');
    }
    for(let i=0;i<p0.length;i++) for(let k=0;k<3;k++){
      if(!near(p0[i][k],p1[i][k],1e-4)) throw new Error('拒否後に頂点が変わっている');
    }

    const status=(await page.locator('#statusText').innerText()).trim();
    if(!status.includes('安全') && !status.includes('潰れる')){
      throw new Error('危険編集の拒否理由が表示されない: '+status);
    }

    if(errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }

  console.log('CUT_STRETCH_PASS: 3固定方式 / 端特徴を剛体保持 / 他軸不変 / 危険形状を無変更で拒否 / Undo完全復元');
  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
