const { chromium } = require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8000/oka-cad-next/",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>window.__OKACAD_NEXT_READY__===true);
  await page.click("#demoBtn");
  await page.waitForFunction(()=>document.querySelector("#partCount").textContent==="2");

  // Existing planar body move still works.
  let face=-1;
  for(let i=0;i<12;i++){
    const ok=await page.evaluate(i=>window.__OKACAD_NEXT_TEST__.selectFace(0,i,true),i);
    if(!ok)break;
    if(await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.isEditable())){face=i;break;}
  }
  if(face<0)throw new Error("no editable planar face");
  const before=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartSize(0));
  await page.click("[data-normal-delta='0.5']");
  const after=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartSize(0));
  const sizeDelta=Math.max(Math.abs(after.x-before.x),Math.abs(after.y-before.y),Math.abs(after.z-before.z));
  if(Math.abs(sizeDelta-0.5)>0.04)throw new Error("body move regression");

  // Group two parts and move together.
  await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.setMode("group"));
  await page.evaluate(()=>{window.__OKACAD_NEXT_TEST__.toggleGroupPart(0);window.__OKACAD_NEXT_TEST__.toggleGroupPart(1);window.__OKACAD_NEXT_TEST__.makeGroup();});
  const count=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getGroupCount());
  if(count!==2)throw new Error("group creation failed");

  const p0=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartPos(0));
  const p1=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartPos(1));
  const rel0={x:p1.x-p0.x,y:p1.y-p0.y,z:p1.z-p0.z};

  await page.fill("#groupMoveAmount","5");
  await page.click("[data-group-axis='x'][data-group-sign='1']");

  const q0=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartPos(0));
  const q1=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartPos(1));
  if(Math.abs((q0.x-p0.x)-5)>0.001||Math.abs((q1.x-p1.x)-5)>0.001)throw new Error("group X move failed");
  const rel1={x:q1.x-q0.x,y:q1.y-q0.y,z:q1.z-q0.z};
  if(Math.max(Math.abs(rel1.x-rel0.x),Math.abs(rel1.y-rel0.y),Math.abs(rel1.z-rel0.z))>0.001)throw new Error("relative positions changed");

  await page.click("#groupUndoBtn");
  const u0=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartPos(0));
  const u1=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartPos(1));
  if(Math.max(Math.abs(u0.x-p0.x),Math.abs(u0.y-p0.y),Math.abs(u0.z-p0.z),Math.abs(u1.x-p1.x),Math.abs(u1.y-p1.y),Math.abs(u1.z-p1.z))>0.001)throw new Error("group undo failed");

  if(errors.length)throw new Error("page errors: "+errors.join(" | "));
  console.log("CAD NEXT 0.5 GROUP MOVE smoke: OK");
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
