#!/usr/bin/env node
/*
 * Build js/image_manifest.js from the folders in images/.
 *
 *   Run after you add, remove or replace image files or condition folders:
 *     double-click tools/build_image_manifest.bat      (Windows)
 *     or:  node tools/build_image_manifest.js           (any system with Node.js)
 *
 * Why: a web page cannot list a folder on a web server, so the browser needs
 * a list of the files in each condition folder. This tool writes that list.
 *
 * Folder layout it understands (one folder per condition, any name):
 *   images/<condition>/*.jpg                 flat folder: one size
 *   images/<condition>/1280/*.jpg + 1920/    two sizes (same file names in both);
 *                                            the browser picks one per screen
 *   images/<condition>/exclude.txt           optional: file names never to show
 *                                            (one per line, # = comment)
 * Image types: .jpg .jpeg .png .gif .webp (and .bmp, though BMP files are
 * large: convert them to JPG for the web).
 *
 * For each image it records width, height, aspect ratio, "wide" (16:9,
 * aspect 1.72–1.82) and "hd" (long side ≥ 1900 px or short side ≥ 1060 px,
 * in the largest size: sharp on a full-HD screen).
 * Selection prefers wide + hd images (see CONFIG.IMAGES.MIX_OTHER_FRACTION).
 *
 * It also checks js/config.js: every condition in CONFIG.IMAGES.CONDITIONS
 * should have a folder with images, and should have enough of them.
 * No extra packages are needed.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PROJECT = path.resolve(__dirname, "..");
const IMAGES = path.join(PROJECT, "images");
const OUT = path.join(PROJECT, "js", "image_manifest.js");
const EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const WIDE_MIN = 1.72, WIDE_MAX = 1.82, HD_MIN = 1900, HD_SHORT_MIN = 1060;

// ── Image size from the file header (no packages needed) ─────────────────
function imageSize(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    const b = head.subarray(0, n);
    // PNG
    if (b.length > 24 && b.toString("ascii", 1, 4) === "PNG") return [b.readUInt32BE(16), b.readUInt32BE(20)];
    // GIF
    if (b.toString("ascii", 0, 3) === "GIF") return [b.readUInt16LE(6), b.readUInt16LE(8)];
    // BMP
    if (b.toString("ascii", 0, 2) === "BM") return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))];
    // WebP
    if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
      if (kind === "VP8L") { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
      if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    }
    // JPEG: walk the markers to the first SOF (read more of the file if needed)
    if (b[0] === 0xff && b[1] === 0xd8) {
      const whole = fs.readFileSync(file);
      let i = 2;
      while (i + 9 < whole.length) {
        if (whole[i] !== 0xff) { i++; continue; }
        const m = whole[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        const len = whole.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return [whole.readUInt16BE(i + 7), whole.readUInt16BE(i + 5)];
        }
        i += 2 + len;
      }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const isImage = (f) => EXT.has(path.extname(f).toLowerCase());
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };

function readExclude(dir) {
  const f = path.join(dir, "exclude.txt");
  if (!fs.existsSync(f)) return new Set();
  return new Set(fs.readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
}

function scanCondition(name) {
  const dir = path.join(IMAGES, name);
  const warnings = [];
  const entries = fs.readdirSync(dir);
  const tiers = entries.filter((e) => /^\d+$/.test(e) && isDir(path.join(dir, e))).sort((a, b) => Number(a) - Number(b));
  const exclude = readExclude(dir);
  let files, sizeDir;
  if (tiers.length) {
    const lists = tiers.map((t) => new Set(fs.readdirSync(path.join(dir, t)).filter(isImage)));
    files = [...lists[0]].filter((f) => lists.every((l) => l.has(f)));
    lists.forEach((l, i) => {
      const missing = [...l].filter((f) => !files.includes(f));
      if (missing.length) warnings.push(`${missing.length} file(s) only in ${name}/${tiers[i]}/ (ignored), e.g. ${missing.slice(0, 3).join(", ")}`);
    });
    sizeDir = path.join(dir, tiers[tiers.length - 1]);   // largest size
    const loose = entries.filter(isImage);
    if (loose.length) warnings.push(`${loose.length} image(s) directly in ${name}/ are ignored because it has size folders (${tiers.join(", ")})`);
  } else {
    files = entries.filter(isImage);
    sizeDir = dir;
  }
  const excluded = files.filter((f) => exclude.has(f));
  for (const x of exclude) if (!files.includes(x)) warnings.push(`exclude.txt lists "${x}", which is not in the folder`);
  files = files.filter((f) => !exclude.has(f)).sort(natural);

  const rows = [];
  let nBmp = 0;
  for (const f of files) {
    if (path.extname(f).toLowerCase() === ".bmp") nBmp++;
    let size = null;
    try { size = imageSize(path.join(sizeDir, f)); } catch (_) {}
    if (!size || !size[0] || !size[1]) { warnings.push(`cannot read the size of ${name}/${f}: skipped`); continue; }
    const [w, h] = size;
    const ar = Math.round((w / h) * 1000) / 1000;
    rows.push([f, w, h, ar, Number(ar >= WIDE_MIN && ar <= WIDE_MAX), Number(Math.max(w, h) >= HD_MIN || Math.min(w, h) >= HD_SHORT_MIN)]);
  }
  if (nBmp) warnings.push(`${nBmp} BMP file(s): they work but are large; converting them to JPG is recommended`);
  const badNames = files.filter((f) => /[#?%\\]/.test(f));
  if (badNames.length) warnings.push(`file names with # ? % or \\ may not load on a web server: ${badNames.slice(0, 3).join(", ")}`);
  return { name, tiers, rows, excluded, warnings };
}

// Read CONFIG from js/config.js (to check the conditions it names).
function readConfig() {
  try {
    const sandbox = { window: {}, location: { search: "" }, URLSearchParams };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(PROJECT, "js", "config.js"), "utf8"), sandbox);
    return sandbox.window.CONFIG || null;
  } catch (e) {
    console.warn("(could not read js/config.js to check conditions: " + e.message + ")");
    return null;
  }
}

function main() {
  if (!isDir(IMAGES)) { console.error(`No images folder at ${IMAGES}`); process.exit(1); }
  const folders = fs.readdirSync(IMAGES).filter((d) => isDir(path.join(IMAGES, d)) && !/^[._]/.test(d)).sort(natural);
  const out = {};
  const report = [];
  let warnCount = 0;
  for (const name of folders) {
    const r = scanCondition(name);
    if (!r.rows.length) { report.push(`  ${name.padEnd(20)} (no images, skipped)`); continue; }
    out[name] = { tiers: r.tiers, columns: ["file", "w", "h", "ar", "wide", "hd"], n: r.rows.length, excluded: r.excluded, images: r.rows };
    const nWideHd = r.rows.filter((x) => x[4] && x[5]).length;
    report.push(`  ${name.padEnd(20)} ${String(r.rows.length).padStart(5)} images   sizes: ${(r.tiers.join(" + ") || "one").padEnd(11)} wide+HD: ${String(nWideHd).padStart(4)}   excluded: ${r.excluded.length}`);
    for (const w of r.warnings) { report.push(`      ! ${w}`); warnCount++; }
  }

  const stamp = new Date().toISOString();
  let js = `/*\n * GENERATED by tools/build_image_manifest.js on ${stamp}. Do not edit by hand:\n` +
    ` * change the files in images/<condition>/ and run tools/build_image_manifest.bat again.\n *\n` +
    ` * One entry per folder in images/. columns: file, width, height (largest size),\n` +
    ` * aspect ratio, wide (16:9), hd (long side ≥ ${HD_MIN} or short side ≥ ${HD_SHORT_MIN} px). tiers = size subfolders.\n */\n`;
  js += "window.IMAGE_MANIFEST = {\n";
  for (const [name, m] of Object.entries(out)) {
    js += ` ${JSON.stringify(name)}: {"tiers": ${JSON.stringify(m.tiers)}, "columns": ${JSON.stringify(m.columns)}, "n": ${m.n}, "excluded": ${JSON.stringify(m.excluded)}, "images": [\n`;
    js += m.images.map((r) => "  " + JSON.stringify(r)).join(",\n");
    js += "\n ]},\n";
  }
  js += "};\n";
  fs.writeFileSync(OUT, js);

  console.log(`\nWrote ${path.relative(PROJECT, OUT)} (${Object.keys(out).length} folders):\n`);
  console.log(report.join("\n"));

  // Check against CONFIG.IMAGES
  const cfg = readConfig();
  if (cfg && cfg.IMAGES) {
    const need = cfg.IMAGES.N_IMAGES;
    console.log("\nConditions in js/config.js (CONFIG.IMAGES.CONDITIONS):");
    for (const [cond, c] of Object.entries(cfg.IMAGES.CONDITIONS || {})) {
      const folder = (c && c.folder) || cond;
      const m = out[folder];
      const inPool = (cfg.IMAGES.ASSIGN_FROM || []).includes(cond) ? "assigned at random" : "NOT in ASSIGN_FROM (only via ?condition=)";
      if (!m) { console.log(`  ! ${cond}: folder images/${folder}/ has no images: this condition cannot run`); warnCount++; continue; }
      const note = m.n < need ? (cfg.IMAGES.REPEAT_IF_FEWER ? `only ${m.n} < ${need}: images will repeat` : `only ${m.n} < ${need}: the block will be shorter`) : "ok";
      console.log(`  ${cond.padEnd(16)} → images/${folder}/  ${m.n} images, ${note}; ${inPool}`);
      if (m.n < need) warnCount++;
    }
    for (const c of cfg.IMAGES.ASSIGN_FROM || []) {
      if (!(cfg.IMAGES.CONDITIONS || {})[c]) { console.log(`  ! ASSIGN_FROM names "${c}", which is not in CONDITIONS`); warnCount++; }
    }
    const unused = Object.keys(out).filter((f) => !Object.entries(cfg.IMAGES.CONDITIONS || {}).some(([k, c]) => ((c && c.folder) || k) === f));
    if (unused.length) console.log(`  (folders not used by any condition: ${unused.join(", ")})`);
  }
  console.log(warnCount ? `\nDone, with ${warnCount} warning(s) (see "!").` : "\nDone, no warnings.");
}

main();
