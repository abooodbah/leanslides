// Unit tests for assets/geometry.js in plain Node: the guide formulas of
// ECMA-376 20.1.9.11, the preset shapes in assets/presets.json, arcs, and
// custom geometry. Run: node --test tests/reader/geometry.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const geometry = require(path.join(repository, "assets", "geometry.js"));
const presets = JSON.parse(readFileSync(path.join(repository, "assets", "presets.json"), "utf8"));

const DEGREE = 60000;

// Formulas are exact to 1e-6; path data is rounded to 3 decimals.
function close(actual, expected, message, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} is not ${expected}`);
}

function closePoint(actual, expected, message) {
  close(actual, expected, message, 2e-3);
}

// The numbers in an SVG path, in order.
function numbers(d) {
  return (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
}

function lastPoint(d) {
  const values = numbers(d);
  return [values[values.length - 2], values[values.length - 1]];
}

test("each formula operator follows 20.1.9.11", () => {
  const values = { a: 6, b: 4, c: 3 };
  const cases = [
    ["val 7", 7],
    ["val a", 6],
    ["*/ a b c", 8],
    ["*/ a b 0", 0],
    ["+- a b c", 7],
    ["+/ a b c", 10 / 3],
    ["+/ a b 0", 0],
    ["?: 1 2 3", 2],
    ["?: 0 2 3", 3],
    ["?: -1 2 3", 3],
    ["abs -5", 5],
    ["at2 1 1", 45 * DEGREE],
    ["cat2 10 1 0", 10],
    ["cat2 10 0 1", 10 * Math.cos(Math.PI / 2)],
    ["cos 10 0", 10],
    ["cos 10 5400000", 10 * Math.cos(Math.PI / 2)],
    ["max 2 9", 9],
    ["min 2 9", 2],
    ["mod 3 4 0", 5],
    ["pin 0 5 10", 5],
    ["pin 0 -1 10", 0],
    ["pin 0 11 10", 10],
    ["sat2 10 0 1", 10],
    ["sin 10 5400000", 10],
    ["sqrt 16", 4],
    ["sqrt -4", 0],
    ["tan 10 2700000", 10],
    ["unknown 1 2 3", 0],
    ["val missing", 0],
  ];
  for (const [formula, expected] of cases) {
    close(geometry.evaluate(formula, values), expected, formula);
  }
});

test("the built-in guides follow the box", () => {
  const values = geometry.guideValues({ av: [], gd: [] }, 200, 100);
  assert.equal(values.w, 200);
  assert.equal(values.h, 100);
  assert.equal(values.ss, 100);
  assert.equal(values.ls, 200);
  assert.equal(values.hc, 100);
  assert.equal(values.vc, 50);
  assert.equal(values.wd4, 50);
  assert.equal(values.hd3, 100 / 3);
  assert.equal(values.ssd8, 12.5);
  assert.equal(values.cd4, 5400000);
  assert.equal(values["3cd4"], 16200000);
});

test("a shape's own adjust value wins over the preset default", () => {
  const preset = { av: [["adj", "val 16667"]], gd: [["x1", "*/ ss adj 100000"]] };
  assert.equal(geometry.guideValues(preset, 100, 50).x1, 50 * 16667 / 100000);
  assert.equal(geometry.guideValues(preset, 100, 50, { adj: 50000 }).x1, 25);
});

test("adj and adj1 name the same single adjust value", () => {
  const one = geometry.build({ preset: "roundRect", adj: { adj: 50000 } }, 100, 50, presets);
  const other = geometry.build({ preset: "roundRect", adj: { adj1: 50000 } }, 100, 50, presets);
  const fallback = geometry.build({ preset: "roundRect" }, 100, 50, presets);
  assert.deepEqual(other, one);
  assert.notDeepEqual(fallback, one);
});

test("every preset builds finite paths at three box sizes", () => {
  const names = Object.keys(presets);
  assert.equal(names.length, 187);
  for (const name of names) {
    for (const [w, h] of [[100, 50], [37.5, 210], [1, 1]]) {
      const built = geometry.build({ preset: name }, w, h, presets);
      assert.ok(built, `${name} did not build`);
      for (const part of built.paths) {
        assert.ok(!/NaN|Infinity|undefined/.test(part.d), `${name} at ${w}x${h}: ${part.d.slice(0, 80)}`);
      }
      for (const key of ["l", "t", "r", "b"]) {
        assert.ok(Number.isFinite(built.rect[key]), `${name} text rectangle ${key}`);
      }
    }
  }
});

test("a rectangle is its box", () => {
  const built = geometry.build({ preset: "rect" }, 100, 50, presets);
  assert.deepEqual(built.paths, [{ d: "M0 0H100V50H0Z", fill: "norm", stroke: true }]);
  assert.deepEqual(built.rect, { l: 0, t: 0, r: 100, b: 50 });
  assert.deepEqual(geometry.build(undefined, 100, 50, presets), built);
});

test("an unknown preset returns null", () => {
  assert.equal(geometry.build({ preset: "noSuchShape" }, 100, 50, presets), null);
});

test("an ellipse closes where it starts and stays in its box", () => {
  const built = geometry.build({ preset: "ellipse" }, 200, 100, presets);
  const d = built.paths[0].d;
  assert.match(d, /^M0 50A/);
  const end = numbers(d.replace(/Z$/, ""));
  closePoint(end[end.length - 2], 0, "end x");
  closePoint(end[end.length - 1], 50, "end y");
  const arcs = d.split("A").slice(1).map((arc) => numbers(arc));
  for (const arc of arcs) {
    assert.equal(arc[0], 100, "x radius");
    assert.equal(arc[1], 50, "y radius");
    assert.ok(arc[5] >= -1e-3 && arc[5] <= 200.001 && arc[6] >= -1e-3 && arc[6] <= 100.001, `arc end ${arc}`);
  }
  // The text rectangle of an ellipse is inset (the "il", "it" guides).
  assert.ok(built.rect.l > 0 && built.rect.r < 200 && built.rect.t > 0 && built.rect.b < 100);
});

test("an arc of a full turn is drawn in two halves and returns to its start", () => {
  const built = geometry.build({
    paths: [{ w: 100, h: 100, d: [["M", "100", "50"], ["A", "50", "50", "0", "21600000"], ["Z"]] }],
  }, 100, 100, presets);
  const d = built.paths[0].d;
  assert.equal((d.match(/A/g) || []).length, 2);
  const values = numbers(d);
  closePoint(values[values.length - 2], 100, "end x");
  closePoint(values[values.length - 1], 50, "end y");
});

test("a quarter arc ends a quarter turn round, clockwise", () => {
  const built = geometry.build({
    paths: [{ w: 100, h: 100, d: [["M", "100", "50"], ["A", "50", "50", "0", "5400000"]] }],
  }, 100, 100, presets);
  const [x, y] = lastPoint(built.paths[0].d);
  closePoint(x, 50, "x");
  closePoint(y, 100, "y");
  assert.match(built.paths[0].d, /A50 50 0 0 1 /, "small arc, clockwise sweep");
});

test("an elliptical arc uses the visual angle", () => {
  // From the right end of a 200 x 100 ellipse, 45 degrees clockwise lands on
  // the ray at 45 degrees from the centre, not at parametric 45 degrees.
  const built = geometry.build({
    paths: [{ w: 200, h: 100, d: [["M", "200", "50"], ["A", "100", "50", "0", "2700000"]] }],
  }, 200, 100, presets);
  const [x, y] = lastPoint(built.paths[0].d);
  const t = Math.atan2(100 * Math.sin(Math.PI / 4), 50 * Math.cos(Math.PI / 4));
  closePoint(x, 100 + 100 * Math.cos(t), "x");
  closePoint(y, 50 + 50 * Math.sin(t), "y");
  close((y - 50) / (x - 100), 1, "on the 45 degree ray", 1e-4);
});

test("custom geometry scales its path units to the box", () => {
  const built = geometry.build({
    paths: [{ w: 10, h: 10, d: [["M", 0, 0], ["L", 10, 10], ["Q", 5, 0, 0, 10], ["C", 1, 2, 3, 4, 5, 6], ["Z"]] }],
  }, 100, 50, presets);
  assert.equal(built.paths[0].d, "M0 0L100 50Q50 0 0 50C10 10 30 20 50 30Z");
  assert.equal(built.rect, null);
  assert.equal(built.paths[0].fill, "norm");
  assert.equal(built.paths[0].stroke, true);
});

test("custom geometry keeps a path's fill and stroke choices", () => {
  const built = geometry.build({
    paths: [{ w: 1, h: 1, fill: false, stroke: false, d: [["M", 0, 0]] },
            { w: 1, h: 1, fill: "darken", d: [["M", 0, 0]] }],
  }, 10, 10, presets);
  assert.equal(built.paths[0].fill, "none");
  assert.equal(built.paths[0].stroke, false);
  assert.equal(built.paths[1].fill, "darken");
});

test("a preset path with its own size scales its coordinates to the box", () => {
  // flowChartDecision draws in a 2 x 2 space.
  const built = geometry.build({ preset: "flowChartDecision" }, 40, 10, presets);
  assert.equal(built.paths[0].d, "M0 5L20 0L40 5L20 10Z");
});
