// Scores the reader's drawing of every corpus slide against PowerPoint's own
// export of it (tests/parity/cache/powerpoint, made by Export-PowerPoint.ps1).
//
// Each slide is shown in the reader's slide show (Shift+F5 from that slide)
// in headless Edge with the viewport set to PowerPoint's image size, so a
// page screenshot is the slide alone at the same size. The screenshot and
// PowerPoint's PNG are compared at a quarter of that size:
//   - ssim: structural similarity of the grey images (1 = identical);
//   - blank: the same score for the slide with only its background drawn;
//   - gain: how far the drawing moves ssim from blank towards 1 (score.mjs);
//   - lines: how many of PowerPoint's text lines the reader wrote as one line.
// Slides with shapes the reader does not draw, or fonts this machine lacks,
// are tagged and kept in every total.
//
//   node tests/parity/compare.mjs [--only name,name] [--out tests/parity/scores.json]
//
// It needs the corpus cache, the PowerPoint export and a built inspect tool,
// so it runs on a developer machine, not in CI.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deliver, launch, loadDeck, openReader, repository, showDeck, waitForRendered } from "../reader/fake-host.mjs";
import { gain, lineAgreement, powerpointLines, quantile, ssim } from "./score.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const exportRoot = path.join(here, "cache", "powerpoint");
const corpusRoot = path.join(repository, "tests", "corpus", "cache");
const manifest = JSON.parse(readFileSync(path.join(repository, "tests", "corpus", "manifest.json"), "utf8"));

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const only = option("--only", "").split(",").map((s) => s.trim()).filter(Boolean);
const outFile = path.resolve(option("--out", path.join(here, "scores.json")));
// --dump <folder> also writes each drawn slide beside PowerPoint's, to look at.
const dumpDir = option("--dump", "") ? path.resolve(option("--dump", "")) : "";
const SCALE = 4;
const HOST = { type: "host", platform: "windows", version: "0.1.0", tabs: false,
  editor: { kind: "powerpoint", label: "Open in PowerPoint" } };

const exportDir = (name) => path.join(exportRoot, name.replace(/\//g, "__"));

// Grey pixels of a PNG at 1/SCALE size, decoded on a canvas in a blank page.
async function greyPixels(page, png, width, height) {
  return page.evaluate(async ({ data, w, h }) => {
    const image = new Image();
    image.src = "data:image/png;base64," + data;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, w, h);
    context.drawImage(image, 0, 0, w, h);
    const rgba = context.getImageData(0, 0, w, h).data;
    const grey = new Array(w * h);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
      grey[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    }
    return grey;
  }, { data: png.toString("base64"), w: width, h: height });
}

// The drawn text, one entry per line as laid out on screen. Bullets and the
// labels of boxes the reader draws in place of a shape are left out.
function readerLines() {
  const lines = [];
  const range = document.createRange();
  for (const paragraph of document.querySelectorAll("#stage .text-body p")) {
    if (paragraph.closest(".missing")) continue;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement.closest(".bullet") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let line = "";
    let lineTop = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.data.length; i += 1) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (rect && rect.height > 0) {
          if (lineTop !== null && rect.top > lineTop + rect.height * 0.6) {
            lines.push(line);
            line = "";
            lineTop = rect.top;
          } else if (lineTop === null) {
            lineTop = rect.top;
          }
        }
        line += node.data[i];
      }
    }
    lines.push(line);
  }
  return lines;
}

// Font families on the stage slide that this machine does not have: drawn
// with a family and its generic fallback, the width matches the fallback.
function missingFonts() {
  const families = new Set();
  for (const span of document.querySelectorAll("#stage .text-body span")) {
    const first = getComputedStyle(span).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (first) families.add(first);
  }
  const canvas = document.createElement("canvas").getContext("2d");
  const sample = "mmmmmmmmmmlli 0123456789 WWW";
  const width = (font) => { canvas.font = font; return canvas.measureText(sample).width; };
  const missing = [];
  for (const family of families) {
    const absent = ["monospace", "serif"].every((generic) =>
      width(`40px "${family}", ${generic}`) === width(`40px ${generic}`));
    if (absent) missing.push(family);
  }
  return missing.sort();
}

