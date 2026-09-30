const { chromium } = require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8000/oka-cad-next/",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>window.__OKACAD_NEXT_READY__===true);
  await page.click("#demoBtn");
  await page.waitForFunction(()=>document.querySelector("#partCount").textContent==="2");

  const selected=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.selectFace(0,0,true));
  if(!selected)throw new Error("face selection failed");
  const dims=await page.locator("#faceDimsHud").innerText();
  if(!dims.includes("左右 X")||!dims.includes("前後 Y")||!dims.includes("上下 Z"))throw new Error("face dimension HUD missing");
  const vals=await page.evaluate(()=>[
    document.querySelector("#faceDimX").textContent,
    document.querySelector("#faceDimY").textContent,
    document.querySelector("#faceDimZ").textContent
  ]);
  if(vals.some(v=>v==="—"))throw new Error("face dimensions not populated");

  await page.click("#selectionLockBtn");
  const beforeSel=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getSelected());
  const attempt=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.selectFace(0,1,false));
  const afterSel=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getSelected());
  if(attempt!==false||beforeSel.patchIndex!==afterSel.patchIndex)throw new Error("selection lock failed");
  await page.click("#selectionLockBtn");

  await page.click("[data-normal-delta='0.5']");
  await page.click("#positionFixBtn");
  const fixed=await page.evaluate(()=>({
    fixed:window.__OKACAD_NEXT_TEST__.isFixed(),
    overlays:window.__OKACAD_NEXT_TEST__.fixedOverlayCount(),
    pos:window.__OKACAD_NEXT_TEST__.getPreview()
  }));
  if(!fixed.fixed||fixed.overlays<1)throw new Error("position fix failed");
  if(Math.abs(Math.hypot(fixed.pos.x,fixed.pos.y,fixed.pos.z)-0.5)>0.03)throw new Error("fixed position incorrect");

  const other=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.selectFace(0,1,true));
  if(!other)throw new Error("switch after fixed failed");
  const overlaysAfter=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.fixedOverlayCount());
  if(overlaysAfter<1)throw new Error("fixed overlay was not retained");

  if(errors.length)throw new Error("page errors: "+errors.join(" | "));
  console.log("CAD NEXT 0.3 LOCK + DIM smoke: OK");
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
