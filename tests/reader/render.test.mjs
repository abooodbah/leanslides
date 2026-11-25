// Browser tests for the slide renderer (assets/render.js, geometry.js,
// reader.js) through the fake host. Needs leanslides-inspect (build it, or
// set LEANSLIDES_INSPECT) and a Chromium-based browser (Edge or Chrome, or
// LEANSLIDES_CHROMIUM).
//
//   node --test tests/reader/render.test.mjs
//
// The corpus sweep draws every slide of every cached corpus deck
// (tests/corpus/fetch-corpus.mjs fetches them) and compares each drawn slide
// with its model. It is skipped when the cache is empty, unless
// LEANSLIDES_REQUIRE_CORPUS=1, as in CI.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { deliver, launch, loadDeck, openReader, repository, showDeck, waitForRendered } from "./fake-host.mjs";

const SMOKE = path.join(repository, "tests", "hosts", "fixtures", "smoke.pptx");
const corpusRoot = path.join(repository, "tests", "corpus", "cache");

let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

// Runs in the page: compares the drawn slide with its model and returns the
// differences, with counts for the summary.
function checkSlide({ model, number }) {
  const problems = [];
  const slide = document.querySelector(`[data-rendered-slide="${number}"]`);
  if (!slide) {
    return { problems: [`slide ${number} is not on the stage`], counts: {} };
  }
  const counts = { images: 0, cropped: 0, unreadable: 0, placeholders: 0, cells: 0, groups: 0, rotated: 0, gradients: 0, patterns: 0, markers: 0 };
  const expected = { text: [], pictures: [], images: 0, placeholders: 0, cells: 0, turnedGroups: 0, rotatedShapes: 0,
    gradients: 0, patterns: 0, lineEnds: 0 };

  function textOf(body) {
    for (const paragraph of body?.paragraphs || []) {
      for (const run of paragraph.runs || []) {
        if (!run.br && run.t) {
          expected.text.push(run.caps === "all" ? run.t.toUpperCase() : run.t);
        }
      }
      const hasText = (paragraph.runs || []).some((run) => run.t);
      if (hasText && paragraph.bullet && paragraph.bullet.media) {
        expected.images += 1;
      }
    }
  }
  function visible(crop) {
    const c = crop || [0, 0, 0, 0];
    return 1 - c[0] - c[2] > 0 && 1 - c[1] - c[3] > 0;
  }
  function walk(shape) {
    switch (shape.kind) {
      case "shape":
        if (shape.fill?.type === "picture" && shape.fill.media && visible(shape.fill.crop)) {
          expected.images += 1;
          expected.pictures.push(shape.fill.crop);
        }
        if (shape.fill?.type === "gradient" && (shape.fill.stops || []).length) expected.gradients += 1;
        if (shape.fill?.type === "pattern") expected.patterns += 1;
        if (shape.rot) expected.rotatedShapes += 1;
        if (shape.line && ((shape.line.head && shape.line.head.type !== "none") ||
            (shape.line.tail && shape.line.tail.type !== "none"))) expected.lineEnds += 1;
        textOf(shape.text);
        break;
      case "picture":
        if (shape.media) {
          if (visible(shape.crop)) {
            expected.images += 1;
            expected.pictures.push(shape.crop);
          }
        } else {
          expected.placeholders += 1;
        }
        break;
      case "object":
        if (shape.media) {
          expected.images += 1;
          expected.pictures.push(shape.crop);
        } else {
          expected.placeholders += 1;
        }
        break;
      case "table":
        for (const row of shape.rows || []) {
          for (const cell of row.cells || []) {
            if (!cell.merged) {
              expected.cells += 1;
              textOf(cell.text);
            }
          }
        }
        break;
      case "group":
        if (shape.rot || shape.flipH || shape.flipV) expected.turnedGroups += 1;
        (shape.children || []).forEach(walk);
        break;
      default:
        break;
    }
  }
  (model.shapes || []).forEach(walk);

  // Text: every run, in order, and nothing else (bullets and placeholder
  // labels aside).
  const parts = [];
  const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest(".bullet, .missing")) {
      parts.push(walker.currentNode.data);
    }
  }
  const squash = (text) => text.replace(/[\s​]+/g, "");
  const drawnText = squash(parts.join(""));
  const modelText = squash(expected.text.join(""));
  if (drawnText !== modelText) {
    problems.push(`text differs: drawn "${drawnText.slice(0, 80)}" model "${modelText.slice(0, 80)}"`);
  }

  // A picture the host could not serve is replaced by a labelled box.
  counts.unreadable = slide.querySelectorAll(".missing[data-missing='unreadable']").length;
  counts.images = slide.querySelectorAll("img").length + counts.unreadable;
  counts.placeholders = slide.querySelectorAll(".missing").length - counts.unreadable;
  counts.cells = slide.querySelectorAll("td").length;
  counts.groups = Array.from(slide.querySelectorAll(".group")).filter((node) => node.style.transform).length;
  counts.rotated = Array.from(slide.querySelectorAll("svg.geom")).filter((node) => /rotate\(/.test(node.style.transform)).length;
  counts.gradients = slide.querySelectorAll("linearGradient, radialGradient").length;
  counts.patterns = slide.querySelectorAll("pattern").length;
  counts.markers = slide.querySelectorAll("marker").length;

  const compare = (name, drawn, wanted, atLeast) => {
    if (atLeast ? drawn < wanted : drawn !== wanted) {
      problems.push(`${name}: drawn ${drawn}, model ${wanted}`);
    }
  };
  compare("pictures", counts.images, expected.images);
  compare("placeholders", counts.placeholders, expected.placeholders);
  compare("table cells", counts.cells, expected.cells);
  compare("turned groups", counts.groups, expected.turnedGroups);
  compare("rotated shapes", counts.rotated, expected.rotatedShapes, true);
  compare("gradients", counts.gradients, expected.gradients, true);
  compare("patterns", counts.patterns, expected.patterns, true);
  compare("line ends", counts.markers, expected.lineEnds, true);

  // Crops: each picture is sized past its frame by the crop and moved by
  // the left and top crop, in drawing order.
  const holders = slide.querySelectorAll(".picture, .missing[data-missing='unreadable']");
  holders.forEach((holder, index) => {
    const image = holder.querySelector("img");
    if (!image || index >= expected.pictures.length) return;
    const c = expected.pictures[index] || [0, 0, 0, 0];
    const fullW = parseFloat(holder.style.width) / (1 - c[0] - c[2]);
    const fullH = parseFloat(holder.style.height) / (1 - c[1] - c[3]);
    const off = (a, b) => Math.abs(a - b) > 0.01;
    if (off(parseFloat(image.style.width), fullW) || off(parseFloat(image.style.height), fullH) ||
        off(parseFloat(image.style.left), -c[0] * fullW) || off(parseFloat(image.style.top), -c[1] * fullH)) {
      problems.push(`picture ${index + 1} crop ${JSON.stringify(c)} drawn at ${image.style.left} ${image.style.top} ${image.style.width} ${image.style.height}`);
    }
  });
  counts.cropped = expected.pictures.filter((c) => c && c.some((v) => v)).length;

  // Arrow ends keep a readable size on thin lines: the smallest end is two
  // times a base of at least 2 points.
  for (const marker of slide.querySelectorAll("marker")) {
    const w = Number(marker.getAttribute("markerWidth")), h = Number(marker.getAttribute("markerHeight"));
    if (marker.getAttribute("markerUnits") !== "userSpaceOnUse" || !(w >= 4) || !(h >= 4)) {
      problems.push(`arrow end ${w} x ${h} ${marker.getAttribute("markerUnits")}`);
      break;
    }
  }
  for (const image of slide.querySelectorAll("img")) {
    if (!image.complete || image.naturalWidth === 0) {
      problems.push(`picture did not load: ${image.src.slice(-60)}`);
    }
  }
  for (const node of slide.querySelectorAll("path, [style]")) {
    const text = (node.getAttribute("d") || "") + (node.getAttribute("style") || "");
    if (/NaN|Infinity|undefined/.test(text)) {
      problems.push(`bad value in ${node.tagName}: ${text.slice(0, 80)}`);
      break;
    }
  }
  const width = parseFloat(slide.style.width);
  if (Math.abs(width - model.w / 12700) > 0.01) {
    problems.push(`slide width ${width}, model ${model.w / 12700}`);
  }
  const failures = Number(document.documentElement.dataset.shapeFailures || 0);
  if (failures) {
    problems.push(`${failures} shapes failed to draw`);
  }
  return { problems, counts };
}

