// Tests for the parity scores (tests/parity/score.mjs).
//
//   node --test tests/parity/score.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { gain, lineAgreement, normalizeLine, powerpointLines, quantile, ssim } from "./score.mjs";

const W = 64;
const H = 48;

// A white image with a dark 20 x 12 box whose top left corner is at (x, y).
function boxImage(x, y) {
  const image = new Array(W * H).fill(255);
  for (let row = y; row < y + 12; row += 1) {
    for (let column = x; column < x + 20; column += 1) image[row * W + column] = 30;
  }
  return image;
}

test("an image scores 1 against itself", () => {
  const image = boxImage(10, 10);
  assert.equal(ssim(image, image, W, H), 1);
});

test("a shifted box scores lower than the same box, and lower again when shifted further", () => {
  const base = boxImage(10, 10);
  const near = ssim(base, boxImage(12, 10), W, H);
  const far = ssim(base, boxImage(30, 26), W, H);
  assert.ok(near < 1, `a 2 px shift scores below 1 (${near})`);
  assert.ok(far < near, `a far shift scores below a near one (${far} < ${near})`);
});

test("a blank page is the floor: the drawn box beats it, and gain puts blank at 0 and a match at 1", () => {
  const target = boxImage(10, 10);
  const blank = new Array(W * H).fill(255);
  const blankScore = ssim(target, blank, W, H);
  const drawnScore = ssim(target, boxImage(11, 10), W, H);
  assert.ok(blankScore < drawnScore, `blank ${blankScore} < drawn ${drawnScore}`);
  assert.equal(gain(blankScore, blankScore), 0);
  assert.equal(gain(1, blankScore), 1);
  assert.ok(gain(drawnScore, blankScore) > 0 && gain(drawnScore, blankScore) < 1);
  // A slide with nothing on it has no gain to measure.
  assert.equal(gain(1, 1), null);
});

test("ssim refuses images of the wrong size", () => {
  assert.throws(() => ssim([1, 2, 3], [1, 2, 3], W, H), /width x height/);
});

test("line agreement counts PowerPoint's lines the reader wrote the same way", () => {
  assert.equal(normalizeLine("  Lorem ipsum\u000bdolor  "), "Lorem ipsum dolor");
  assert.deepEqual(lineAgreement(["Lorem ipsum dolor sit amet, ", "consectetur adipiscing elit."],
    ["Lorem ipsum dolor sit amet,", "consectetur adipiscing", "elit."]), { total: 2, matched: 1 });
  // A line PowerPoint has twice is matched twice only if the reader has it twice.
  assert.deepEqual(lineAgreement(["Item", "Item"], ["Item"]), { total: 2, matched: 1 });
  assert.deepEqual(lineAgreement(["", "  "], ["x"]), { total: 0, matched: 0 });
});

test("PowerPoint lines are read from shapes and group children, skipping hidden shapes", () => {
  const slide = { shapes: [
    { lines: [{ text: "Title" }] },
    { visible: 0, lines: [{ text: "Hidden" }] },
    { children: [{ lines: [{ text: "In a group" }] }, { visible: 0, lines: [{ text: "Hidden child" }] }] },
  ] };
  assert.deepEqual(powerpointLines(slide), ["Title", "In a group"]);
});

test("quantile reads the sorted values and ignores missing ones", () => {
  assert.equal(quantile([3, 1, 2, null, 5, 4], 0.5), 3);
  assert.equal(quantile([3, 1, 2, 5, 4], 0), 1);
  assert.equal(quantile([3, 1, 2, 5, 4], 1), 5);
  assert.equal(quantile([], 0.5), null);
  // A missing value is left out, not read as 0 (null - 10 sorts as 0 - 10).
  assert.equal(quantile([null, 10, 20], 0), 10);
  // Between two ranks the nearer one is taken, rounding half up.
  assert.equal(quantile([1, 2, 3, 4], 0.5), 3);
});
