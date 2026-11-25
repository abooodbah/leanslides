// Compares the core's slide models with what PowerPoint measured
// (tests/model/expectations.json) for every corpus deck in the cache.
//
//   node tests/model/check-model.mjs [--inspect PATH] [--cache DIR] [--verbose] [--report FILE]
//
// Shapes are matched by id among the slide's own shapes (not the master's or
// layout's). For each matched shape it checks the box (every edge within
// 1 pt), the plain text, the first run's font size (within 0.5 pt) and font
// name, and a table's row and column count. Each rate must stay at or above
// its floor in FLOORS; the floors are the measured rates of the last change,
// so a change that lowers one fails.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const verbose = args.includes("--verbose");
const exe = process.platform === "win32" ? "leanslides-inspect.exe" : "leanslides-inspect";
const inspect = option("--inspect", join(root, "build", "Release", "tools", "inspect", exe));
const cache = option("--cache", join(root, "tests", "corpus", "cache"));
const reportPath = option("--report", "");

// Floors, as fractions. Raise them when a change improves a rate.
const FLOORS = {
  found: 1,
  box: 0.9995, // 2074 of 2075: one table whose saved row heights are taller than PowerPoint shows
  text: 1,
  fontSize: 1,
  fontName: 1,
  table: 1,
};
const MINIMUM_DECKS = 100;
const EMU_PER_POINT = 12700;

const expectations = JSON.parse(readFileSync(join(root, "tests", "model", "expectations.json"), "utf8"));

const totals = Object.fromEntries(Object.keys(FLOORS).map((key) => [key, { pass: 0, total: 0 }]));
const misses = [];
let decksChecked = 0;
const malformed = [];

function count(key, pass, detail) {
  totals[key].total += 1;
  if (pass) totals[key].pass += 1;
  else misses.push({ key, ...detail });
}

function normalizeText(text) {
  return String(text)
    .replace(/\r\n?|\v|\n/g, "\n")
    .replace(/[ \t \n]+$/g, "")
    .replace(/^[\n]+/, "");
}

function modelText(text) {
  if (!text || !Array.isArray(text.paragraphs)) return "";
  return text.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => (run.br ? "\n" : run.t)).join(""))
    .join("\n");
}

// PowerPoint reports the font of the text frame's first character, which is
// the first paragraph's first run, line break, or (for an empty paragraph)
// its paragraph mark. A line break or paragraph mark carries only a size in
// the model, so those are not compared by font name.
function firstRun(text) {
  if (!text || !Array.isArray(text.paragraphs) || text.paragraphs.length === 0) return null;
  const paragraph = text.paragraphs[0];
  const scale = text.fontScale ?? 1;
  const run = paragraph.runs[0];
  if (run && !run.br) return { size: run.size, font: run.font, scale };
  return { size: run ? run.size : paragraph.endSize, font: undefined, scale };
}

function hasDateField(text) {
  return Boolean(text?.paragraphs?.some((paragraph) =>
    paragraph.runs.some((run) => typeof run.field === "string" && run.field.startsWith("datetime"))));
}

// The model keeps a group's children unrotated and the group carries its
// rotation and flips (the reader turns the whole group). PowerPoint reports
// each child where it lands, so the check moves each leaf's centre through
// its ancestors' flips and rotations, innermost first.
function place(shape, ancestors) {
  let cx = shape.x + shape.w / 2;
  let cy = shape.y + shape.h / 2;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const group = ancestors[index];
    const gx = group.x + group.w / 2;
    const gy = group.y + group.h / 2;
    if (group.flipH) cx = 2 * gx - cx;
    if (group.flipV) cy = 2 * gy - cy;
    const angle = ((group.rot || 0) * Math.PI) / 180;
    const dx = cx - gx;
    const dy = cy - gy;
    cx = gx + dx * Math.cos(angle) - dy * Math.sin(angle);
    cy = gy + dx * Math.sin(angle) + dy * Math.cos(angle);
  }
  return { ...shape, x: cx - shape.w / 2, y: cy - shape.h / 2 };
}

// A group's leaf shapes, with nested groups flattened as PowerPoint lists
// them. A SmartArt drawing is one shape to PowerPoint.
function leaves(group, ancestors = [], out = []) {
  const chain = [...ancestors, group];
  for (const shape of group.children) {
    if (shape.kind === "group" && !shape.diagram && Array.isArray(shape.children)) leaves(shape, chain, out);
    else out.push(place(shape, chain));
  }
  return out;
}