async function waitForImages(page, number) {
  await page.waitForFunction((n) => {
    const slide = document.querySelector(`[data-rendered-slide="${n}"]`);
    // A picture that fails to load is replaced, so every picture left on
    // the slide must have loaded.
    return slide && Array.from(slide.querySelectorAll("img")).every((image) => image.complete && image.naturalWidth > 0);
  }, number, { timeout: 20_000 });
}

async function goTo(reader, key, number) {
  await reader.page.evaluate(() => { window.__hostPosts.length = 0; });
  await reader.page.keyboard.press(key);
  const posted = await waitForRendered(reader.page, number);
  assert.equal(posted.type, "rendered", JSON.stringify(posted));
  await waitForImages(reader.page, number);
}

test("the smoke deck draws, moves between slides, and reports each slide", async () => {
  const deck = loadDeck(SMOKE);
  const reader = await openReader(browser);
  try {
    const first = await showDeck(reader, deck);
    assert.equal(first.type, "rendered");
    assert.equal(first.slide, 0);
    assert.equal(first.tab, 1);
    assert.equal(first.generation, 1);
    const root = await reader.page.evaluate(() => ({ ...document.documentElement.dataset }));
    assert.equal(root.renderState, "ready");
    assert.equal(root.slides, "3");
    let result = await reader.page.evaluate(checkSlide, { model: deck.slides[0].model, number: 0 });
    assert.deepEqual(result.problems, []);
    assert.match(await reader.page.locator("[data-rendered-slide='0']").innerText(), /LeanSlides smoke test/);

    await goTo(reader, "ArrowRight", 1);
    result = await reader.page.evaluate(checkSlide, { model: deck.slides[1].model, number: 1 });
    assert.deepEqual(result.problems, []);
    assert.equal(result.counts.images, 1);
    const picture = await reader.page.evaluate(() => document.querySelector("[data-rendered-slide='1'] img").naturalWidth);
    assert.equal(picture, 64);
    const link = await reader.page.evaluate(() => document.querySelector("[data-rendered-slide='1'] .slide-link")?.dataset.href);
    assert.equal(link, "https://example.com/");

    await goTo(reader, "End", 2);
    result = await reader.page.evaluate(checkSlide, { model: deck.slides[2].model, number: 2 });
    assert.deepEqual(result.problems, []);
    assert.ok(result.counts.cells > 0);
    await goTo(reader, "Home", 0);
    await goTo(reader, "PageDown", 1);
    await goTo(reader, "PageUp", 0);
    await goTo(reader, "Space", 1);
    await goTo(reader, "ArrowLeft", 0);

    // Past either end nothing moves and nothing is posted.
    await reader.page.evaluate(() => { window.__hostPosts.length = 0; });
    await reader.page.keyboard.press("ArrowLeft");
    await reader.page.waitForTimeout(150);
    assert.deepEqual(await reader.page.evaluate(() => window.__hostPosts), []);
    // Ctrl+Page Down is the next tab, not the next slide.
    await reader.page.keyboard.press("Control+PageDown");
    await reader.page.waitForTimeout(150);
    assert.deepEqual(await reader.page.evaluate(() => window.__hostPosts), []);

    // The file changed on disk: the host sends the same tab with a new
    // generation, and the reader stays on its slide.
    await goTo(reader, "End", 2);
    const reread = await showDeck(reader, deck, { tab: 1, generation: 2 });
    assert.equal(reread.slide, 2);
    assert.equal(reread.generation, 2);

    assert.deepEqual(await reader.page.evaluate(() => window.__cspViolations), []);
    assert.deepEqual(reader.state.offOrigin, []);
    assert.deepEqual(reader.state.refused, []);
  } finally {
    await reader.context.close();
  }
});

