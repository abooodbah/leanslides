#!/usr/bin/env node
// Checks the LeanSlides site with Node.js built-ins only, in the style of the
// LeanDoc and LeanRows site validators:
//
//   node site/validate.mjs
//
// It checks the page structure, links and local assets, alt text, PNG sizes,
// scripts, the version against package.json, the release asset names, that
// every number in the page text is on the list of measured facts, sentence-case
// headings, and the writing rules over every text file in site/.
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const siteRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(siteRoot, "..");
const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);
function requireMatch(value, pattern, message) {
  if (!pattern.test(value)) fail(message);
}

const html = await readFile(resolve(siteRoot, "index.html"), "utf8");
const css = await readFile(resolve(siteRoot, "styles.css"), "utf8");
const version = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")).version;
const tag = `v${version}`;
const siteUrl = "https://abooodbah.github.io/leanslides/";
const repoUrl = "https://github.com/abooodbah/leanslides";

// --- Required files ----------------------------------------------------------

const required = [
  ".nojekyll",
  "index.html",
  "styles.css",
  "robots.txt",
  "sitemap.xml",
  "site.webmanifest",
  "assets/leanslides-icon.png",
  "assets/leanslides-icon.svg",
  "assets/leanslides-window.png",
  "assets/social-preview.png",
];
for (const file of required) {
  try {
    if (!(await stat(resolve(siteRoot, file))).isFile()) fail(`required path is not a file: ${file}`);
  } catch {
    fail(`missing required site file: ${file}`);
  }
}

// --- Document structure -------------------------------------------------------

requireMatch(html, /^<!doctype html>/i, "index.html must start with an HTML5 doctype");
requireMatch(html, /<html\s+lang="en">/i, "the document language must be declared");
requireMatch(html, /<meta\s+charset="utf-8">/i, "the character set must be declared");
requireMatch(html, /<meta\s+name="viewport"/i, "the viewport meta tag is required");
requireMatch(html, /<meta\s+name="description"\s+content="[^"]{40,}"/i, "a meta description is required");
requireMatch(html, /<title>[^<]*LeanSlides[^<]*<\/title>/i, "the title must name LeanSlides");
if (!html.includes(`<link rel="canonical" href="${siteUrl}">`)) fail(`the canonical URL must be ${siteUrl}`);
if (!html.includes(`<meta property="og:image" content="${siteUrl}assets/social-preview.png">`)) {
  fail("the Open Graph image must be the social preview");
}
requireMatch(html, /<meta\s+property="og:image:width"\s+content="1280">/, "og:image:width must be 1280");
requireMatch(html, /<meta\s+property="og:image:height"\s+content="640">/, "og:image:height must be 640");
requireMatch(html, /<meta\s+property="og:image:alt"\s+content="[^"]{40,}"/, "og:image:alt needs descriptive text");
requireMatch(html, /<main\s+id="main-content">/i, "a named main landmark is required");
requireMatch(html, /class="skip-link"\s+href="#main-content"/i, "a skip link to the main content is required");
requireMatch(html, /Show the slides, not the office suite\./, "the hero must state the promise");
requireMatch(html, /<h1>[^<]*presentation viewer[^<]*<\/h1>/, "the h1 must name what LeanSlides is in search words");
for (const id of ["features", "fidelity", "speed", "safety", "download", "faq", "family", "privacy-policy"]) {
  if (!new RegExp(`<section class="[^"]*" id="${id}" aria-labelledby="${id}-heading">`).test(html)) {
    fail(`the page must keep its #${id} section, labelled by #${id}-heading`);
  }
}
requireMatch(html, /<h2 id="privacy-policy-heading">Privacy policy<\/h2>/,
  "the page must have a section titled Privacy policy");
requireMatch(html, /This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it\./,
  "the privacy policy must state the privacy sentence");
requireMatch(html, /WebView2 Runtime[^.]*Microsoft component[^.]*\.[^.]*contact Microsoft on its own/,
  "the privacy policy must say the WebView2 Runtime is a Microsoft component that may contact Microsoft");
