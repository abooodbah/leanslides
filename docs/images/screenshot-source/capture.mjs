// Captures the website screenshots from the real app. It starts
// LeanSlides.exe with community-garden-plan.pptx and a DevTools port,
// sizes the page to 1440x900, goes to slide 2, and saves
// site/assets/leanslides-window.png. Then it renders social-preview.html
// (which shows that capture) at 1280x640 into site/assets/social-preview.png.
//
//   node docs/images/screenshot-source/capture.mjs path\to\LeanSlides.exe
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const exe = resolve(process.argv[2] || join(root, "build", "Release", "LeanSlides.exe"));
const deck = join(here, "community-garden-plan.pptx");
const port = 9361;

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
  await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.locator('#stage [data-rendered-slide="0"]').waitFor({ timeout: 20000 });
  await page.keyboard.press("PageDown");
  await page.locator('#stage [data-rendered-slide="1"]').waitFor({ timeout: 20000 });
  // Let the thumbnails beside the slide finish drawing.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(root, "site", "assets", "leanslides-window.png") });

  const preview = await chromium.launch({ channel: "msedge", headless: true });
  const card = await preview.newPage({ viewport: { width: 1280, height: 640 } });
  await card.goto(pathToFileURL(join(here, "social-preview.html")).href);
  await card.waitForLoadState("load");
  await card.screenshot({ path: join(root, "site", "assets", "social-preview.png") });
  await preview.close();
  console.log("wrote site/assets/leanslides-window.png and site/assets/social-preview.png");
} finally {
  app.kill();
}
process.exit(0);
