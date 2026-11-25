// Browser tests for the reader's interface (assets/reader.html, reader.js,
// reader.css, i18n.js) through the fake host: the toolbar, tabs, theme,
// settings and shortcut list, thumbnails, zoom, notes, find, copy, links,
// and the empty and fallback pages.
//
//   node --test tests/reader/ui.test.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { deliver, launch, loadDeck, openReader, ORIGIN, repository, showDeck, waitForRendered } from "./fake-host.mjs";

const SMOKE = path.join(repository, "tests", "hosts", "fixtures", "smoke.pptx");
const EMU_PER_POINT = 12700;

let browser;
let smoke;
before(async () => {
  browser = await launch();
  smoke = loadDeck(SMOKE);
});
after(async () => {
  await browser?.close();
});

// The smoke deck's three slides repeated to `count` slides, for the lazy
// thumbnail strip.
function longDeck(deck, count) {
  const details = JSON.parse(deck.detailsText);
  return {
    ...deck,
    index: { ...deck.index, slideCount: count },
    slides: Array.from({ length: count }, (_, n) => deck.slides[n % deck.slides.length]),
    detailsText: JSON.stringify({
      ...details,
      slides: Array.from({ length: count }, (_, n) => ({ ...details.slides[n % details.slides.length], index: n })),
    }),
  };
}

async function posts(page, type) {
  return page.evaluate((wanted) => window.__hostPosts.filter((post) => post.type === wanted), type);
}

async function clearPosts(page) {
  await page.evaluate(() => { window.__hostPosts.length = 0; });
}

async function finish(reader) {
  const violations = await reader.page.evaluate(() => window.__cspViolations);
  assert.deepEqual(violations, [], "no Content Security Policy reports");
  assert.deepEqual(reader.state.offOrigin, [], "no request leaves the app origin");
  await reader.context.close();
}

const HOST = { type: "host", platform: "windows", version: "0.1.0", tabs: true };

test("the toolbar names the editor, cycles the theme, and opens the settings with every shortcut", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await deliver(page, { ...HOST, editor: { kind: "powerpoint", label: "Open in PowerPoint" } });
  await showDeck(reader, smoke);
  assert.equal(await page.textContent("#editorButton"), "Open in PowerPoint");
  await deliver(page, { ...HOST, editor: { kind: "default", label: "Open in Keynote Viewer" } });
  assert.equal(await page.textContent("#editorButton"), "Open in Keynote Viewer");

  await clearPosts(page);
  await page.keyboard.press("Control+Shift+E");
  assert.deepEqual(await posts(page, "openInEditor"), [{ type: "openInEditor", tab: 1 }]);

  // System, Light, Dark, Dim, Dusk, then System again.
  const seen = [];
  for (let n = 0; n < 5; n += 1) {
    await page.click("#themeButton");
    seen.push(await page.evaluate(() => document.documentElement.dataset.theme || "system"));
  }
  assert.deepEqual(seen, ["light", "dark", "dim", "dusk", "system"]);
  assert.deepEqual((await posts(page, "setTheme")).map((post) => post.theme), seen);
  await deliver(page, { type: "theme", theme: "dim" });
  assert.equal(await page.getAttribute("html", "data-theme"), "dim");

  await page.keyboard.press("Control+/");
  await page.waitForSelector("#settingsPanel:not([hidden])");
  const keys = await page.$$eval("#shortcutList kbd", (nodes) => nodes.map((node) => node.textContent));
  for (const wanted of ["Ctrl+O", "Ctrl+F", "Ctrl+Tab", "Ctrl+W", "Ctrl+1 to Ctrl+8", "Ctrl+9", "Ctrl++", "Ctrl+-",
    "Ctrl+0", "Ctrl+Shift+N", "Ctrl+Shift+C", "Home", "End"]) {
    assert.ok(keys.includes(wanted), `the shortcut list shows ${wanted}`);
  }
  assert.equal(await page.isChecked('#settingsPanel input[value="dim"]'), true);
  await page.check('#settingsPanel input[value="light"]');
  assert.equal(await page.getAttribute("html", "data-theme"), "light");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#settingsPanel", { state: "hidden" });
  await finish(reader);
});