test("a reply for a replaced generation is not reported as a failure", async () => {
  const deck = loadDeck(SMOKE);
  const reader = await openReader(browser);
  try {
    // The host has moved on to generation 2 before the reader asks for
    // generation 1's slide, so that request gets 404.
    reader.state.deck = deck;
    reader.state.tab = 1;
    reader.state.generation = 2;
    const message = (generation) => ({
      type: "document", tab: 1, generation, fileName: "smoke.pptx", displayPath: SMOKE,
      deckUrl: `https://app.leanslides.invalid/deck/1/${generation}/`, coreMs: 0, index: deck.index,
    });
    await deliver(reader.page, message(1));
    await deliver(reader.page, message(2));
    const posted = await waitForRendered(reader.page, 0);
    assert.equal(posted.type, "rendered");
    assert.equal(posted.generation, 2);
    await reader.page.waitForTimeout(200);
    const posts = await reader.page.evaluate(() => window.__hostPosts.filter((post) => post.type !== "ready"));
    assert.deepEqual(posts.map((post) => `${post.type}:${post.generation}`), ["rendered:2"]);
  } finally {
    await reader.context.close();
  }
});

test("a slide that cannot be read is shown as failed and the others still draw", async () => {
  const deck = loadDeck(SMOKE);
  // The host answers 200 with {"error": code} for a slide the core cannot
  // build (docs/HOST.md).
  deck.slides[1] = { text: JSON.stringify({ error: "xml-malformed" }), model: null };
  const reader = await openReader(browser);
  try {
    await showDeck(reader, deck);
    await reader.page.evaluate(() => { window.__hostPosts.length = 0; });
    await reader.page.keyboard.press("ArrowRight");
    await reader.page.waitForFunction(() => document.querySelector("[data-failed-slide='1']"));
    const failed = await reader.page.evaluate(() => document.querySelector("[data-failed-slide='1']").textContent);
    assert.match(failed, /could not be read/);
    assert.ok(!(await reader.page.evaluate(() => window.__hostPosts.some((post) => post.type === "renderFailed"))));
    await goTo(reader, "ArrowRight", 2);
  } finally {
    await reader.context.close();
  }
});

