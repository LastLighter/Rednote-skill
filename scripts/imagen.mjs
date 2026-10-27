#!/usr/bin/env node
/**
 * imagen.mjs — 调用图像模型批量出图（提交 → 轮询 → 下载）。
 *
 * 用法：
 *   node scripts/imagen.mjs --prompt-file p/01.md --prompt-file p/02.md --out-dir out/
 *   node scripts/imagen.mjs --prompt "3:4 竖版构图……" --out out/cover.jpg
 *   node scripts/imagen.mjs --prompt-file p/01.md --out-dir out/ --ref assets/persona.jpg
 *
 * 凭证读取顺序：
 *   1. --api-key / --base-url
 *   2. 环境变量 IMAGIFLY_API_KEY / IMAGIFLY_BASE_URL
 *   3. .env 文件（当前目录 → ./.baoyu-skills/imagifly/.env → ~/.baoyu-skills/imagifly/.env）
 *
 * 无第三方依赖，Node 18+。
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join, basename, extname, homedir } from "node:path";

const POLL_MS = 2500;
const MAX_CONCURRENCY = 8;

// ── 参数 ────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    promptFiles: [], prompts: [], outDir: null, out: null, refs: [],
    model: null, ratio: null, quality: null, tier: null, steps: null,
    concurrency: 3, timeout: 600, json: false,
    apiKey: null, baseUrl: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    switch (k) {
      case "--prompt-file": a.promptFiles.push(next()); break;
      case "--prompt": a.prompts.push(next()); break;
      case "--out-dir": a.outDir = next(); break;
      case "--out": a.out = next(); break;
      case "--ref": a.refs.push(next()); break;
      case "--model": a.model = next(); break;
      case "--ratio": a.ratio = next(); break;
      case "--quality": a.quality = next(); break;
      case "--tier":
      case "--resolution-tier": a.tier = next(); break;
      case "--steps": a.steps = next(); break;
      case "--concurrency": a.concurrency = Number(next()); break;
      case "--timeout": a.timeout = Number(next()); break;
      case "--api-key": a.apiKey = next(); break;
      case "--base-url": a.baseUrl = next(); break;
      case "--json": a.json = true; break;
      default:
        if (k.startsWith("-")) { console.error(`未知参数：${k}`); process.exit(1); }
    }
  }
  return a;
}

// ── 凭证 ────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function resolveSettings(args) {
  const candidates = [
    join(process.cwd(), ".env"),
    join(process.cwd(), ".baoyu-skills", "imagifly", ".env"),
    join(homedir(), ".baoyu-skills", "imagifly", ".env"),
  ];
  let env = {};
  for (const f of candidates) {
    const loaded = loadEnvFile(f);
    if (Object.keys(loaded).length) { env = { ...loaded, ...env }; }
  }

  const apiKey = args.apiKey ?? process.env.IMAGIFLY_API_KEY ?? env.IMAGIFLY_API_KEY;
  const baseUrl = args.baseUrl ?? process.env.IMAGIFLY_BASE_URL ?? env.IMAGIFLY_BASE_URL ?? "https://imagifly.net";

  if (!apiKey) {
    console.error("缺少 API key。任选其一：");
    console.error("  --api-key <key>");
    console.error("  环境变量 IMAGIFLY_API_KEY");
    console.error('  .env 里写 IMAGIFLY_API_KEY=xxx');
    process.exit(1);
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: args.model ?? process.env.IMAGIFLY_MODEL ?? env.IMAGIFLY_MODEL ?? "nano-banana-2",
    ratio: args.ratio ?? process.env.IMAGIFLY_RATIO ?? env.IMAGIFLY_RATIO ?? "3:4",
    quality: args.quality ?? env.IMAGIFLY_QUALITY ?? "high",
    tier: args.tier ?? env.IMAGIFLY_RESOLUTION_TIER ?? "2k",
    steps: args.steps ?? env.IMAGIFLY_STEPS,
    concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, args.concurrency)),
    timeoutMs: Math.max(30, args.timeout) * 1000,
  };
}

// ── 图片格式嗅探 ────────────────────────────────────────
/**
 * 模型经常返回 JPEG 却存成 .png。
 * 这个函数从文件头判断真实格式，并纠正扩展名。
 */
function sniffFormat(buf) {
  if (buf.length < 12) return { ext: ".bin", mime: "application/octet-stream" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: ".png", mime: "image/png" };
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return { ext: ".webp", mime: "image/webp" };
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { ext: ".gif", mime: "image/gif" };
  return { ext: ".bin", mime: "application/octet-stream" };
}

