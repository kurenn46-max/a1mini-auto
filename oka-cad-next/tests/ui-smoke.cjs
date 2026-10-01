const { chromium } = require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:412,height:915}});
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.goto("http://127.0.0.1:8000/oka-cad-next/",{waitUntil:"networkidle"});
  await page.waitForFunction(()=>window.__OKACAD_NEXT_READY__===true);
  await page.click("#demoBtn");
  await page.waitForFunction(()=>document.querySelector("#partCount").textContent==="2");

  await page.click("#touchModeBtn");
  await page.evaluate(()=>window.__OKACAD_NEXT_TEST__.selectTouchPart(1));

  const viewerBox=await page.locator(".viewerCard").boundingBox();
  const hudBox=await page.locator("#touchHud").boundingBox();
  if(!viewerBox||!hudBox)throw new Error("viewer or HUD missing");
  if(hudBox.height>120)throw new Error("touch HUD too tall: "+hudBox.height);
  if(hudBox.y < viewerBox.y + viewerBox.height*0.68)throw new Error("touch HUD covers too much CAD view");

  await page.click("#snapModeBtn");
  const snapBox=await page.locator("#touchHud").boundingBox();
  if(!snapBox||snapBox.height>120)throw new Error("snap panel too tall");

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
  const expected={x:target.center.x+target.normal.x*5,y:target.center.y+target.normal.y*5,z:target.center.z+target.normal.z*5};
  if(Math.max(Math.abs(snapped.x-expected.x),Math.abs(snapped.y-expected.y),Math.abs(snapped.z-expected.z))>0.02)throw new Error("snap math regression");

  if(errors.length)throw new Error("page errors: "+errors.join(" | "));
  console.log("CAD NEXT 0.7 VIEW FIRST smoke: OK");
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