test("every corpus slide draws as its model says", async (t) => {
  const manifest = JSON.parse(readFileSync(path.join(repository, "tests", "corpus", "manifest.json"), "utf8"));
  const files = manifest.files.filter((file) => !file.expectedErrorCode && existsSync(path.join(corpusRoot, file.name)));
  if (!files.length) {
    if (process.env.LEANSLIDES_REQUIRE_CORPUS === "1") {
      assert.fail("the corpus cache is empty; run node tests/corpus/fetch-corpus.mjs");
    }
    t.skip("the corpus cache is empty");
    return;
  }
  const reader = await openReader(browser);
  const problems = [];
  const totals = { decks: 0, slides: 0, images: 0, cropped: 0, unreadable: 0, placeholders: 0, cells: 0, groups: 0, rotated: 0,
    gradients: 0, patterns: 0, markers: 0 };
  try {
    let tab = 0;
    for (const file of files) {
      const deck = loadDeck(path.join(corpusRoot, file.name));
      if (!deck.ok || !deck.index.slideCount) {
        continue;
      }
      tab += 1;
      totals.decks += 1;
      const first = await showDeck(reader, deck, { tab, generation: 1 });
      if (first.type !== "rendered") {
        problems.push(`${file.name}: ${JSON.stringify(first)}`);
        continue;
      }
      for (let number = 0; number < deck.slides.length; number += 1) {
        if (number > 0) {
          await reader.page.evaluate(() => { window.__hostPosts.length = 0; });
          await reader.page.keyboard.press("ArrowRight");
        }
        const model = deck.slides[number].model;
        if (!model) {
          await reader.page.waitForFunction((n) => document.querySelector(`[data-failed-slide="${n}"]`), number);
          continue;
        }
        if (number > 0) {
          await waitForRendered(reader.page, number);
        }
        await waitForImages(reader.page, number);
        const result = await reader.page.evaluate(checkSlide, { model, number });
        totals.slides += 1;
        for (const key of Object.keys(result.counts)) {
          totals[key] += result.counts[key];
        }
        for (const problem of result.problems) {
          problems.push(`${file.name} slide ${number + 1}: ${problem}`);
        }
      }
    }
    const csp = await reader.page.evaluate(() => window.__cspViolations);
    t.diagnostic(`corpus: ${JSON.stringify(totals)}`);
    assert.deepEqual(csp, [], "Content Security Policy violations");
    assert.deepEqual(reader.state.offOrigin, [], "requests outside the app origin");
    assert.deepEqual(reader.state.refused, [], "requests the host refused");
    // The one damaged picture in the corpus (a fuzzer file whose PNG part
    // fails its CRC check) is the only picture the core does not serve.
    assert.deepEqual([...new Set(reader.state.unservable)],
      ["crash-57308ca363f5b71763c489d1b432aff009d4bc4f.pptx: ppt/media/image2.png"]);
    assert.equal(totals.unreadable, 1);
    assert.deepEqual(problems, []);
  } finally {
    await reader.context.close();
  }
});
