// A fake LeanSlides host for reader tests in a browser. It serves assets/ at
// https://app.leanslides.invalid/, answers the deck addresses the Windows
// host answers (docs/HOST.md) from leanslides-inspect output, refuses and
// records every other request, stands in for the WebView2 bridge, and
// records Content Security Policy violations.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

export const ORIGIN = "https://app.leanslides.invalid";
export const READER_URL = `${ORIGIN}/reader.html`;
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const assetsRoot = path.join(repository, "assets");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

// LEANSLIDES_CHROMIUM first, then Edge or Chrome where they usually live,
// then a Chromium on PATH or in Playwright's folders.
export function findBrowser() {
  if (process.env.LEANSLIDES_CHROMIUM) {
    return process.env.LEANSLIDES_CHROMIUM;
  }
  const candidates = process.platform === "win32"
    ? [
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      ]
    : [];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), ".cache", "ms-playwright")]
    .filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const build of readdirSync(root).filter((name) => /^chromium_headless_shell-\d+$/.test(name)).sort().reverse()) {
      for (const relative of [["chrome-linux", "headless_shell"], ["chrome-headless-shell-linux64", "chrome-headless-shell"]]) {
        const candidate = path.join(root, build, ...relative);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    try {
      const found = execFileSync("which", [name], { encoding: "utf8" }).trim();
      if (found) {
        return found;
      }
    } catch {
      // Try the next name.
    }
  }
  throw new Error("No Chromium-based browser found. Set LEANSLIDES_CHROMIUM.");
}

export function findInspect() {
  if (process.env.LEANSLIDES_INSPECT) {
    return path.resolve(process.env.LEANSLIDES_INSPECT);
  }
  const executable = process.platform === "win32" ? "leanslides-inspect.exe" : "leanslides-inspect";
  const build = path.join(repository, "build");
  if (existsSync(build)) {
    for (const entry of readdirSync(build).sort()) {
      const candidate = path.join(build, entry, "tools", "inspect", executable);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error("leanslides-inspect not found; set LEANSLIDES_INSPECT");
}

function inspect(tool, args) {
  const result = spawnSync(tool, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 60_000 });
  return result;
}

// Collects every "media" id a slide model names, wherever it sits.
function collectMedia(node, out) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectMedia(item, out));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "media" && typeof value === "string") {
        out.add(value);
      } else {
        collectMedia(value, out);
      }
    }
  }
  return out;
}

// One deck read through leanslides-inspect: the index, the details, every
// slide model (or the error a slide failed with), and pictures on demand.
export function loadDeck(file, tool = findInspect()) {
  const indexRun = inspect(tool, [file]);
  const index = JSON.parse(indexRun.stdout.trim().split("\n")[0]);
  const deck = { file, index, ok: index.ok === true && index.slideCount !== undefined, slides: [], media: new Map() };
  if (!deck.ok) {
    return deck;
  }
  deck.detailsText = inspect(tool, ["--details", file]).stdout.trim();
  const slides = inspect(tool, ["--all-slides", file]);
  const lines = slides.stdout.split("\n").filter((line) => line.trim());
  const failed = new Map();
  for (const match of slides.stderr.matchAll(/slide (\d+) failed: (\S+)/g)) {
    failed.set(Number(match[1]) - 1, match[2]);
  }
  let line = 0;
  for (let number = 0; number < index.slideCount; number += 1) {
    if (failed.has(number)) {
      deck.slides.push({ text: JSON.stringify({ error: failed.get(number) }), model: null });
    } else {
      const text = lines[line++];
      deck.slides.push({ text, model: JSON.parse(text) });
    }
  }
  deck.named = collectMedia(deck.slides.map((slide) => slide.model), new Set());
  deck.tool = tool;
  return deck;
}

function readMedia(deck, id) {
  if (!deck.named.has(id)) {
    return null;
  }
  if (!deck.media.has(id)) {
    const folder = mkdtempSync(path.join(os.tmpdir(), "leanslides-media-"));
    const out = path.join(folder, "media.bin");
    const run = inspect(deck.tool, ["--media", id, "--media-out", out, deck.file]);
    deck.media.set(id, run.status === 0 ? { body: readFileSync(out), type: run.stdout.trim() } : null);
    rmSync(folder, { recursive: true, force: true });
  }
  return deck.media.get(id);
}

