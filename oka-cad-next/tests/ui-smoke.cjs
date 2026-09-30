const { chromium } = require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8000/oka-cad-next/",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>window.__OKACAD_NEXT_READY__===true);
  await page.click("#demoBtn");
  await page.waitForFunction(()=>document.querySelector("#partCount").textContent==="2");

  let face=-1;
  for(let i=0;i<12;i++){
    const ok=await page.evaluate(i=>window.__OKACAD_NEXT_TEST__.selectFace(0,i,true),i);
    if(!ok)break;
    const editable=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.isEditable());
    if(editable){face=i;break;}
  }
  if(face<0)throw new Error("no editable planar face");

  const dims=await page.locator("#faceDimsHud").innerText();
  if(!dims.includes("左右 X")||!dims.includes("前後 Y")||!dims.includes("上下 Z"))throw new Error("face dimension HUD missing");

  const before=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartSize(0));
  await page.click("[data-normal-delta='0.5']");
  const after=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartSize(0));
  const sizeDelta=Math.max(Math.abs(after.x-before.x),Math.abs(after.y-before.y),Math.abs(after.z-before.z));
  if(Math.abs(sizeDelta-0.5)>0.04)throw new Error("body did not deform with face: "+JSON.stringify({before,after}));

  await page.click("#undoBtn");
  const undone=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartSize(0));
  if(Math.max(Math.abs(undone.x-before.x),Math.abs(undone.y-before.y),Math.abs(undone.z-before.z))>0.04)throw new Error("body undo failed");

  await page.click("[data-normal-delta='0.5']");
  await page.click("#positionFixBtn");
  const committed=await page.evaluate(()=>({fixed:window.__OKACAD_NEXT_TEST__.isFixed(),size:window.__OKACAD_NEXT_TEST__.getPartSize(0)}));
  if(!committed.fixed)throw new Error("position commit failed");

  let other=-1;
  for(let i=0;i<12;i++){
    if(i===face)continue;
    const ok=await page.evaluate(i=>window.__OKACAD_NEXT_TEST__.selectFace(0,i,true),i);
    if(ok){other=i;break;}
  }
  if(other<0)throw new Error("could not switch face");
  const retained=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartSize(0));
  if(Math.max(Math.abs(retained.x-committed.size.x),Math.abs(retained.y-committed.size.y),Math.abs(retained.z-committed.size.z))>0.04)throw new Error("committed body shape was not retained");

  await page.click("#selectionLockBtn");
  const beforeSel=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getSelected());
  const attempt=await page.evaluate(faceIndex=>window.__OKACAD_NEXT_TEST__.selectFace(0,faceIndex,false),face);
  const afterSel=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getSelected());
  if(attempt!==false||beforeSel.patchIndex!==afterSel.patchIndex)throw new Error("selection lock failed");

  if(errors.length)throw new Error("page errors: "+errors.join(" | "));
  console.log("CAD NEXT 0.4 BODY MOVE smoke: OK");
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