test("tabs switch and close from the keyboard and the pointer", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await deliver(page, { ...HOST, editor: { kind: "web", label: "Open PowerPoint for the web" } });
  await showDeck(reader, smoke, { tab: 2 });
  const tabs = [1, 2, 3, 4].map((id) => ({ id, name: `deck${id}.pptx`, path: `C:\\decks\\deck${id}.pptx` }));
  await deliver(page, { type: "tabs", active: 2, tabs });
  assert.equal(await page.isVisible("#tabStrip"), true);
  assert.equal(await page.textContent('.tab[aria-selected="true"] .tab-label'), "deck2.pptx");

  const pressAndRead = async (keys) => {
    await clearPosts(page);
    await page.locator("#stage").focus();
    await page.keyboard.press(keys);
    // Give a slide change time to be drawn and reported, so a key that also
    // moved the slide shows up here.
    await page.waitForTimeout(150);
    return page.evaluate(() => window.__hostPosts.filter((post) =>
      post.type === "selectTab" || post.type === "closeTab" || post.type === "rendered"));
  };
  assert.deepEqual(await pressAndRead("Control+Tab"), [{ type: "selectTab", id: 3 }]);
  assert.deepEqual(await pressAndRead("Control+Shift+Tab"), [{ type: "selectTab", id: 1 }]);
  // Ctrl+Page Down and Up move between tabs, never between slides.
  assert.deepEqual(await pressAndRead("Control+PageDown"), [{ type: "selectTab", id: 3 }]);
  assert.deepEqual(await pressAndRead("Control+PageUp"), [{ type: "selectTab", id: 1 }]);
  assert.deepEqual(await pressAndRead("Control+4"), [{ type: "selectTab", id: 4 }]);
  assert.deepEqual(await pressAndRead("Control+9"), [{ type: "selectTab", id: 4 }]);
  assert.deepEqual(await pressAndRead("Control+w"), [{ type: "closeTab", id: 2 }]);

  await clearPosts(page);
  await page.click('.tab[data-tab-key="3"] .tab-label');
  await page.click('.tab[data-tab-key="1"]', { button: "middle" });
  assert.deepEqual(await page.evaluate(() => window.__hostPosts), [
    { type: "selectTab", id: 3 },
    { type: "closeTab", id: 1 },
  ]);

  // One tab: the strip hides and the tab keys do nothing.
  await deliver(page, { type: "tabs", active: 2, tabs: [tabs[1]] });
  assert.equal(await page.isVisible("#tabStrip"), false);
  assert.deepEqual(await pressAndRead("Control+Tab"), []);
  await finish(reader);
});

test("thumbnails are drawn near the visible strip only and move the stage", async () => {
  const reader = await openReader(browser, { width: 1280, height: 720 });
  const { page } = reader;
  const deck = longDeck(smoke, 90);
  await showDeck(reader, deck);
  assert.equal(await page.locator("#thumbList > li").count(), 90);
  await page.waitForFunction(() => document.querySelectorAll('.thumb[data-drawn="yes"]').length > 3);
  const drawn = await page.locator('.thumb[data-drawn="yes"]').count();
  assert.ok(drawn < 40, `only the thumbnails near the view are drawn (${drawn} of 90)`);
  // The stage slide is the first, and only, element the host's probe finds.
  assert.equal(await page.locator("[data-rendered-slide]").count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector("[data-rendered-slide]").closest("#stage") !== null), true);
  // A link in a thumbnail is out of the Tab order and the accessibility tree.
  const thumbLinks = await page.evaluate(() => [...document.querySelectorAll("#thumbs .slide-link")]
    .map((link) => link.closest("[inert]") !== null));
  assert.ok(thumbLinks.length > 0 && thumbLinks.every(Boolean), "thumbnail links are inert");

  await clearPosts(page);
  await page.click('.thumb[data-slide="2"] .thumb-button');
  assert.equal((await waitForRendered(page, 2)).slide, 2);
  assert.equal(await page.getAttribute('.thumb[data-slide="2"]', "aria-current"), "true");
  assert.equal(await page.textContent("#slideCounter"), "Slide 3 of 90");
  // The current thumbnail's label is bold; its slide text is not.
  await page.waitForFunction(() => document.querySelector('.thumb[data-slide="2"]').dataset.drawn === "yes");
  const weights = await page.evaluate(() => {
    const weight = (root) => [...root.querySelectorAll(".text-body span")].map((span) => getComputedStyle(span).fontWeight);
    return { stage: weight(document.querySelector("[data-rendered-slide]")),
      thumb: weight(document.querySelector('.thumb[data-slide="2"] .slide')) };
  });
  assert.ok(weights.stage.length > 0);
  assert.deepEqual(weights.thumb, weights.stage, "a thumbnail draws text as the stage does");

  // Far down the strip the first thumbnails are dropped and the last drawn.
  await page.keyboard.press("End");
  await waitForRendered(page, 89);
  await page.waitForFunction(() => document.querySelector('.thumb[data-slide="89"]').dataset.drawn === "yes");
  await page.waitForFunction(() => !document.querySelector('.thumb[data-slide="0"]').dataset.drawn);
  await finish(reader);
});

