#!/usr/bin/env node
/*
 * Local test receiver + web server, for piloting on your own computer.
 * Needs only Node.js (https://nodejs.org); no packages.
 *
 *   node receivers/local_test_server.js            (port 8787)
 *   node receivers/local_test_server.js 9000       (another port)
 *
 * Then open   http://localhost:8787/debug.html     (tick "Upload", URL http://localhost:8787/upload)
 *        or   http://localhost:8787/index.html?quick=1&pid=test1&skipcheck=1
 *             with CONFIG.DATA.UPLOAD_URL = "http://localhost:8787/upload" in js/config.js.
 *
 * It does exactly what the real receiver (Power Automate / Azure Function)
 * must do (see receivers/README.md):
 *   POST /upload, body = the participant JSON (Content-Type text/plain)
 *   → saves it unchanged to receivers/received/<upload.folder>/<upload.file_name>
 *   → 200 {"ok":true};  409 if that file already exists;  400 if invalid.
 *   Every reply carries Access-Control-Allow-Origin: *.
 * GET serves the study files from the project folder.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2]) || 8787;
const PROJECT = path.resolve(__dirname, "..");
const OUT = process.env.RECEIVED_DIR ? path.resolve(process.env.RECEIVED_DIR) : path.join(__dirname, "received");   // RECEIVED_DIR = save elsewhere
const FOLDERS = new Set(["complete", "progress", "quit"]);
const NAME_RE = /^[A-Za-z0-9_.-]{1,200}\.json$/;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

function reply(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj));
}

function handleUpload(req, res) {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BYTES) { reply(res, 413, { ok: false, error: "too large" }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    const text = Buffer.concat(chunks).toString("utf8");
    let j;
    try { j = JSON.parse(text); } catch (_) { return reply(res, 400, { ok: false, error: "body is not JSON" }); }
    const up = j && j.upload;
    if (!up || !FOLDERS.has(up.folder) || !NAME_RE.test(up.file_name || "") || up.file_name.includes("..")) {
      return reply(res, 400, { ok: false, error: "bad upload.folder / upload.file_name" });
    }
    const dir = path.join(OUT, up.folder);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, up.file_name);
    try {
      fs.writeFileSync(file, text, { flag: "wx" });          // wx = fail if it exists
    } catch (e) {
      if (e.code === "EEXIST") return reply(res, 409, { ok: false, error: "exists" });
      return reply(res, 500, { ok: false, error: String(e.message) });
    }
    const kb = (Buffer.byteLength(text) / 1024).toFixed(0);
    console.log(`${new Date().toISOString().slice(11, 19)}  saved ${up.folder}/${up.file_name}  (${kb} KB, status ${j.status}, last step ${j.last_step})`);
    reply(res, 200, { ok: true });
  });
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PROJECT, p));
  if (!file.startsWith(PROJECT) || file.startsWith(OUT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") return reply(res, 204, {});
  if (req.method === "POST" && req.url.split("?")[0] === "/upload") return handleUpload(req, res);
  if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
  reply(res, 405, { ok: false, error: "method not allowed" });
}).listen(PORT, () => {
  console.log(`Study:     http://localhost:${PORT}/index.html   ·   debug: http://localhost:${PORT}/debug.html`);
  console.log(`Receiver:  POST http://localhost:${PORT}/upload  →  ${OUT}${path.sep}<folder>${path.sep}<file>.json`);
  console.log("Press Ctrl+C to stop.\n");
});