// The addresses of docs/HOST.md, for the deck the page was given.
function answerDeck(state, url) {
  const match = /^\/deck\/(\d+)\/(\d+)\/(.*)$/.exec(url.pathname);
  if (!match || !state.deck || Number(match[1]) !== state.tab || Number(match[2]) !== state.generation) {
    return null;
  }
  const deck = state.deck;
  const rest = match[3];
  if (rest === "index.json") {
    return { body: JSON.stringify(deck.index), type: "application/json" };
  }
  if (rest === "details.json") {
    return { body: deck.detailsText, type: "application/json" };
  }
  const slide = /^slide\/(0|[1-9]\d*)\.json$/.exec(rest);
  if (slide) {
    const entry = deck.slides[Number(slide[1])];
    return entry ? { body: entry.text, type: "application/json" } : null;
  }
  if (rest === "media" && url.searchParams.has("id")) {
    const id = url.searchParams.get("id");
    const media = readMedia(deck, id);
    if (deck.named.has(id) && !media) {
      // A slide names the picture but the core will not serve its bytes
      // (for example a part that fails its CRC check). The stage and a
      // thumbnail may both ask for it; it is recorded once.
      const name = `${path.basename(deck.file)}: ${id}`;
      if (!state.unservable.includes(name)) state.unservable.push(name);
      return { unservable: true };
    }
    return media && /^image\/(png|jpeg|gif|bmp)$/.test(media.type) ? media : null;
  }
  return null;
}

function answerAsset(url) {
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!/^[A-Za-z0-9._\-/]+$/.test(relative) || relative.includes("..")) {
    return null;
  }
  const file = path.join(assetsRoot, relative);
  if (!existsSync(file)) {
    return null;
  }
  return { body: readFileSync(file), type: CONTENT_TYPES[path.extname(file)] || "application/octet-stream" };
}

const BRIDGE = `(() => {
  const listeners = [];
  window.__hostPosts = [];
  window.__cspViolations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    window.__cspViolations.push(event.violatedDirective + " " + event.blockedURI);
  });
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    postMessage(text) { window.__hostPosts.push(JSON.parse(text)); },
    addEventListener(type, listener) { if (type === "message") listeners.push(listener); },
    removeEventListener() {}
  };
  window.__deliver = (message) => listeners.forEach((listener) => listener({ data: message }));
})();`;

export async function launch() {
  return chromium.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ["--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
  });
}

// A page with the reader loaded. `state` holds the deck the page may read.
// The page language is en-US unless a test asks for another, so "Same as
// Windows" gives English whatever the machine running the tests uses.
export async function openReader(browser, { width = 1280, height = 800, locale = "en-US" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale, serviceWorkers: "block" });
  const page = await context.newPage();
  const state = { deck: null, tab: 0, generation: 0, offOrigin: [], refused: [], unservable: [] };
  await page.addInitScript(BRIDGE);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) {
      state.offOrigin.push(url.href);
      return route.abort("blockedbyclient");
    }
    const answer = url.pathname.startsWith("/deck/") ? answerDeck(state, url) : answerAsset(url);
    if (!answer || answer.unservable) {
      if (!answer) state.refused.push(url.pathname + url.search);
      return route.fulfill({ status: 404, body: "" });
    }
    return route.fulfill({ status: 200, body: answer.body, contentType: answer.type });
  });
  await page.goto(READER_URL);
  await page.waitForFunction(() => window.__hostPosts.some((post) => post.type === "ready"));
  return { page, context, state };
}

export async function deliver(page, message) {
  await page.evaluate((value) => window.__deliver(value), message);
}

// Sends a deck as the Windows host does and waits for the first "rendered".
export async function showDeck(reader, deck, { tab = 1, generation = 1 } = {}) {
  reader.state.deck = deck;
  reader.state.tab = tab;
  reader.state.generation = generation;
  await reader.page.evaluate(() => { window.__hostPosts.length = 0; });
  await deliver(reader.page, {
    type: "document", tab, generation, fileName: path.basename(deck.file), displayPath: deck.file,
    deckUrl: `${ORIGIN}/deck/${tab}/${generation}/`, coreMs: 0, index: deck.index,
  });
  return waitForRendered(reader.page);
}

export async function waitForRendered(page, slide) {
  const handle = await page.waitForFunction((wanted) => {
    const found = window.__hostPosts.find((post) =>
      (post.type === "rendered" && (wanted === undefined || post.slide === wanted)) || post.type === "renderFailed");
    return found || null;
  }, slide, { timeout: 20_000 });
  return handle.jsonValue();
}