requireMatch(html, /LeanSlides's own code makes no network requests/,
  "the page must say what LeanSlides's own code does on the network");
// No network measurement has been made yet; the page must not claim one.
if (/(?:measured|tested|verified|confirmed|monitored)[^.]{0,80}no network requests/i.test(html) ||
    /no network requests[^.]{0,40}(?:measured|tested|verified|confirmed|monitored)/i.test(html)) {
  fail("the page claims a network measurement that has not been made");
}
requireMatch(html, /not\s+code-signed/i, "the page must say plainly that the build is not code-signed");
requireMatch(html, /SmartScreen/, "the page must say SmartScreen may warn");
requireMatch(html, /WebView2 Runtime that Windows already has/, "the page must name the WebView2 Runtime it uses");
requireMatch(html, /bundles no browser/, "the page must say LeanSlides bundles no browser");
requireMatch(html, /installer\\install\.ps1/, "the page must name the per-user installer");
requireMatch(html, /no admin rights/, "the page must say the installer needs no admin rights");
requireMatch(html, /labelled placeholder/, "the page must say what shows instead of linked content");
requireMatch(html, /href="https:\/\/abooodbah\.github\.io\/"/, "the page must link the author's page");
for (const app of ["leanmark", "leandoc", "leanrows"]) {
  if (!html.includes(`href="https://abooodbah.github.io/${app}/"`)) fail(`the family section must link the ${app} site`);
}

const h1Count = (html.match(/<h1\b/gi) ?? []).length;
if (h1Count !== 1) fail(`expected exactly one h1; found ${h1Count}`);

// --- Version and structured data ----------------------------------------------

const structured = html.match(/<script\s+type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/i);
if (!structured) {
  fail("SoftwareApplication JSON-LD is required");
} else {
  try {
    const data = JSON.parse(structured[1]);
    if (data["@type"] !== "SoftwareApplication" || data.name !== "LeanSlides") {
      fail("JSON-LD must describe the LeanSlides SoftwareApplication");
    }
    if (data.softwareVersion !== version) {
      fail(`JSON-LD softwareVersion is ${data.softwareVersion}; package.json is ${version}`);
    }
    if (data.downloadUrl !== `${repoUrl}/releases/tag/${tag}`) {
      fail(`JSON-LD downloadUrl must be the ${tag} release page`);
    }
    // codeRepository belongs to SoftwareSourceCode, not SoftwareApplication;
    // the repository goes in sameAs.
    if ("codeRepository" in data) fail("JSON-LD must not use codeRepository on a SoftwareApplication; use sameAs");
    if (!Array.isArray(data.sameAs) || !data.sameAs.includes(repoUrl)) fail(`JSON-LD sameAs must list ${repoUrl}`);
    if (data.screenshot !== `${siteUrl}assets/leanslides-window.png`) {
      fail("JSON-LD screenshot must be the published window capture");
    }
    if (!/^Windows 10, Windows 11$/.test(data.operatingSystem ?? "")) {
      fail("JSON-LD operatingSystem must be Windows 10 and Windows 11 only");
    }
    // LeanSlides has no ratings or reviews to show; structured data must not invent them.
    for (const key of ["aggregateRating", "review"]) {
      if (key in data) fail(`JSON-LD must not contain ${key}`);
    }
  } catch (error) {
    fail(`JSON-LD must contain valid JSON: ${error.message}`);
  }
}
for (const match of html.matchAll(/\bv(\d+\.\d+\.\d+)\b/g)) {
  if (match[1] !== version) fail(`the page names v${match[1]}; package.json is ${version}`);
}
if (!html.includes(`${tag} ·`)) fail(`the release line must name ${tag}`);
if (!html.includes(`href="${repoUrl}/releases/tag/${tag}"`)) fail(`the page must link the ${tag} release page`);

// --- Release asset names ---------------------------------------------------------
// The release publishes one Windows ZIP and its checksum file.

