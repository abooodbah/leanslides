// Converts the ECMA-376 preset shape definitions (presetShapeDefinitions.xml,
// as Apache POI ships them) into assets/presets.json for the reader.
//
//   node tools/presets/convert-presets.mjs [path/to/presetShapeDefinitions.xml]
//
// Without a path it downloads the pinned file and checks its SHA-256. The
// output keeps only what drawing needs: adjust values, guides, the text
// rectangle, and the paths. Each shape is
//   {"av": [[name, formula]], "gd": [[name, formula]],
//    "rect": [l, t, r, b] | null,
//    "paths": [{"w": n, "h": n, "fill": "norm"|"none"|..., "stroke": bool,
//               "d": [["M", x, y], ["L", x, y], ["A", wR, hR, stAng, swAng],
//                     ["Q", x1, y1, x, y], ["C", x1, y1, x2, y2, x, y], ["Z"]]}]}
// where every coordinate is a guide name or a number written as a string.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/apache/poi/4793c3e741c2858bf29e728f13f617ee784243f4/" +
  "poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml";
const SHA256 = "4a762444d8d85876881c02a5b1dedf6f73006fcd8acb7b4e393435615b37c780";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function load() {
  const given = process.argv[2];
  const bytes = given ? readFileSync(given) : Buffer.from(await (await fetch(SOURCE)).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== SHA256) throw new Error(`presetShapeDefinitions.xml is ${hash}, expected ${SHA256}`);
  return bytes.toString("utf8");
}

// A small tokenizer for this regular, comment-free file.
function parse(xml) {
  const top = { name: "#root", attrs: {}, children: [] };
  const stack = [top];
  const tag = /<(\/)?([A-Za-z0-9_:]+)((?:\s+[A-Za-z0-9_:]+\s*=\s*"[^"]*")*)\s*(\/)?>|<\?[^>]*\?>/g;
  let match;
  while ((match = tag.exec(xml))) {
    if (!match[2]) continue;
    const [, closing, name, rawAttrs, selfClosing] = match;
    if (closing) {
      const done = stack.pop();
      if (done.name !== name) throw new Error(`mismatched </${name}> for <${done.name}>`);
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([A-Za-z0-9_:]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error("unclosed elements");
  return top.children[0];
}

const child = (node, name) => node.children.find((c) => c.name === name);
const guides = (node) => (node ? node.children.filter((c) => c.name === "gd").map((g) => [g.attrs.name, g.attrs.fmla]) : []);

function path(node) {
  const out = {
    w: node.attrs.w ? Number(node.attrs.w) : 0,
    h: node.attrs.h ? Number(node.attrs.h) : 0,
    fill: node.attrs.fill || "norm",
    stroke: node.attrs.stroke !== "false" && node.attrs.stroke !== "0",
    d: [],
  };
  for (const command of node.children) {
    const points = command.children.filter((c) => c.name === "pt").map((p) => [p.attrs.x, p.attrs.y]);
    switch (command.name) {
      case "moveTo": out.d.push(["M", ...points[0]]); break;
      case "lnTo": out.d.push(["L", ...points[0]]); break;
      case "quadBezTo": out.d.push(["Q", ...points[0], ...points[1]]); break;
      case "cubicBezTo": out.d.push(["C", ...points[0], ...points[1], ...points[2]]); break;
      case "arcTo": out.d.push(["A", command.attrs.wR, command.attrs.hR, command.attrs.stAng, command.attrs.swAng]); break;
      case "close": out.d.push(["Z"]); break;
      default: throw new Error(`unknown path command ${command.name}`);
    }
  }
  return out;
}

const definitions = parse(await load());
const presets = {};
for (const shape of definitions.children) {
  const rect = child(shape, "rect");
  const pathList = child(shape, "pathLst");
  presets[shape.name] = {
    av: guides(child(shape, "avLst")),
    gd: guides(child(shape, "gdLst")),
    rect: rect ? [rect.attrs.l, rect.attrs.t, rect.attrs.r, rect.attrs.b] : null,
    paths: pathList ? pathList.children.map(path) : [],
  };
}
const target = join(root, "assets", "presets.json");
writeFileSync(target, JSON.stringify(presets));
console.log(`${Object.keys(presets).length} presets written to ${target}`);