function mimeFor(path) {
  const e = extname(path).toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  return "application/octet-stream";
}

// ── API ─────────────────────────────────────────────────
async function submit(settings, job) {
  const body = {
    model: settings.model,
    prompt: job.prompt,
    ratio: settings.ratio,
    quality: settings.quality,
    resolutionTier: settings.tier,
    steps: settings.steps || undefined,
    referenceImages: settings.referenceImages.length ? settings.referenceImages : undefined,
  };

  const res = await fetch(`${settings.baseUrl}/api/v1/images/generations`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": settings.apiKey },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch {
    throw new Error(`非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !payload?.generation?.id) {
    throw new Error(`${payload?.error ?? `HTTP_${res.status}`}: ${payload?.message ?? "提交失败"}`);
  }
  return payload.generation;
}

async function poll(settings, id) {
  const deadline = Date.now() + settings.timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const res = await fetch(`${settings.baseUrl}/api/v1/images/generations/${encodeURIComponent(id)}`, {
      headers: { "x-api-key": settings.apiKey },
    });
    const payload = await res.json().catch(() => ({}));
    const g = payload?.generation;
    if (!g) throw new Error(`状态响应异常 (HTTP ${res.status})`);
    if (g.status === "success") {
      if (!g.imageUrls?.length) throw new Error("生成成功但没有返回图片");
      return g;
    }
    if (g.status === "failed") throw new Error(`生成失败：${g.error ?? "未知原因"}`);
  }
  throw new Error(`超时（${Math.round(settings.timeoutMs / 1000)}s）`);
}

async function download(url, outPathNoExt) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const fmt = sniffFormat(buf);

  // 纠正扩展名，避免出现"是 JPEG 却叫 .png"
  const wanted = extname(outPathNoExt);
  const finalPath = wanted && wanted.toLowerCase() !== fmt.ext
    ? outPathNoExt.slice(0, -wanted.length) + fmt.ext
    : outPathNoExt;

  mkdirSync(dirname(finalPath), { recursive: true });
  writeFileSync(finalPath, buf);
  return { path: finalPath, bytes: buf.length, format: fmt.mime, corrected: finalPath !== outPathNoExt };
}

// ── 主流程 ──────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = resolveSettings(args);

  settings.referenceImages = args.refs.map((p) => {
    const abs = resolve(p);
    if (!existsSync(abs)) { console.error(`参考图不存在：${abs}`); process.exit(1); }
    return { mimeType: mimeFor(abs), base64: readFileSync(abs).toString("base64") };
  });

  const jobs = [];
  for (const f of args.promptFiles) {
    const abs = resolve(f);
    if (!existsSync(abs)) { console.error(`提示词文件不存在：${abs}`); process.exit(1); }
    jobs.push({ prompt: readFileSync(abs, "utf8"), name: basename(abs, extname(abs)) });
  }
  for (const p of args.prompts) jobs.push({ prompt: p, name: `inline-${jobs.length + 1}` });

  if (!jobs.length) {
    console.error("没有任务。用 --prompt-file 或 --prompt 指定。");
    process.exit(1);
  }

  if (args.outDir && !existsSync(args.outDir)) mkdirSync(args.outDir, { recursive: true });

  console.error(`模型 ${settings.model} · 画幅 ${settings.ratio} · ${settings.tier} · ${jobs.length} 个任务`);

  let cursor = 0;
  const results = new Array(jobs.length);

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= jobs.length) return;
      const job = jobs[idx];
      const label = `[${idx + 1}/${jobs.length}]`;
      try {
        const gen = await submit(settings, job);
        const done = await poll(settings, gen.id);
        const prefix = args.outDir ? `${String(idx + 1).padStart(2, "0")}-` : "";
        const target = args.outDir
          ? join(args.outDir, `${prefix}${job.name}.png`)
          : resolve(args.out);
        const saved = await download(done.imageUrls[0], target);
        results[idx] = { ok: true, ...saved, name: job.name };
        console.error(`${label} ok  ${saved.path}  (${(saved.bytes / 1024 / 1024).toFixed(1)} MB ${saved.format})`);
      } catch (err) {
        results[idx] = { ok: false, name: job.name, error: err.message };
        console.error(`${label} 失败 ${job.name}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: settings.concurrency }, worker));

  const failed = results.filter((r) => !r.ok);
  if (args.json) process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  console.error(`\n完成：${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.error("失败明细：");
    failed.forEach((f) => console.error(`  - ${f.name}: ${f.error}`));
    console.error("提示：图内中文错字、构图太空，都算失败品，请重新生成而不是将就。");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`致命错误：${err.message}`);
  process.exit(1);
});