test("zoom steps from fit, sets 100% to the slide's real size, and fits again", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await showDeck(reader, smoke);
  assert.equal(await page.textContent("#zoomValue"), "Fit");
  const fitted = await page.$eval(".slide-frame", (node) => node.getBoundingClientRect().width);
  await page.keyboard.press("Control+=");
  const zoomed = await page.$eval(".slide-frame", (node) => node.getBoundingClientRect().width);
  assert.ok(zoomed > fitted, "Ctrl+= enlarges the slide");
  assert.match(await page.textContent("#zoomValue"), /^\d+%$/);

  await page.click("#zoomValue");  // from a fixed zoom back to fit
  assert.equal(await page.textContent("#zoomValue"), "Fit");
  await page.click("#zoomValue");  // from fit to 100%
  assert.equal(await page.textContent("#zoomValue"), "100%");
  const width = await page.$eval(".slide-frame", (node) => node.getBoundingClientRect().width);
  assert.equal(Math.round(width), Math.round(smoke.index.slideWidth / EMU_PER_POINT * 96 / 72));
  await page.keyboard.press("Control+-");
  assert.equal(await page.textContent("#zoomValue"), "90%");
  await page.keyboard.press("Control+0");
  assert.equal(await page.textContent("#zoomValue"), "Fit");
  await finish(reader);
});

test("notes follow the slide, and find covers slides and notes", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await showDeck(reader, smoke);
  await page.keyboard.press("Control+Shift+N");
  await page.waitForFunction(() => document.querySelector("#notesText").textContent === "This slide has no notes.");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => /plain PNG served from memory/.test(document.querySelector("#notesText").textContent));
  await page.keyboard.press("Control+Shift+N");
  assert.equal(await page.isVisible("#notesPanel"), false);

  await page.keyboard.press("Home");
  await waitForRendered(page, 0);
  await page.keyboard.press("Control+f");
  assert.equal(await page.evaluate(() => document.activeElement.id), "findInput");
  await clearPosts(page);
  await page.keyboard.type("table");
  // Only slide 3 has "table": its title "A table" and the cell "Tables".
  await page.waitForFunction(() => document.querySelector("#findCount").textContent === "1 of 2");
  await waitForRendered(page, 2);
  const marked = await page.evaluate(() => [...CSS.highlights.get("leanslides-find")].map((range) => range.toString()));
  assert.deepEqual(marked.map((text) => text.toLowerCase()), ["table", "table"]);
  const current = await page.evaluate(() => [...CSS.highlights.get("leanslides-find-current")].map((range) => range.toString()));
  assert.deepEqual(current, ["table"]);
  await page.keyboard.press("Enter");
  assert.equal(await page.textContent("#findCount"), "2 of 2");
  await page.keyboard.press("Enter");
  assert.equal(await page.textContent("#findCount"), "1 of 2", "find wraps to the first match");
  await page.keyboard.press("Shift+Enter");
  assert.equal(await page.textContent("#findCount"), "2 of 2");
  await page.keyboard.press("Escape");
  assert.equal(await page.textContent("#findCount"), "");
  assert.equal(await page.evaluate(() => CSS.highlights.get("leanslides-find").size), 0);

  // A word found only in the notes opens the notes panel.
  await page.fill("#findInput", "memory");
  await page.keyboard.press("Enter");
  await waitForRendered(page, 1);
  await page.waitForSelector("#notesPanel:not([hidden])");
  await page.waitForFunction(() => [...CSS.highlights.get("leanslides-find-current")].some((range) =>
    range.toString() === "memory" && document.querySelector("#notesText").contains(range.startContainer)));

  // A new search starts at the slide being read: "slides" is on slide 1 and
  // slide 3, and from slide 3 the count starts at its match.
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await waitForRendered(page, 2);
  await clearPosts(page);
  await page.fill("#findInput", "slides");
  await page.waitForFunction(() => document.querySelector("#findCount").textContent === "2 of 2");
  await page.waitForTimeout(150);
  assert.deepEqual(await posts(page, "rendered"), [], "the search stays on slide 3");
  await finish(reader);
});

