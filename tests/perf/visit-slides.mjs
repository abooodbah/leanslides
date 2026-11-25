// Goes through every slide of the deck open in a running LeanSlides, one
// Page Down at a time, waiting for each slide to be drawn; with WALKS, goes
// back to the first slide (Home) and does it again that many times in all.
// LeanSlides must
// have been started with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=PORT
// The keys are sent to the page through the DevTools protocol, not to the
// desktop, so nothing else on the screen receives them. Prints one JSON line:
// {"slides": n, "ms": total time}.
//
//   node tests/perf/visit-slides.mjs PORT [WALKS]
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(repository, "package.json"));
const { chromium } = require("playwright-core");
const port = Number(process.argv[2]);
const walks = Number(process.argv[3] || 1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let browser = null;
for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  if (!browser) await sleep(250);
}
if (!browser) throw new Error(`no DevTools port ${port}`);
let page = null;
for (let attempt = 0; attempt < 80 && !page; attempt += 1) {
  page = browser.contexts().flatMap((context) => context.pages()).find((p) => p.url().includes("reader.html")) || null;
  if (!page) await sleep(250);
}
if (!page) throw new Error("no reader page");
await page.locator("#stage [data-rendered-slide]").waitFor({ timeout: 30_000 });
const count = await page.evaluate(() => document.querySelectorAll(".thumb[data-slide]").length);
const started = Date.now();
for (let walk = 1; walk <= walks; walk += 1) {
  if (walk > 1) {
    await page.keyboard.press("Home");
    await page.locator('#stage [data-rendered-slide="0"]').waitFor({ timeout: 30_000 });
  }
  for (let slide = 1; slide < count; slide += 1) {
    await page.keyboard.press("PageDown");
    // locator().waitFor() keeps no handle. page.waitForSelector() returns an
    // element handle that DevTools keeps alive, which held every slide shown
    // and made memory grow by about 100 MiB per walk through this deck.
    await page.locator(`#stage [data-rendered-slide="${slide}"]`).waitFor({ timeout: 30_000 });
  }
}
console.log(JSON.stringify({ slides: count, walks, ms: Date.now() - started }));
// Leave without closing the browser: dropping the connection keeps the
// window open for the memory sample.
process.exit(0);