const zipName = `LeanSlides-${tag}-windows-x64.zip`;
const releaseAssets = [zipName, `${zipName}.sha256`];
const mentioned = [...html.matchAll(/LeanSlides-v[0-9A-Za-z.]+-[A-Za-z]+[0-9A-Za-z._-]*/g)]
  .map((m) => m[0].replace(/[.]+$/, ""));
for (const name of mentioned) {
  if (!releaseAssets.includes(name)) fail(`the page names ${name}, which the ${tag} release does not publish`);
}
const downloadBase = `${repoUrl}/releases/download/${tag}/`;
for (const asset of releaseAssets) {
  if (!html.includes(`href="${downloadBase}${asset}"`)) fail(`the page must link the release asset ${downloadBase}${asset}`);
}
for (const match of html.matchAll(/href="(https:\/\/github\.com\/abooodbah\/leanslides\/releases\/download\/[^"]+)"/g)) {
  const asset = match[1].slice(downloadBase.length);
  if (!match[1].startsWith(downloadBase) || !releaseAssets.includes(asset)) {
    fail(`download link does not point at a ${tag} release asset: ${match[1]}`);
  }
}
if (!html.includes(`gh attestation verify ${zipName} --repo abooodbah/leanslides`)) {
  fail("the page must give the gh attestation verify command for the release ZIP");
}

// --- Links, assets, images, and scripts -----------------------------------------

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const match of html.matchAll(/href="#([^"]*)"/g)) {
  if (!ids.has(match[1])) fail(`same-page link has no target: #${match[1]}`);
}
for (const match of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
  if (!ids.has(match[1])) fail(`aria-labelledby points at a missing id: ${match[1]}`);
}

async function checkLocal(value, from) {
  if (/^(?:https?:|mailto:|data:|#)/i.test(value)) return;
  // A folder link such as "some-guide/" is served from its index.html.
  const target = value.split(/[?#]/, 1)[0];
  const path = resolve(siteRoot, target.endsWith("/") ? `${target}index.html` : target);
  if (path !== siteRoot && !path.startsWith(siteRoot + sep)) {
    fail(`${from}: local reference escapes site/: ${value}`);
    return;
  }
  try {
    if (!(await stat(path)).isFile()) fail(`${from}: local reference is not a file: ${value}`);
  } catch {
    fail(`${from}: missing local reference: ${value}`);
  }
}
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) await checkLocal(match[1], "index.html");
for (const match of css.matchAll(/url\("?([^")]+)"?\)/g)) await checkLocal(match[1], "styles.css");
const manifest = JSON.parse(await readFile(resolve(siteRoot, "site.webmanifest"), "utf8"));
for (const icon of manifest.icons ?? []) await checkLocal(icon.src, "site.webmanifest");
if (manifest.name !== "LeanSlides") fail("site.webmanifest must name LeanSlides");

const allowedHosts = new Set(["https://github.com", "https://abooodbah.github.io", "https://opensource.org", "https://schema.org"]);
for (const match of html.matchAll(/(?:href|src|content)="(https?:\/\/[^"/]+)/g)) {
  if (!allowedHosts.has(match[1])) fail(`unexpected external host: ${match[1]}`);
}
for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
  if (!/type="application\/ld\+json"/i.test(match[1])) {
    fail(`only the JSON-LD block may be a script; found <script${match[1]}>`);
  }
}
if (/@import\s+url\(\s*["']?https?:/i.test(css) || /url\(\s*["']?https?:/i.test(css)) {
  fail("styles.css must not load anything from another host");
}

// Reads a PNG's size, and guesses whether it is still a one-colour placeholder:
// a capture inflates to many distinct byte values, a flat fill to a handful.
async function inspectPng(file) {
  const png = await readFile(resolve(siteRoot, file));
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG file");
  const idat = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const pixels = inflateSync(Buffer.concat(idat));
  const distinct = new Set();
  for (let i = 0; i < pixels.length && distinct.size < 16; i += 1) distinct.add(pixels[i]);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), flat: distinct.size < 16 };
}

