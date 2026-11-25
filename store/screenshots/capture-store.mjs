// Captures the Microsoft Store screenshots (1920x1080) from the real app,
// showing docs/images/screenshot-source/community-garden-plan.pptx:
//   01-slides.png   slide 2 with the thumbnails
//   02-table.png    slide 4, the budget table, with speaker notes open
//   03-present.png  slide 1 in the slide show
//
//   node store/screenshots/capture-store.mjs path\to\LeanSlides.exe [deck.pptx]
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const exe = resolve(process.argv[2] || join(root, "build", "Release", "LeanSlides.exe"));
const deck = resolve(process.argv[3] || join(root, "docs", "images", "screenshot-source", "community-garden-plan.pptx"));
const port = 9362;

const app = spawn(exe, ["--", deck], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: "ignore",
});
try {
  let browser;
  for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!browser) throw new Error("LeanSlides did not open its DevTools port");
  const page = browser.contexts()[0].pages()[0];
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const slide = (n) => page.locator(`#stage [data-rendered-slide="${n}"]`).waitFor({ timeout: 20000 });
  await slide(0);
  await page.keyboard.press("PageDown");
  await slide(1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(here, "01-slides.png") });

  await page.keyboard.press("End");
  await slide(4);
  await page.keyboard.press("PageUp");
  await slide(3);
  await page.keyboard.press("Control+Shift+N");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(here, "02-table.png") });
  await page.keyboard.press("Control+Shift+N");

  await page.keyboard.press("Home");
  await slide(0);
  await page.keyboard.press("F5");
  await page.locator("html[data-presenting]").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(here, "03-present.png") });
  await page.keyboard.press("Escape");
  console.log("wrote 01-slides.png, 02-table.png, 03-present.png");
} finally {
  await closeApp(app);
}
process.exit(0);

// taskkill without /F asks the window to close, as its close button does, so
// WebView2 shuts its own processes down. A forced kill leaves them running on
// the profile folder, and the next start cannot use it.
async function closeApp(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((done) => child.once("exit", () => done(true)));
  spawn("taskkill", ["/PID", String(child.pid)], { stdio: "ignore" });
  if (!(await Promise.race([exited, new Promise((done) => setTimeout(() => done(false), 10000))]))) child.kill();
}
