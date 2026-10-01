const { chromium } = require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8000/oka-cad-next/",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>window.__OKACAD_NEXT_READY__===true);
  await page.click("#demoBtn");
  await page.waitForFunction(()=>document.querySelector("#partCount").textContent==="2");

  // Touch move mode exists and can select whole part.
  await page.click("#touchModeBtn");
  await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.selectTouchPart(1));
  const hud=await page.locator("#touchHud").innerText();
  if(!hud.includes("デモ丸棒")||!hud.includes("長押し"))throw new Error("touch move HUD missing");

  const before=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartCenter(1));
  await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.moveTouchPartBy(1,3,4,0));
  const moved=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartCenter(1));
  if(Math.abs((moved.x-before.x)-3)>0.001||Math.abs((moved.y-before.y)-4)>0.001)throw new Error("whole-part touch movement core failed");

  // Find a planar face on box and snap moving part center to face center + 5 mm normal.
  let face=-1,target=null;
  for(let i=0;i<12;i++){
    const f=await page.evaluate(i=>window.__OKACAD_NEXT_TEST__.getFaceTarget(0,i),i);
    if(!f)break;
    if(f.type==="平面"){face=i;target=f;break;}
  }
  if(face<0)throw new Error("no planar snap target");
  const ok=await page.evaluate(({face})=>window.__OKACAD_NEXT_TEST__.applySnapToFace(1,0,face,5),{face});
  if(!ok)throw new Error("snap failed");
  const snapped=await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getPartCenter(1));
  const expected={
    x:target.center.x+target.normal.x*5,
    y:target.center.y+target.normal.y*5,
    z:target.center.z+target.normal.z*5
  };
  if(Math.max(Math.abs(snapped.x-expected.x),Math.abs(snapped.y-expected.y),Math.abs(snapped.z-expected.z))>0.02)throw new Error("snap center/offset incorrect: "+JSON.stringify({snapped,expected}));

  // Group move still works.
  await page.evaluate(()=>{window.__OKACAD_NEXT_TEST__.setMode("group");window.__OKACAD_NEXT_TEST__.toggleGroupPart(0);window.__OKACAD_NEXT_TEST__.toggleGroupPart(1);window.__OKACAD_NEXT_TEST__.makeGroup();});
  if(await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.getGroupCount())!==2)throw new Error("group regression");

  if(errors.length)throw new Error("page errors: "+errors.join(" | "));
  console.log("CAD NEXT 0.6 TOUCH + SNAP smoke: OK");
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