test("Ctrl+Shift+C copies the slide's text", async () => {
  const reader = await openReader(browser);
  const { page, context } = reader;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  await showDeck(reader, smoke);
  await page.keyboard.press("ArrowRight");
  await waitForRendered(page, 1);
  // details.json is read after the first slide is drawn; the notes show
  // when it has arrived.
  await page.keyboard.press("Control+Shift+N");
  await page.waitForFunction(() => /plain PNG/.test(document.querySelector("#notesText").textContent));
  await page.locator("#stage").focus();
  await page.keyboard.press("Control+Shift+C");
  await page.waitForSelector("#statusToast:not([hidden])");
  // The Windows clipboard ends lines with CR LF.
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  assert.equal(copied, JSON.parse(smoke.detailsText).slides[1].text);
  await finish(reader);
});

test("a link in a slide opens only after the reader confirms it", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await showDeck(reader, smoke);
  await page.keyboard.press("ArrowRight");
  await waitForRendered(page, 1);
  await clearPosts(page);
  await page.click("#stage .slide-link");
  await page.waitForSelector("#linkDialog:not([hidden])");
  assert.equal(await page.textContent("#linkTarget"), "https://example.com/");
  assert.equal(await page.evaluate(() => document.activeElement.id), "linkCancel");
  // Slide keys do nothing while the dialog is open.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#linkDialog", { state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.__hostPosts), []);

  await page.click("#stage .slide-link");
  await page.click("#linkOpen");
  assert.deepEqual(await posts(page, "link"), [{ type: "link", href: "https://example.com/" }]);

  // Only web and mail links are offered; anything else is refused with a
  // message (the host checks again before Windows opens a link).
  await clearPosts(page);
  await page.evaluate(() => { document.querySelector("#stage .slide-link").dataset.href = "file:///C:/Windows/notepad.exe"; });
  await page.click("#stage .slide-link");
  await page.waitForSelector("#statusToast:not([hidden])");
  assert.equal(await page.textContent("#statusToast"), "LeanSlides opens only web and mail links.");
  assert.equal(await page.isVisible("#linkDialog"), false);
  assert.deepEqual(await page.evaluate(() => window.__hostPosts), []);
  await finish(reader);
});

test("the empty page lists recent files and the fallback page offers the editor", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await deliver(page, { ...HOST, editor: { kind: "libreoffice", label: "Open in LibreOffice Impress" } });
  await deliver(page, { type: "empty", recent: [
    { path: "C:\\decks\\one.pptx", name: "one.pptx" },
    { path: "C:\\decks\\two.pptx", name: "two.pptx" },
  ] });
  assert.equal(await page.isVisible("#statePane"), true);
  assert.deepEqual(await page.$$eval(".recent-name", (nodes) => nodes.map((node) => node.textContent)), ["one.pptx", "two.pptx"]);
  assert.equal(await page.isVisible("#findInput"), false, "document controls are hidden with no document");
  await clearPosts(page);
  await page.click('.recent-item[data-path="C:\\\\decks\\\\two.pptx"]');
  await page.click("#clearRecent");
  assert.deepEqual(await page.evaluate(() => window.__hostPosts), [
    { type: "openRecent", path: "C:\\decks\\two.pptx" },
    { type: "clearRecent" },
  ]);
  assert.equal(await page.isVisible("#recentSection"), false);

  await deliver(page, { type: "fallback", fileName: "old.ppt", displayPath: "C:\\decks\\old.ppt",
    report: { ok: false, kind: "legacy-ppt", errorCode: "", sourceBytes: 1024 } });
  assert.equal(await page.textContent("#stateEyebrow"), "This is a PowerPoint 97-2003 file.");
  assert.equal(await page.textContent("#stateTitle"), "old.ppt");
  assert.equal(await page.isVisible("#stateEditorButton"), true);
  assert.equal(await page.textContent("#stateEditorButton"), "Open in LibreOffice Impress");
  assert.equal(await page.textContent("#stateOpenButton"), "Open another file");
  await finish(reader);
});

test("the notice closes and stays closed when the same file is read again", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  const withMacros = { ...smoke, index: { ...smoke.index, features: [{ code: "macros", count: 1, notDrawn: false }] } };
  await showDeck(reader, withMacros);
  assert.equal(await page.textContent("#noticeText"), "This file contains macros. LeanSlides never runs them.");
  await page.click("#noticeClose");
  assert.equal(await page.isVisible("#notice"), false);
  await showDeck(reader, withMacros, { generation: 2 });
  assert.equal(await page.isVisible("#notice"), false);
  await showDeck(reader, withMacros, { tab: 2 });
  assert.equal(await page.isVisible("#notice"), true, "another tab shows its own notice");
  await finish(reader);
});
