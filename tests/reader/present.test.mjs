// Browser tests for the slide show (F5, Shift+F5, Esc, the Present button)
// and the interface language (settings, the host's saved choice, and
// "Same as Windows"), through the fake host.
//
//   node --test tests/reader/present.test.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { deliver, launch, loadDeck, openReader, repository, showDeck, waitForRendered } from "./fake-host.mjs";

const require = createRequire(import.meta.url);
const Strings = require(path.join(repository, "assets", "i18n.js"));
const SMOKE = path.join(repository, "tests", "hosts", "fixtures", "smoke.pptx");
const HOST = { type: "host", platform: "windows", version: "0.1.0", tabs: true,
  editor: { kind: "powerpoint", label: "Open in PowerPoint" } };

let browser;
let smoke;
before(async () => {
  browser = await launch();
  smoke = loadDeck(SMOKE);
});
after(async () => {
  await browser?.close();
});

// The smoke deck with its second slide hidden in the slide show.
function withHiddenSecond(deck) {
  const details = JSON.parse(deck.detailsText);
  return {
    ...deck,
    detailsText: JSON.stringify({
      ...details,
      slides: details.slides.map((slide, n) => ({ ...slide, hidden: n === 1 })),
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

async function waitForDetails(page) {
  await page.waitForFunction(() => /hidden/.test(
    document.querySelector('.thumb[data-slide="1"] .thumb-button')?.getAttribute("aria-label") || ""));
}

async function shownSlide(page) {
  return page.evaluate(() => Number(document.querySelector("#stage [data-rendered-slide]").dataset.renderedSlide));
}

test("F5 shows the deck from the first slide alone on the screen, passes over hidden slides, and Esc ends it", async () => {
  const reader = await openReader(browser, { width: 1280, height: 800 });
  const { page } = reader;
  await deliver(page, HOST);
  await showDeck(reader, withHiddenSecond(smoke));
  await waitForDetails(page);
  await page.keyboard.press("End");
  await waitForRendered(page, 2);

  await clearPosts(page);
  await page.keyboard.press("F5");
  assert.deepEqual(await posts(page, "present"), [{ type: "present", on: true }]);
  assert.equal(await page.getAttribute("html", "data-presenting"), "");
  await waitForRendered(page, 0);
  for (const hidden of ["#chrome", "#thumbs", "#notesPanel", ".status"]) {
    assert.equal(await page.isVisible(hidden), false, `${hidden} is hidden in the show`);
  }
  // The slide fills the window: one side touches it, the other is centred.
  const frame = await page.$eval(".slide-frame", (node) => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height, left: box.left, top: box.top };
  });
  const fills = Math.abs(frame.width - 1280) < 1 || Math.abs(frame.height - 800) < 1;
  assert.ok(fills, `the slide fills the window (${JSON.stringify(frame)})`);
  assert.equal(await page.$eval(".viewer", (node) => getComputedStyle(node).backgroundColor), "rgb(0, 0, 0)");

  // The second slide is hidden in the show, so the next key goes to the third.
  await clearPosts(page);
  await page.keyboard.press("ArrowRight");
  await waitForRendered(page, 2);
  await page.keyboard.press("ArrowLeft");
  await waitForRendered(page, 0);
  assert.equal(await shownSlide(page), 0);
  // A click on the slide moves the show on.
  await page.click("#stage", { position: { x: 640, y: 400 } });
  await waitForRendered(page, 2);
  // Keys outside the slide group do nothing in the show.
  await clearPosts(page);
  await page.keyboard.press("Control+Shift+T");
  await page.keyboard.press("Control+/");
  assert.deepEqual(await page.evaluate(() => window.__hostPosts), []);
  assert.equal(await page.isVisible("#settingsPanel"), false);

  await page.keyboard.press("Escape");
  assert.deepEqual(await posts(page, "present"), [{ type: "present", on: false }]);
  assert.equal(await page.getAttribute("html", "data-presenting"), null);
  assert.equal(await page.isVisible("#chrome"), true);
  // Out of the show, the arrows visit the hidden slide again.
  await page.keyboard.press("ArrowLeft");
  await waitForRendered(page, 1);
  await finish(reader);
});

test("Shift+F5 and the Present button start the show, and the host can end it", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await deliver(page, HOST);
  await showDeck(reader, smoke);
  await page.keyboard.press("ArrowRight");
  await waitForRendered(page, 1);

  await clearPosts(page);
  await page.keyboard.press("Shift+F5");
  assert.deepEqual(await posts(page, "present"), [{ type: "present", on: true }]);
  assert.equal(await shownSlide(page), 1, "Shift+F5 starts from the slide being read");
  // The host leaves full screen (the window lost its monitor, say).
  await deliver(page, { type: "presenting", on: false });
  assert.equal(await page.getAttribute("html", "data-presenting"), null);
  assert.deepEqual(await posts(page, "present"), [{ type: "present", on: true }], "no echo back to the host");

  assert.equal(await page.textContent("#presentButton"), "Present");
  await clearPosts(page);
  await page.click("#presentButton");
  assert.deepEqual(await posts(page, "present"), [{ type: "present", on: true }]);
  await waitForRendered(page, 0);
  await page.keyboard.press("Escape");
  assert.equal(await page.getAttribute("html", "data-presenting"), null);
  await finish(reader);
});

test("the language setting changes every string, is saved by the host, and comes back from it", async () => {
  const reader = await openReader(browser);
  const { page } = reader;
  await deliver(page, HOST);
  await showDeck(reader, smoke);
  assert.equal(await page.getAttribute("html", "lang"), "en");
  assert.equal(await page.textContent("#slideCounter"), "Slide 1 of 3");

  await page.keyboard.press("Control+/");
  await page.waitForSelector("#settingsPanel:not([hidden])");
  assert.equal(await page.isChecked('#settingsPanel input[name="settings-language"][value="auto"]'), true);
  await clearPosts(page);
  await page.check('#settingsPanel input[name="settings-language"][value="ja"]');
  assert.deepEqual(await posts(page, "setLanguage"), [{ type: "setLanguage", language: "ja" }]);
  assert.equal(await page.getAttribute("html", "lang"), "ja");
  const ja = Strings.tables.ja;
  assert.equal(await page.textContent("#slideCounter"), Strings.translate("ja", "slide.position", { current: 1, total: 3 }));
  assert.equal(await page.textContent("#presentButton"), ja["present.button"]);
  // The open shortcut list is redrawn in the new language.
  const labels = await page.$$eval("#shortcutList dd",
    (nodes) => nodes.map((node) => node.textContent));
  assert.ok(labels.includes(ja["shortcut.presentStart"]), "the shortcut list is in Japanese");
  // CJK text in the interface has a Japanese font after IBM Plex.
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Yu Gothic UI/);

  await page.check('#settingsPanel input[name="settings-language"][value="zh-CN"]');
  assert.equal(await page.getAttribute("html", "lang"), "zh-CN");
  assert.equal(await page.textContent("#presentButton"), Strings.tables["zh-CN"]["present.button"]);
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Microsoft YaHei UI/);
  await page.keyboard.press("Escape");

  // The host sends the saved choice at start; an unknown value means auto.
  await deliver(page, { ...HOST, language: "en" });
  assert.equal(await page.getAttribute("html", "lang"), "en");
  assert.equal(await page.textContent("#presentButton"), "Present");
  await deliver(page, { ...HOST, language: "fr" });
  assert.equal(await page.getAttribute("html", "lang"), "en", "fr is not offered, so auto, and auto is English here");
  await finish(reader);
});