for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
  const attributes = match[1];
  const alt = attributes.match(/\salt="([^"]*)"/);
  const src = attributes.match(/\ssrc="([^"]+)"/)?.[1] ?? "(no src)";
  if (!alt) {
    fail(`image has no alt attribute: ${src}`);
    continue;
  }
  const decorative = /leanslides-icon\.(svg|png)$/.test(src);
  if (!decorative && alt[1].trim().length < 40) fail(`image needs descriptive alt text: ${src}`);
  if (!/\swidth="\d+"/.test(attributes) || !/\sheight="\d+"/.test(attributes)) {
    fail(`image needs width and height attributes: ${src}`);
  }
  if (src.endsWith(".png")) {
    try {
      const { width, height } = await inspectPng(src);
      const declared = [attributes.match(/\swidth="(\d+)"/)?.[1], attributes.match(/\sheight="(\d+)"/)?.[1]].map(Number);
      if (!src.includes("icon") && (declared[0] !== width || declared[1] !== height)) {
        fail(`${src} is ${width}x${height} but the page declares ${declared[0]}x${declared[1]}`);
      }
    } catch (error) {
      fail(`${src} could not be inspected: ${error.message}`);
    }
  }
}
requireMatch(html, /<img src="assets\/leanslides-window\.png"\s+width="1440"\s+height="900"\s+alt="[^"]{40,}"/,
  "the hero must show assets/leanslides-window.png at 1440x900 with alt text");

const pngSizes = [
  ["assets/leanslides-window.png", 1440, 900, true],
  ["assets/social-preview.png", 1280, 640, true],
  ["assets/leanslides-icon.png", 256, 256, false],
];
for (const [file, width, height, capture] of pngSizes) {
  try {
    const png = await inspectPng(file);
    if (png.width !== width || png.height !== height) fail(`${file} is ${png.width}x${png.height}; it must be ${width}x${height}`);
    if (capture && png.flat) warnings.push(`${file} looks like a one-colour placeholder; replace it with the real capture`);
  } catch (error) {
    if (error.code !== "ENOENT") fail(`${file} could not be inspected: ${error.message}`);
    // A missing file is reported above as a missing required file.
  }
}

// --- Search engine files -----------------------------------------------------------

const robots = await readFile(resolve(siteRoot, "robots.txt"), "utf8").catch(() => "");
if (!robots.split(/\r?\n/).includes(`Sitemap: ${siteUrl}sitemap.xml`)) fail("robots.txt must name the sitemap");
const sitemap = await readFile(resolve(siteRoot, "sitemap.xml"), "utf8").catch(() => "");
if (!sitemap.includes(`<loc>${siteUrl}</loc>`)) fail("sitemap.xml must list the site URL");
requireMatch(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, "sitemap.xml must give a lastmod date");
if (!html.includes(`<link rel="alternate" type="application/atom+xml" title="LeanSlides releases" href="${repoUrl}/releases.atom">`)) {
  fail("index.html must link the releases Atom feed");
}

// --- Task pages ---------------------------------------------------------------------
// Each one is plain HTML in its own folder, uses the same style sheet, is linked
// from index.html, and is listed in the sitemap. It loads no script at all.
// There are none yet; add the folder name here when one is written.