function indexById(shapes, map = new Map()) {
  for (const shape of shapes) {
    if (!map.has(shape.id)) map.set(shape.id, shape);
  }
  return map;
}

function compareShape(deck, slide, expected, actual) {
  const where = { deck, slide, id: expected.id, name: expected.name };
  count("found", Boolean(actual), where);
  if (!actual) return;
  const box = [actual.x, actual.y, actual.w, actual.h].map((value) => value / EMU_PER_POINT);
  // PowerPoint grows table rows to fit their text and reports the grown
  // height; the model keeps the saved height and the reader grows rows the
  // same way, so a table's height may only be shorter than PowerPoint's.
  const edges = box.map((value, index) => Math.abs(value - expected.box[index]));
  if (expected.table) edges[3] = Math.max(0, box[3] - expected.box[3]);
  const worst = Math.max(...edges);
  count("box", worst <= 1, { ...where, expected: expected.box, actual: box.map((v) => Math.round(v * 100) / 100) });

  // Date fields show today's date in PowerPoint; the model keeps the saved text.
  if (expected.text !== undefined && !hasDateField(actual.text)) {
    const want = normalizeText(expected.text);
    const got = normalizeText(modelText(actual.text));
    count("text", want === got, { ...where, expected: want.slice(0, 80), actual: got.slice(0, 80) });
    const first = firstRun(actual.text);
    if (expected.fontSize !== undefined && first) {
      const size = first.scale === 1 ? first.size : Math.round(first.size * first.scale);
      count("fontSize", Math.abs(size - expected.fontSize) <= 0.5, { ...where, expected: expected.fontSize, actual: size });
    }
    if (expected.fontName && first && first.font !== undefined) {
      const name = String(first.font || "");
      count("fontName", name.toLowerCase() === expected.fontName.toLowerCase(), { ...where, expected: expected.fontName, actual: name });
    }
  }
  if (expected.table) {
    const rows = Array.isArray(actual.rows) ? actual.rows.length : 0;
    const cols = Array.isArray(actual.cols) ? actual.cols.length : 0;
    count("table", rows === expected.table[0] && cols === expected.table[1], { ...where, expected: expected.table, actual: [rows, cols] });
  }
  if (expected.children && Array.isArray(actual.children)) {
    // PowerPoint lists a group's leaf shapes, with nested groups flattened.
    const children = indexById(leaves(actual));
    for (const child of expected.children) compareShape(deck, slide, child, children.get(child.id));
  }
}

if (!existsSync(inspect)) {
  console.error(`inspect tool not found: ${inspect}`);
  process.exit(2);
}

for (const [name, deck] of Object.entries(expectations.decks)) {
  const file = join(cache, ...name.split("/"));
  if (!existsSync(file)) continue;
  const run = spawnSync(inspect, ["--all-slides", file], { encoding: "utf8", maxBuffer: 1 << 30, timeout: 60000 });
  const models = new Map();
  for (const line of (run.stdout || "").split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const model = JSON.parse(line);
      if (typeof model.index === "number") models.set(model.index + 1, model);
    } catch (error) {
      malformed.push(`${name}: ${error.message}`);
    }
  }
  decksChecked += 1;
  for (const slide of deck.slides) {
    const model = models.get(slide.index);
    const own = model ? indexById(model.shapes.filter((shape) => !shape.layer)) : new Map();
    for (const shape of slide.shapes) compareShape(name, slide.index, shape, own.get(shape.id));
  }
}

const rates = {};
let failed = decksChecked < MINIMUM_DECKS || malformed.length > 0;
for (const line of malformed) console.log(`FAIL malformed slide model in ${line}`);
for (const [key, { pass, total }] of Object.entries(totals)) {
  const rate = total === 0 ? 0 : pass / total;
  rates[key] = { pass, total, rate: Math.round(rate * 10000) / 10000 };
  const ok = rate + 1e-9 >= FLOORS[key];
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${key.padEnd(9)} ${pass}/${total} = ${(rate * 100).toFixed(2)}% (floor ${(FLOORS[key] * 100).toFixed(2)}%)`);
}
console.log(`${decksChecked} decks checked (at least ${MINIMUM_DECKS} required)`);

if (verbose) {
  for (const miss of misses) console.log(JSON.stringify(miss));
}
if (reportPath) writeFileSync(reportPath, JSON.stringify({ decksChecked, rates, misses }, null, 1));
process.exit(failed ? 1 : 0);
