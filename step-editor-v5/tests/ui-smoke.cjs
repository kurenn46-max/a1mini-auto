const { chromium } = require('playwright');

function near(a,b,eps=1e-3){ return Math.abs(a-b)<=eps; }

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---------- Test 1: basic axis behavior on a simple box ----------
  {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const errors=[];
    page.on('pageerror',e=>errors.push('pageerror: '+e.message));
    page.on('console',msg=>{ if(msg.type()==='error') errors.push('console: '+msg.text()); });

    await page.goto('http://127.0.0.1:8000/step-editor-v5/?ui-smoke=1',{
      waitUntil:'networkidle',timeout:90000
    });
    await page.click('#addBoxBtn');
    await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');

    const initial=await page.evaluate(()=>window.__okaTest.state());
    if(!near(initial.partSize.x,40)||!near(initial.partSize.y,30)||!near(initial.partSize.z,10)){
      throw new Error('初期箱寸法が40x30x10ではない');
    }

    await page.click('#axisZCard');
    if(await page.locator('#applyAxisTargetBtn').isDisabled()) throw new Error('軸編集ボタンが無効');

    async function state(){ return await page.evaluate(()=>window.__okaTest.state()); }
    async function setTarget(mm){
      await page.locator('#axisTargetInput').fill(String(mm));
      await page.click('#applyAxisTargetBtn');
      await page.waitForTimeout(120);
    }
    async function undo(){
      await page.click('#axisUndoBtn');
      await page.waitForTimeout(100);
    }

    // -Z fixed -> +Z side grows.
    await page.click('#anchorMinBtn');
    await setTarget(20);
    let st=await state();
    if(!near(st.partSize.z,20)) throw new Error('−Z固定でZ20にならない: '+st.partSize.z);
    if(!near(st.partSize.x,40)||!near(st.partSize.y,30)) throw new Error('Z編集でX/Yが変化');
    if(!near(st.bounds.min.z,initial.bounds.min.z)) throw new Error('−Z固定なのに−Z端が動いた');
    if(!near(st.bounds.max.z,initial.bounds.max.z+10)) throw new Error('＋Z端が10mm動いていない');
    if(st.lastCommand?.mode!=='smart-stretch'||st.lastCommand?.bands?.length!==1||
       st.lastCommand.bands[0].side!=='max'){
      throw new Error('−Z固定がsmart-stretch max側になっていない');
    }
    await undo();

    // +Z fixed -> -Z side grows.
    await page.click('#anchorMaxBtn');
    await setTarget(20);
    st=await state();
    if(!near(st.partSize.z,20)) throw new Error('＋Z固定でZ20にならない');
    if(!near(st.bounds.max.z,initial.bounds.max.z)) throw new Error('＋Z固定なのに＋Z端が動いた');
    if(!near(st.bounds.min.z,initial.bounds.min.z-10)) throw new Error('−Z端が10mm動いていない');
    if(st.lastCommand?.bands?.length!==1||st.lastCommand.bands[0].side!=='min'){
      throw new Error('＋Z固定がsmart-stretch min側になっていない');
    }
    await undo();

    // Center fixed -> both ends move half.
    await page.click('#anchorCenterBtn');
    await setTarget(20);
    st=await state();
    if(!near(st.partSize.z,20)) throw new Error('中心固定でZ20にならない: '+st.partSize.z);
    if(!near(st.bounds.min.z,initial.bounds.min.z-5)||
       !near(st.bounds.max.z,initial.bounds.max.z+5)){
      throw new Error('中心固定で両端が5mmずつ動いていない');
    }
    if(st.lastCommand?.bands?.length!==2) throw new Error('中心固定が2バンドではない');
    await undo();

    st=await state();
    if(!near(st.partSize.x,40)||!near(st.partSize.y,30)||!near(st.partSize.z,10)){
      throw new Error('Undoで箱が元寸法へ戻らない');
    }
    if(errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }

  // ---------- Test 2: stepped + holed complex mesh ----------
  {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    const errors=[];
    page.on('pageerror',e=>errors.push('pageerror: '+e.message));
    page.on('console',msg=>{ if(msg.type()==='error') errors.push('console: '+msg.text()); });

    await page.goto('http://127.0.0.1:8000/step-editor-v5/?ui-smoke=1',{
      waitUntil:'networkidle',timeout:90000
    });

    await page.evaluate(()=>window.__okaTest.addSteppedPart());
    await page.waitForFunction(()=>document.querySelector('#partCount')?.textContent==='1');

    const beforeState=await page.evaluate(()=>window.__okaTest.state());
    const beforePos=await page.evaluate(()=>window.__okaTest.positions());
    const oldX=beforeState.partSize.x;

    // Grow X by 20 with -X fixed.
    await page.click('#axisXCard');
    await page.click('#anchorMinBtn');
    await page.locator('#axisTargetInput').fill(String(oldX+20));
    await page.click('#applyAxisTargetBtn');
    await page.waitForTimeout(150);

    const afterState=await page.evaluate(()=>window.__okaTest.state());
    const afterPos=await page.evaluate(()=>window.__okaTest.positions());
    const cmd=afterState.lastCommand;

    if(!near(afterState.partSize.x,oldX+20)) {
      throw new Error('段差形状のX寸法が+20にならない: '+afterState.partSize.x);
    }
    if(!near(afterState.partSize.y,beforeState.partSize.y) ||
       !near(afterState.partSize.z,beforeState.partSize.z)){
      throw new Error('Xスマート伸縮でY/Z寸法が変わった');
    }
    if(!near(afterState.bounds.min.x,beforeState.bounds.min.x)){
      throw new Error('−X固定なのに−X端が動いた');
    }
    if(!near(afterState.bounds.max.x,beforeState.bounds.max.x+20)){
      throw new Error('＋X端が20mm動いていない');
    }
    if(cmd?.mode!=='smart-stretch'||cmd?.bands?.length!==1||cmd.bands[0].side!=='max'){
      throw new Error('段差形状がsmart-stretch max側コマンドではない');
    }

    const band=cmd.bands[0];
    let fixedCount=0, rigidCount=0, transitionCount=0;
    for(let i=0;i<beforePos.length;i++){
      const bx=beforePos[i][0], ax=afterPos[i][0];
      const by=beforePos[i][1], ay=afterPos[i][1];
      const bz=beforePos[i][2], az=afterPos[i][2];
      if(!near(by,ay,1e-4)||!near(bz,az,1e-4)){
        throw new Error('X編集なのに頂点のY/Zが変化');
      }

      if(bx <= band.start-1e-5){
        fixedCount++;
        if(!near(ax,bx,1e-4)) throw new Error('固定側領域の頂点が動いた');
      }else if(bx >= band.end+1e-5){
        rigidCount++;
        if(!near(ax-bx,20,1e-3)) throw new Error('端側特徴が剛体移動していない');
      }else{
        transitionCount++;
        const d=ax-bx;
        if(d < -1e-4 || d > 20.0001){
          throw new Error('伸縮帯の変位が0〜20mm範囲外');
        }
      }
    }
    if(!fixedCount||!rigidCount){
      throw new Error('固定領域または形状維持端領域を確保できていない');
    }

    // The feature-preserving end region must remain rigid, which keeps its hole/R/step geometry.
    const movingIndices=[];
    for(let i=0;i<beforePos.length;i++){
      if(beforePos[i][0]>=band.end+1e-5) movingIndices.push(i);
    }
    if(movingIndices.length<2) throw new Error('形状維持端領域の頂点が少なすぎる');

    // Compare a sample of pairwise local distances inside the rigid moving end region.
    const sample=movingIndices.slice(0,Math.min(12,movingIndices.length));
    for(let a=0;a<sample.length;a++){
      for(let b=a+1;b<sample.length;b++){
        const i=sample[a],j=sample[b];
        const db=Math.hypot(
          beforePos[i][0]-beforePos[j][0],
          beforePos[i][1]-beforePos[j][1],
          beforePos[i][2]-beforePos[j][2]
        );
        const da=Math.hypot(
          afterPos[i][0]-afterPos[j][0],
          afterPos[i][1]-afterPos[j][1],
          afterPos[i][2]-afterPos[j][2]
        );
        if(!near(db,da,1e-3)) throw new Error('端側の段差/穴/R形状が変形した');
      }
    }

    // Undo exact restoration.
    await page.click('#axisUndoBtn');
    await page.waitForTimeout(120);
    const undoState=await page.evaluate(()=>window.__okaTest.state());
    const undoPos=await page.evaluate(()=>window.__okaTest.positions());
    if(!near(undoState.partSize.x,beforeState.partSize.x)||
       !near(undoState.partSize.y,beforeState.partSize.y)||
       !near(undoState.partSize.z,beforeState.partSize.z)){
      throw new Error('複雑形状Undoで寸法が戻らない');
    }
    for(let i=0;i<beforePos.length;i++){
      for(let k=0;k<3;k++){
        if(!near(beforePos[i][k],undoPos[i][k],1e-4)){
          throw new Error('複雑形状Undoで頂点が完全復元されない');
        }
      }
    }

    if(errors.length) throw new Error(errors.join('\n'));
    console.log(
      'SMART_STRETCH_PASS: box 3固定方式 + stepped/hole feature rigid preservation + no XY/Z collateral + Undo'
    );
    await page.close();
  }

  await browser.close();
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
