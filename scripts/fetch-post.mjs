#!/usr/bin/env node
/**
 * fetch-post.mjs — 抓取社媒帖子，并自动展开引用链。
 *
 * 用法：
 *   node scripts/fetch-post.mjs https://x.com/user/status/1234567890
 *   node scripts/fetch-post.mjs 1234567890 --json --out post.json
 *   node scripts/fetch-post.mjs <url> --depth 3 --md
 *
 * 为什么存在这个脚本：
 *   一条"这也能联动？"式的转发帖本身几乎没有信息量，
 *   真正的素材在它引用的帖子里，往往还要再往下挖一层。
 *   手工挖容易漏，所以让脚本递归到底。
 *
 * 无第三方依赖，Node 18+ 即可运行。
 */

const MIRROR = "https://api.vxtwitter.com";

import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { ids: [], depth: 3, json: false, md: true, out: null, input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--md") args.md = true;
    else if (a === "--depth") args.depth = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--input") args.input = argv[++i];
    else if (!a.startsWith("-")) args.ids.push(a);
  }
  return args;
}

/** 从 URL 或裸 ID 里抠出 tweet id */
export function parseTweetId(input) {
  if (!input) return null;
  if (/^\d{6,}$/.test(input)) return input;
  // x.com/<user>/status/<id>、twitter.com/i/status/<id>、t.co 等
  const m = input.match(/(?:status|statuses)\/(\d+)/);
  if (m) return m[1];
  return null;
}

async function fetchOnce(id) {
  const url = `${MIRROR}/i/status/${id}`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; rednote-skill/1.0)" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`抓取失败 ${res.status} (${id}) ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 展开引用链。返回从外到内的数组。
 *
 * 注意：镜像有时只在第一层内嵌完整的 qrt 对象，
 * 更深层只给一个 qrtURL。所以这里两条路都走：
 *   有内嵌对象 → 直接用
 *   只有 URL   → 抠出 id 再请求一次
 */
export async function fetchChain(id, depth = 3) {
  const chain = [];
  let cursor = null;
  let currentId = id;

  for (let level = 0; level < depth; level++) {
    const data = cursor ?? (await fetchOnce(currentId));
    chain.push(data);

    if (data.qrt?.tweetID) {
      if (chain.some((t) => t.tweetID === data.qrt.tweetID)) break; // 防环
      cursor = data.qrt;
      continue;
    }

    const nextId = parseTweetId(data.qrtURL ?? "");
    if (nextId && !chain.some((t) => t.tweetID === nextId)) {
      cursor = null;
      currentId = nextId;
      continue;
    }
    break;
  }
  return chain;
}

function fmtDate(iso) {
  if (!iso) return "";
  // "Fri Oct 23 09:41:21 +0000 2026" → "2026-10-23 17:41 (+08)"
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toMarkdown(chain) {
  const lines = [];
  const total = chain.length;
  lines.push(`# 引用链（共 ${total} 层，由外向内）`);
  lines.push("");

  chain.forEach((t, i) => {
    const label =
      i === 0 ? "① 你给的帖子（最外层）"
      : i === total - 1 && total > 2 ? `③ 最内层 / 原始信息源`
      : `② 中间层 ${i}`;

    lines.push(`## ${label}`);
    lines.push("");
    lines.push(`- 作者：${t.user_name ?? "?"} (@${t.user_screen_name ?? "?"})`);
    lines.push(`- 时间：${fmtDate(t.date)}`);
    lines.push(`- 互动：赞 ${t.likes ?? 0} / 转 ${t.retweets ?? 0} / 评 ${t.replies ?? 0}`);
    if (t.mediaURLs?.length) {
      lines.push(`- 配图：${t.mediaURLs.length} 张`);
      t.mediaURLs.forEach((u) => lines.push(`  - ${u}`));
    }
    lines.push("");
    lines.push("```text");
    lines.push(t.text ?? "");
    lines.push("```");
    lines.push("");
  });

  lines.push("---");
  lines.push("");
  lines.push("## 下一步");
  lines.push("");
  lines.push("1. 确认哪一层才是真正的信息源（通常是最内层）");
  lines.push("2. 对里面的数字、书名、职务、编号逐条核实");
  lines.push("3. 再往下走文案和图");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let raw = args.ids.join(" ").trim();
  if (args.input) raw = (await import("node:fs/promises")).readFile(args.input, "utf8").catch(() => "");
  if (!raw) {
    console.error("用法: node scripts/fetch-post.mjs <url-or-id> [--json] [--out file]");
    process.exit(1);
  }

  const id = parseTweetId(raw);
  if (!id) {
    console.error("解析不出 tweet id。请传 x.com/.../status/<id> 形式的链接或纯数字 id。");
    process.exit(1);
  }

  try {
    const chain = await fetchChain(id, args.depth);
    const out = args.json ? JSON.stringify(chain, null, 2) : toMarkdown(chain);

    if (args.out) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(args.out, out, "utf8");
      console.error(`已写入 ${args.out}（${chain.length} 层）`);
    } else {
      process.stdout.write(out + "\n");
    }
  } catch (err) {
    console.error(`错误：${err.message}`);
    console.error("常见处理：");
    console.error("  1. 检查网络（curl -s -o /dev/null -w '%{http_code}' https://x.com）");
    console.error("  2. 换镜像或搜索引擎找转载");
    console.error("  3. 抓不到就让用户粘贴正文 —— 不要硬编");
    process.exit(1);
  }
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (isMain) main();