async function waitForStageImages(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("#stage img")].every((img) => img.complete), null,
    { timeout: 20_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function scoreDeck(browser, compare, file, record) {
  const deck = loadDeck(path.join(corpusRoot, file.name));
  const width = record.imageWidth;
  const height = record.imageHeight;
  const reader = await openReader(browser, { width, height });
  const { page } = reader;
  const slides = [];
  try {
    await deliver(page, HOST);
    await showDeck(reader, deck);
    for (const exported of record.slides) {
      const number = exported.index - 1;
      const result = { deck: file.name, slide: exported.index };
      try {
        await page.evaluate(() => { window.__hostPosts.length = 0; });
        if (number > 0) {
          await page.evaluate((n) => document.querySelector(`.thumb[data-slide="${n}"] .thumb-button`).click(), number);
          await waitForRendered(page, number);
        }
        await page.keyboard.press("Shift+F5");
        await page.waitForFunction(() => document.documentElement.hasAttribute("data-presenting"));
        await waitForStageImages(page);
        const drawn = await page.screenshot({ type: "png" });
        result.lines = lineAgreement(powerpointLines(exported), await page.evaluate(readerLines));
        result.missingFonts = await page.evaluate(missingFonts);
        result.notDrawn = await page.locator("#stage .missing").count();
        await page.evaluate(() => {
          for (const child of document.querySelector("#stage [data-rendered-slide]").children) child.style.visibility = "hidden";
        });
        const blank = await page.screenshot({ type: "png" });
        if (dumpDir) {
          const stem = path.join(dumpDir, `${path.basename(exportDir(file.name))}-${String(exported.index).padStart(3, "0")}`);
          mkdirSync(dumpDir, { recursive: true });
          writeFileSync(`${stem}-reader.png`, drawn);
          copyFileSync(path.join(exportDir(file.name), exported.image), `${stem}-powerpoint.png`);
        }
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.documentElement.hasAttribute("data-presenting"));

        const w = Math.round(width / SCALE);
        const h = Math.round(height / SCALE);
        const target = await greyPixels(compare, readFileSync(path.join(exportDir(file.name), exported.image)), w, h);
        result.ssim = round(ssim(target, await greyPixels(compare, drawn, w, h), w, h));
        result.blank = round(ssim(target, await greyPixels(compare, blank, w, h), w, h));
        const g = gain(result.ssim, result.blank);
        result.gain = g === null ? null : round(g);
      } catch (error) {
        result.error = String(error.message || error).split("\n")[0].slice(0, 200);
        await page.keyboard.press("Escape").catch(() => {});
      }
      result.tags = tagsOf(result);
      slides.push(result);
    }
  } finally {
    await reader.context.close();
  }
  return slides;
}

function tagsOf(result) {
  const tags = [];
  if (result.notDrawn) tags.push("not-drawn");
  if (result.missingFonts && result.missingFonts.length) tags.push("font-missing");
  if (result.error) tags.push("error");
  return tags;
}

const round = (value) => Math.round(value * 10000) / 10000;

function summarize(slides, decks) {
  const scored = slides.filter((s) => typeof s.ssim === "number");
  const withGain = scored.filter((s) => typeof s.gain === "number");
  const lineTotal = scored.reduce((sum, s) => sum + (s.lines ? s.lines.total : 0), 0);
  const lineMatched = scored.reduce((sum, s) => sum + (s.lines ? s.lines.matched : 0), 0);
  const bucket = (filter) => {
    const set = withGain.filter(filter);
    return { slides: set.length, gainMedian: quantile(set.map((s) => s.gain), 0.5), gainP10: quantile(set.map((s) => s.gain), 0.1) };
  };
  return {
    decks,
    slidesScored: scored.length,
    slidesWithError: slides.filter((s) => s.error).length,
    ssimMedian: quantile(scored.map((s) => s.ssim), 0.5),
    ssimP10: quantile(scored.map((s) => s.ssim), 0.1),
    blankMedian: quantile(scored.map((s) => s.blank), 0.5),
    gainSlides: withGain.length,
    gainMedian: quantile(withGain.map((s) => s.gain), 0.5),
    gainP10: quantile(withGain.map((s) => s.gain), 0.1),
    lines: { total: lineTotal, matched: lineMatched },
    buckets: {
      clean: bucket((s) => s.tags.length === 0),
      notDrawn: bucket((s) => s.tags.includes("not-drawn")),
      fontMissing: bucket((s) => s.tags.includes("font-missing")),
    },
    worst: [...withGain].sort((a, b) => a.gain - b.gain).slice(0, 10)
      .map((s) => ({ deck: s.deck, slide: s.slide, gain: s.gain, ssim: s.ssim, blank: s.blank, tags: s.tags })),
  };
}

const browser = await launch();
const compare = await browser.newPage();
const slides = [];
const decks = { inManifest: manifest.files.length, exportedByPowerPoint: 0, powerpointFailed: [], scored: 0, readerFailed: [] };
try {
  for (const file of manifest.files) {
    if (only.length && !only.includes(file.name)) continue;
    const recordFile = path.join(exportDir(file.name), "powerpoint.json");
    if (!existsSync(recordFile)) continue;
    const record = JSON.parse(readFileSync(recordFile, "utf8"));
    if (!record.ok) {
      decks.powerpointFailed.push(file.name);
      continue;
    }
    decks.exportedByPowerPoint += 1;
    try {
      const scored = await scoreDeck(browser, compare, file, record);
      slides.push(...scored);
      decks.scored += 1;
      const done = scored.filter((s) => typeof s.gain === "number");
      console.log(`${file.name}: ${scored.length} slides, median gain ${quantile(done.map((s) => s.gain), 0.5)}`);
    } catch (error) {
      decks.readerFailed.push({ deck: file.name, error: String(error.message || error).split("\n")[0].slice(0, 200) });
      console.log(`${file.name}: FAILED ${String(error.message || error).split("\n")[0]}`);
    }
  }
  const summary = summarize(slides, decks);
  const versions = { edge: browser.version(), powerpoint: [...new Set(manifest.files.map((f) => {
    const recordFile = path.join(exportDir(f.name), "powerpoint.json");
    return existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")).powerpoint : null;
  }).filter(Boolean))] };
  writeFileSync(outFile, JSON.stringify({ versions, summary, slides }, null, 1) + "\n");
  console.log(JSON.stringify({ versions, ...summary, worst: undefined }, null, 1));
  console.log("worst:", JSON.stringify(summary.worst, null, 1));
} finally {
  await browser.close();
}
