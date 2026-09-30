const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:412,height:915}});
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8000/oka-cad-next/", {waitUntil:"networkidle"});
  await page.waitForFunction(() => window.__OKACAD_NEXT_READY__ === true);
  await page.click("#demoBtn");
  await page.waitForFunction(() => document.querySelector("#partCount").textContent === "2");
  const canvas = await page.locator("#viewer canvas").count();
  if (canvas !== 1) throw new Error("viewer canvas missing");
  if (errors.length) throw new Error("page errors: " + errors.join(" | "));
  console.log("CAD NEXT UI smoke: OK");
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