test("Same as Windows picks Japanese, Simplified Chinese, or English from the system language", async () => {
  const cases = [["ja-JP", "ja"], ["zh-CN", "zh-CN"], ["zh-SG", "zh-CN"], ["zh-TW", "en"], ["zh-Hant-HK", "en"],
    ["de-DE", "en"], ["en-US", "en"]];
  for (const [locale, wanted] of cases) {
    const reader = await openReader(browser, { locale });
    const { page } = reader;
    await deliver(page, { ...HOST, language: "auto" });
    assert.equal(await page.getAttribute("html", "lang"), wanted, `${locale} gives ${wanted}`);
    await finish(reader);
  }
});

test("every language has every English key, the same {names}, and no English left in Chinese or Japanese", () => {
  const en = Strings.tables.en;
  const names = (text) => (String(text).match(/\{[a-zA-Z]+\}/g) || []).sort().join();
  // Strings that are the same in every language: product names and codes.
  const shared = new Set(["app.name", "feature.smartart"]);
  for (const language of ["zh-CN", "ja"]) {
    const table = Strings.tables[language];
    for (const key of Object.keys(en)) {
      if (key === "app.name") continue;
      assert.ok(Object.prototype.hasOwnProperty.call(table, key), `${language} has ${key}`);
      assert.equal(names(table[key]), names(en[key]), `${language} ${key} keeps the same {names}`);
      if (!shared.has(key) && en[key].length > 3) {
        assert.notEqual(table[key], en[key], `${language} ${key} is translated`);
      }
    }
    for (const key of Object.keys(table)) {
      assert.ok(Object.prototype.hasOwnProperty.call(en, key), `${language} ${key} is an English key`);
    }
  }
});
