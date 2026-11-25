// Turns the PowerPoint export (tests/parity/cache/powerpoint/*/powerpoint.json,
// made by Export-PowerPoint.ps1 on a machine with PowerPoint) into
// tests/model/expectations.json: for every visible slide shape, its box in
// points, rotation, text, first font size and name, group children, and
// table size. The model check compares the core's output with this file, so
// CI can run it without PowerPoint.
//
//   node tests/parity/extract-expectations.mjs

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const exportDir = join(root, "tests", "parity", "cache", "powerpoint");
const output = join(root, "tests", "model", "expectations.json");

const round = (value) => Math.round(Number(value) * 100) / 100;

function shapeOf(record) {
  const shape = {
    id: record.id,
    name: record.name,
    type: record.type,
    box: [round(record.left), round(record.top), round(record.width), round(record.height)],
  };
  if (record.rotation) shape.rot = round(record.rotation);
  if (record.placeholder) shape.ph = record.placeholder;
  if (typeof record.text === "string" && record.text.length > 0) {
    shape.text = record.text;
    if (record.fontSize > 0) shape.fontSize = round(record.fontSize);
    if (record.fontName) shape.fontName = record.fontName;
  }
  if (record.rows) shape.table = [record.rows, record.columns];
  if (Array.isArray(record.children) && record.children.length > 0) {
    shape.children = record.children.filter((child) => child.visible !== 0).map(shapeOf);
  }
  return shape;
}

const decks = {};
for (const folder of readdirSync(exportDir).sort()) {
  const file = join(exportDir, folder, "powerpoint.json");
  if (!existsSync(file)) continue;
  const data = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  if (!data.ok) continue;
  decks[data.name] = {
    slideWidth: data.slideWidth,
    slideHeight: data.slideHeight,
    slides: data.slides.map((slide) => ({
      index: slide.index,
      hidden: Boolean(slide.hidden),
      shapes: (slide.shapes || []).filter((shape) => shape.visible !== 0).map(shapeOf),
    })),
  };
}

const source = {
  note: "Measured with PowerPoint (Slide.Shapes through COM) by tests/parity/Export-PowerPoint.ps1. Boxes are in points.",
  decks,
};
writeFileSync(output, JSON.stringify(source, null, 1) + "\n");
console.log(`${Object.keys(decks).length} decks written to ${output}`);
