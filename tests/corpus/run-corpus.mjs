#!/usr/bin/env node
// Runs leanslides-inspect on every cached corpus file: the deck index, then
// every slide model. Fails on a crash, a run over 20 s, an error code the
// manifest does not expect, or a slide that fails to build. Files over 2 s
// are reported.
//
// Usage: node tests/corpus/run-corpus.mjs [--inspect PATH] [--markdown]
// The inspect path can also come from LEANSLIDES_INSPECT. Without either, the
// script looks in build/*/tools/inspect/.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "..", "..");
const cacheRoot = join(here, "cache");
const hangMilliseconds = 20_000;
const slowMilliseconds = 2_000;
const markdown = process.argv.includes("--markdown");

function findInspect() {
  const flag = process.argv.indexOf("--inspect");
  if (flag >= 0 && process.argv[flag + 1]) {
    return resolve(process.argv[flag + 1]);
  }
  if (process.env.LEANSLIDES_INSPECT) {
    return resolve(process.env.LEANSLIDES_INSPECT);
  }
  const executable = process.platform === "win32" ? "leanslides-inspect.exe" : "leanslides-inspect";
  const build = join(repository, "build");
  if (existsSync(build)) {
    for (const entry of readdirSync(build).sort()) {
      for (const candidate of [
        join(build, entry, "tools", "inspect", executable),
        join(build, entry, "tools", "inspect", "Release", executable),
      ]) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  throw new Error("leanslides-inspect not found; pass --inspect PATH or set LEANSLIDES_INSPECT");
}

function run(inspect, args) {
  const started = Date.now();
  const result = spawnSync(inspect, args, {
    encoding: "utf8",
    timeout: hangMilliseconds,
    maxBuffer: 256 * 1024 * 1024,
  });
  result.wallMs = Date.now() - started;
  return result;
}

function failureOf(result) {
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM") {
    return `over ${hangMilliseconds / 1000} s`;
  }
  if (result.error || result.signal) {
    return `crashed (${result.error?.message ?? result.signal})`;
  }
  return "";
}

const inspect = findInspect();
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const rows = [];
let failures = 0;
let missing = 0;

for (const file of manifest.files) {
  const path = join(cacheRoot, file.name);
  if (!existsSync(path)) {
    missing += 1;
    continue;
  }
  const row = { name: file.name, kind: "", slides: "", errorCode: "", features: "", ms: "", status: "pass" };
  const index = run(inspect, ["--time", path]);
  const indexFailure = failureOf(index);
  if (indexFailure) {
    row.status = `FAIL: index ${indexFailure}`;
  } else {
    try {
      const report = JSON.parse(index.stdout.trim().split("\n")[0]);
      row.kind = report.kind;
      row.errorCode = report.errorCode ?? "";
      row.slides = report.slideCount ?? "";
      row.features = (report.features ?? []).map((f) => `${f.code} ${f.count}`).join(", ");
      row.ms = report.ms;
      if (row.errorCode !== (file.expectedErrorCode ?? "")) {
        row.status = `FAIL: expected "${file.expectedErrorCode ?? ""}"`;
      } else if (report.ok && report.slideCount > 0) {
        const slides = run(inspect, ["--all-slides", "--time", path]);
        const slideFailure = failureOf(slides);
        const lines = slides.stdout.trim().split("\n").filter(Boolean);
        if (slideFailure) {
          row.status = `FAIL: slides ${slideFailure}`;
        } else if (slides.status !== 0 || lines.length !== report.slideCount) {
          row.status = `FAIL: ${lines.length} of ${report.slideCount} slides built (${slides.stderr.trim().split("\n")[0]})`;
        } else {
          // JSON.parse throws on a malformed slide model, which fails the row.
          const slideMs = lines.map((line) => JSON.parse(line).ms).reduce((a, b) => a + b, 0);
          row.ms = `${report.ms} + ${slideMs.toFixed(1)}`;
          const details = run(inspect, ["--details", path]);
          const detailsFailure = failureOf(details);
          const detailsReport = detailsFailure ? null : JSON.parse(details.stdout.trim());
          if (detailsFailure || detailsReport.slides.length !== report.slideCount) {
            row.status = `FAIL: details ${detailsFailure || `${detailsReport.slides.length} of ${report.slideCount} slides`}`;
          }
          if (!row.status.startsWith("FAIL") && report.ms + slideMs > slowMilliseconds) {
            row.status = "pass (slow)";
          }
        }
      }
    } catch (error) {
      row.status = `FAIL: unreadable report (${error.message})`;
    }
  }
  if (row.status.startsWith("FAIL")) {
    failures += 1;
  }
  rows.push(row);
}

const columns = ["name", "kind", "slides", "errorCode", "features", "ms", "status"];
if (markdown) {
  console.log(`| ${columns.join(" | ")} |`);
  console.log(`| ${columns.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    console.log(`| ${columns.map((column) => String(row[column]).replaceAll("|", "\\|")).join(" | ")} |`);
  }
} else {
  const widths = columns.map((column) =>
    Math.min(60, Math.max(column.length, ...rows.map((row) => String(row[column]).length))));
  const line = (values) => values.map((value, i) => String(value).slice(0, 60).padEnd(widths[i])).join("  ");
  console.log(line(columns));
  for (const row of rows) {
    console.log(line(columns.map((column) => row[column])));
  }
}
console.log(`\n${rows.length} files run, ${failures} failed, ${missing} not fetched; inspect: ${inspect}`);
process.exit(failures === 0 && rows.length > 0 ? 0 : 1);