const taskPages = [];
const pages = [["index.html", html]];
for (const slug of taskPages) {
  const name = `${slug}/index.html`;
  const page = await readFile(resolve(siteRoot, name), "utf8").catch(() => null);
  if (page === null) {
    fail(`missing task page: ${name}`);
    continue;
  }
  pages.push([name, page]);
  const url = `${siteUrl}${slug}/`;
  requireMatch(page, /^<!doctype html>/i, `${name} must start with an HTML5 doctype`);
  requireMatch(page, /<html\s+lang="en">/i, `${name} must declare its language`);
  requireMatch(page, /<meta\s+name="description"\s+content="[^"]{40,}"/i, `${name} needs a meta description`);
  requireMatch(page, /<title>[^<]*LeanSlides[^<]*<\/title>/i, `${name} title must name LeanSlides`);
  if (!page.includes(`<link rel="canonical" href="${url}">`)) fail(`${name} canonical must be ${url}`);
  if (!page.includes(`<link rel="stylesheet" href="../styles.css">`)) fail(`${name} must use the site style sheet`);
  if ((page.match(/<h1\b/gi) ?? []).length !== 1) fail(`${name} must have exactly one h1`);
  if (/<script\b/i.test(page)) fail(`${name} must not contain a script`);
  if (!html.includes(`href="${slug}/"`)) fail(`index.html must link the task page ${slug}/`);
  if (!sitemap.includes(`<loc>${url}</loc>`)) fail(`sitemap.xml must list ${url}`);
  const pageIds = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const match of page.matchAll(/href="#([^"]*)"/g)) {
    if (!pageIds.has(match[1])) fail(`${name}: same-page link has no target: #${match[1]}`);
  }
  for (const match of page.matchAll(/href="\.\.\/#([^"]+)"/g)) {
    if (!ids.has(match[1])) fail(`${name}: link to index.html#${match[1]} has no target`);
  }
  for (const match of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const value = match[1];
    if (/^(?:https?:|mailto:|data:|#)/i.test(value)) continue;
    await checkLocal(`${slug}/${value}`, name);
  }
  for (const match of page.matchAll(/(?:href|src|content)="(https?:\/\/[^"/]+)/g)) {
    if (!allowedHosts.has(match[1])) fail(`${name}: unexpected external host: ${match[1]}`);
  }
  for (const match of page.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\salt="[^"]*"/.test(match[1])) fail(`${name}: image has no alt attribute`);
    if (!/\swidth="\d+"/.test(match[1]) || !/\sheight="\d+"/.test(match[1])) fail(`${name}: image needs width and height`);
  }
}
for (const entry of await readdir(siteRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "assets") continue;
  const hasPage = await stat(resolve(siteRoot, entry.name, "index.html")).then(() => true, () => false);
  if (hasPage && !taskPages.includes(entry.name)) fail(`${entry.name}/index.html is not in taskPages, so it is not checked`);
}

// --- What a reader sees: numbers and headings ------------------------------------------

function decode(text) {
  return text.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}
function readerText(page) {
  const body = page.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const attributes = [...body.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/gi)].map((m) => m[1]);
  const metas = [...body.matchAll(/<meta\s+(?:name|property)="(?:description|og:title|og:description|og:image:alt)"\s+content="([^"]*)"/gi)]
    .map((m) => m[1]);
  return decode([body.replace(/<[^>]+>/g, " "), ...attributes, ...metas].join("\n"));
}

