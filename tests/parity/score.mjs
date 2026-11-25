// Scores for comparing the reader's slide with PowerPoint's export of the
// same slide. Pure functions over plain arrays, so they are tested without a
// browser (tests/parity/score.test.mjs).

// Structural similarity (SSIM) of two grey images of the same size, given as
// arrays of 0..255 values in rows. Mean over 8 x 8 windows moved 4 pixels at a
// time, with the usual constants for 8-bit images. 1 means identical.
export function ssim(a, b, width, height, window = 8, step = 4) {
  if (a.length !== width * height || b.length !== width * height) {
    throw new Error("ssim: images must both be width x height");
  }
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  const n = window * window;
  let total = 0;
  let count = 0;
  for (let y = 0; y + window <= height; y += step) {
    for (let x = 0; x + window <= width; x += step) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let dy = 0; dy < window; dy += 1) {
        let i = (y + dy) * width + x;
        for (let dx = 0; dx < window; dx += 1, i += 1) {
          const va = a[i];
          const vb = b[i];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      count += 1;
    }
  }
  return count ? total / count : 1;
}

// How far the drawing moves the score from the background alone towards a
// perfect match: 0 means no better than an empty slide with the right
// background, 1 means identical, and below 0 means worse than empty. Null
// when the background alone already matches (nothing on the slide to draw).
export function gain(score, blankScore) {
  if (blankScore >= 0.9999) return null;
  return (score - blankScore) / (1 - blankScore);
}

// One line of text as both sides write it: runs of white space, including the
// vertical tab and line separator PowerPoint uses for a line break, become one
// space, and the ends are trimmed.
export function normalizeLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// How many of PowerPoint's lines the reader also wrote as one line. Both
// sides are multisets, so a line repeated on the slide counts once per copy.
// PowerPoint's lines that are empty after normalizing are not counted.
export function lineAgreement(powerpointLines, readerLines) {
  const left = new Map();
  for (const line of readerLines.map(normalizeLine)) {
    left.set(line, (left.get(line) || 0) + 1);
  }
  let total = 0;
  let matched = 0;
  for (const line of powerpointLines.map(normalizeLine).filter(Boolean)) {
    total += 1;
    const remaining = left.get(line) || 0;
    if (remaining > 0) {
      matched += 1;
      left.set(line, remaining - 1);
    }
  }
  return { total, matched };
}

// Every text line PowerPoint recorded on a slide, from shapes and group
// children, in document order.
export function powerpointLines(slide) {
  const out = [];
  const visit = (shape) => {
    if (shape.visible === 0) return;
    for (const line of shape.lines || []) out.push(line.text);
    for (const child of shape.children || []) visit(child);
  };
  for (const shape of slide.shapes || []) visit(shape);
  return out;
}

// The value at a fraction (0..1) of a sorted copy of the numbers.
export function quantile(values, fraction) {
  const sorted = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((x, y) => x - y);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}
