const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8000/oka-cad-next/",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>window.__OKACAD_NEXT_READY__===true);

  await page.click("#demoBtn");
  await page.waitForFunction(()=>document.querySelector("#partCount").textContent==="2");
  if(await page.locator("#viewer canvas").count()!==1) throw new Error("viewer canvas missing");

  const labels=await page.locator(".axisGuide").innerText();
  if(!labels.includes("左右 = X")||!labels.includes("前後 = Y")||!labels.includes("上下 = Z")) throw new Error("axis guide missing");

  const selected=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.selectFirstFace());
  if(!selected) throw new Error("face selection failed");
  await page.waitForFunction(()=>!document.querySelector("[data-normal-delta='0.5']").disabled);

  const before=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPreview());
  await page.click("[data-normal-delta='0.5']");
  const after=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPreview());
  const dist=Math.hypot(after.x-before.x,after.y-before.y,after.z-before.z);
  if(Math.abs(dist-0.5)>0.02) throw new Error("easy outward move failed: "+dist);

  await page.click("#undoBtn");
  const undone=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPreview());
  if(Math.hypot(undone.x,undone.y,undone.z)>0.02) throw new Error("undo failed");

  await page.fill("#moveAmount","2");
  await page.click("#customOutBtn");
  const custom=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPreview());
  if(Math.abs(Math.hypot(custom.x,custom.y,custom.z)-2)>0.03) throw new Error("custom move failed");

  if(errors.length) throw new Error("page errors: "+errors.join(" | "));
  console.log("CAD NEXT 0.2 EASY smoke: OK");
  await browser.close();
})().catch(err=>{console.error(err);process.exit(1);});