// Every number a reader can see must come from the release facts. Names that
// contain digits are listed in nameTokens and removed first; any other digit
// run, even one glued to a unit such as "450ms", must be in allowedNumbers.
// Add a new measurement here with its source.
const allowedNumbers = new Set([
  // Windows 10 and 11.
  "10", "11",
  // ZIP size, about 0.9 MB (907,437 bytes measured with the static runtimes).
  "0.9",
  // Fidelity, 2026-11-25, against PowerPoint 16.0: 550 slides from 145 decks;
  // 2,992 of 3,130 text lines (95.6%); median SSIM 0.88 against 0.74; median
  // gain 0.41; 63 of 531 slides below their empty slide; text about 20 px lower.
  "2026", "25", "16.0", "550", "145", "3,130", "2,992", "95.6", "0.88", "0.74", "0.41", "63", "531", "20",
  // Start-up and memory, 2026-11-25, WebView2 158, medians of 10 launches.
  "158", "114", "424", "89.4", "23", "0.9", "455", "99.0", "240", "46", "513", "150.8", "294.4", "523",
  // The tab shortcuts Ctrl+1 to Ctrl+9.
  "1", "9",
  // The audience list markers.
  "01", "02", "03",
]);
// The version is checked against package.json above.
const nameTokens = /\bv\d+\.\d+\.\d+\b|\bx64\b|\bWebView2\b|\bF5\b|\bi7-13620H\b|\b(?:SHA|sha)256\b|\b3D\b|\.ps1\b/g;
const numberPattern = /(?<![0-9.,])[0-9]+(?:[.,][0-9]+)*/g;
const properNouns = new Set([
  "LeanSlides", "LeanMark", "LeanDoc", "LeanRows", "PowerPoint", "Microsoft", "Office", "Windows", "Edge",
  "WebView2", "Runtime", "SmartArt", "ActiveX", "OLE", "GitHub", "Mac", "Linux", "MIT", "SSIM", "I",
  "English", "Chinese", "Japanese", "Simplified", "Ctrl", "Esc", "F5", "FAQ", "ZIP",
]);
for (const [name, page] of pages) {
  const text = readerText(page).replace(nameTokens, " ");
  for (const match of text.matchAll(numberPattern)) {
    if (!allowedNumbers.has(match[0])) {
      fail(`${name} shows the number ${match[0]}, which is not in the release facts (near "${text.slice(Math.max(0, match.index - 30), match.index + 30).replace(/\s+/g, " ").trim()}")`);
    }
  }
  for (const match of page.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const heading = decode(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const words = heading.split(" ").slice(1);
    for (const raw of words) {
      const word = raw.replace(/'s$/, "").replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9]+$/g, "");
      if (/^[A-Z]/.test(word) && !properNouns.has(word)) {
        fail(`${name}: heading "${heading}" is not in sentence case ("${word}")`);
      }
    }
  }
}

// --- Accessibility and responsive CSS --------------------------------------------------

requireMatch(css, /:focus-visible\s*\{[^}]*outline:/s, "visible focus styles are required");
requireMatch(css, /prefers-reduced-motion:\s*reduce/i, "reduced-motion support is required");
requireMatch(css, /prefers-color-scheme:\s*dark/i, "dark appearance support is required");
requireMatch(css, /@media\s*\(max-width:\s*68rem\)/i, "tablet layout rules are required");
requireMatch(css, /@media\s*\(max-width:\s*52rem\)/i, "phone layout rules are required");

// --- Writing rules over every text file in site/, this one included ----------------------

// Built from parts so this file does not contain the words it bans.
const join = (...parts) => parts.join("");
const bannedPhrases = [
  join("bla", "zing"), join("seam", "less"), join("cutting", "-edge"), join("revolu", "tionary"),
  join("world", "-class"), join("light", "ning"), join("effort", "less"), join("power", "ful"),
  join("rob", "ust"), join("ultra", "-lightweight"), join("zero", " dependency"), join("zero", "-dependency"),
  join("lorem", " ipsum"), join("no network", " access"),
];
const bannedWords = [
  [new RegExp(join("\\bsec", "ure(?:ly)?\\b"), "i"), "a safety claim; state what the code does instead"],
  [new RegExp(join("\\bnat", "ive(?:ly)?\\b"), "i"), "LeanSlides draws with WebView2; do not call it that"],
  [new RegExp(join("\\bTO", "DO\\b|\\bTB", "D\\b")), "an unfinished-work marker"],
];
const attribution = [
  join("co-authored", "-by"), join("clau", "de"), join("anthro", "pic"), join("generated", " with"),
];
const textTypes = new Set([".html", ".css", ".mjs", ".md", ".txt", ".xml", ".webmanifest", ".svg", ".json"]);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}
for (const path of await walk(siteRoot)) {
  if (!textTypes.has(extname(path)) && !path.endsWith(`${sep}.nojekyll`)) continue;
  const name = relative(siteRoot, path);
  const text = await readFile(path, "utf8");
  if (text.includes(String.fromCharCode(0x2014))) fail(`${name} contains an em dash (U+2014)`);
  const lower = text.toLowerCase();
  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase)) fail(`${name} uses the banned phrase "${phrase}"`);
  }
  for (const [pattern, why] of bannedWords) {
    const hit = text.match(pattern);
    if (hit) fail(`${name} uses "${hit[0]}": ${why}`);
  }
  for (const marker of attribution) {
    if (lower.includes(marker)) fail(`${name} contains attribution (${marker})`);
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (failures.length > 0) {
  console.error("LeanSlides site validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`LeanSlides site validation passed for ${tag} (structure, links, assets, release names, numbers, headings, and wording).`);
}
