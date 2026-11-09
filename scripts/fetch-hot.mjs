#!/usr/bin/env node
/**
 * fetch-hot.mjs — 拉取小红书「热门 / 推荐 / 分类」帖子列表，以及单篇正文。
 *
 * 用法：
 *   node scripts/fetch-hot.mjs                          # 推荐流，按点赞排序，markdown 表格
 *   node scripts/fetch-hot.mjs --channel 美食            # 分类流（也可传 homefeed.food_v3）
 *   node scripts/fetch-hot.mjs --limit 15 --json        # JSON 输出，方便喂给别的步骤
 *   node scripts/fetch-hot.mjs --detail 3               # 再抓前 3 条的正文
 *
 * 为什么能免登录：
 *   xiaohongshu.com/explore 的 SSR 会把首屏 feed 直接写进 window.__INITIAL_STATE__。
 *   但服务端只在对的请求头下才吐这份数据 —— 实测必须同时有 user-agent 和
 *   accept-encoding: gzip, deflate, br，少一个就退化成 36KB 的空壳（feeds=0）。
 *
 * 限制（别指望脚本绕过去）：
 *   - 一次只有首屏 ~25–34 条，翻页走的是 homefeed 接口，需要 x-s 签名。
 *     想要更多：换 channel、重复拉（推荐流每次都不同）、或人工给关键词。
 *   - 搜索 / 关注 / 消息需要登录态，这里不做。
 *
 * 无第三方依赖，Node 18+ 即可运行。
 */

import { pathToFileURL } from "node:url";

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "zh-CN,zh;q=0.9",
  "accept-encoding": "gzip, deflate, br",
};

export const CHANNELS = {
  推荐: "homefeed_recommend",
  穿搭: "homefeed.fashion_v3",
  美食: "homefeed.food_v3",
  彩妆: "homefeed.cosmetics_v3",
  影视: "homefeed.movie_and_tv_v3",
  职场: "homefeed.career_v3",
  情感: "homefeed.love_v3",
  家居: "homefeed.household_product_v3",
  游戏: "homefeed.gaming_v3",
  旅行: "homefeed.travel_v3",
  健身: "homefeed.fitness_v3",
  视频: "homefeed.video_v3",
};

function parseArgs(argv) {
  const args = { channel: "推荐", limit: 20, json: false, detail: 0, sort: "likes", out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--channel") args.channel = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--detail") args.detail = Number(argv[++i]);
    else if (a === "--sort") args.sort = argv[++i];
    else if (a === "--json") args.json = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

/** "5.6万" / "1.2w" / "3122" → 数字 */
export function toCount(s) {
  if (s == null) return 0;
  const str = String(s).trim();
  const m = str.match(/^([\d.]+)\s*([万wW千kK]?)\+?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mul = unit === "万" || unit === "w" ? 1e4 : unit === "千" || unit === "k" ? 1e3 : 1;
  return Math.round(n * mul);
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

export function parseState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/);
  if (!m) throw new Error("页面里没有 __INITIAL_STATE__，多半是被风控/换了新版");
  // xhs 的 SSR 里塞了裸 undefined，不是合法 JSON
  return JSON.parse(m[1].trim().replace(/\bundefined\b/g, "null"));
}

/** 把 noteCard 拍平成我们要的字段 */
export function normalize(item) {
  const card = item.noteCard ?? {};
  const user = card.user ?? {};
  const token = item.xsecToken || user.xsecToken || "";
  return {
    id: item.id,
    type: card.type === "video" ? "视频" : "图文",
    title: (card.displayTitle ?? "").trim() || "(无标题)",
    author: user.nickname ?? user.nickName ?? "?",
    likes: card.interactInfo?.likedCount ?? null,
    likesNum: toCount(card.interactInfo?.likedCount),
    cover: card.cover?.url || pickCover(card.cover),
    url:
      `https://www.xiaohongshu.com/explore/${item.id}` +
      (token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_feed` : ""),
  };
}

function pickCover(cover) {
  const list = cover?.infoList ?? [];
  const hit = list.find((i) => i.imageScene === "WB_DFT") ?? list[0];
  return hit?.url ?? "";
}

export async function fetchFeed(channel = "推荐") {
  const id = CHANNELS[channel] ?? channel;
  const url = `https://www.xiaohongshu.com/explore?channel_id=${encodeURIComponent(id)}`;
  const state = parseState(await fetchHtml(url));
  const feeds = state?.feed?.feeds ?? [];
  if (!feeds.length) {
    throw new Error(`feeds=0（channel=${id}）。检查请求头是否带 accept-encoding: br，或稍后重试`);
  }
  return feeds.map(normalize);
}

/** 抓单篇正文。必须带列表里那颗 xsecToken，否则 noteDetailMap 是空的 */
export async function fetchNote(note) {
  const state = parseState(await fetchHtml(note.url));
  const entry = state?.note?.noteDetailMap?.[note.id];
  const detail = entry?.note;
  if (!detail) return { ...note, desc: "", tags: [], fail: true };
  return {
    ...note,
    title: (detail.title ?? "").trim() || note.title,
    desc: detail.desc ?? "",
    tags: (detail.tagList ?? []).map((t) => t.name).filter(Boolean),
    likes: detail.interactInfo?.likedCount ?? note.likes,
    likesNum: toCount(detail.interactInfo?.likedCount ?? note.likes),
    collected: detail.interactInfo?.collectedCount ?? null,
    comments: detail.interactInfo?.commentCount ?? null,
    fail: false,
  };
}

export function toMarkdown(rows, channel) {
  const lines = [`# 小红书热门 · ${channel}流`, "", `共 ${rows.length} 条，按点赞排序`, ""];
  lines.push("| # | 标题 | 作者 | 点赞 | 类型 |");
  lines.push("|---|---|---|---|---|");
  rows.forEach((r, i) => {
    const title = r.title.replace(/\|/g, "／").slice(0, 40);
    lines.push(`| ${i + 1} | [${title}](${r.url}) | ${r.author} | ${r.likes ?? "?"} | ${r.type} |`);
  });
  const withDesc = rows.filter((r) => r.desc);
  if (withDesc.length) {
    lines.push("", "---", "", "## 正文");
    for (const r of withDesc) {
      lines.push("", `### ${r.title}`, "", `@${r.author} · 赞 ${r.likes ?? "?"}`, "", "```text", r.desc, "```");
    }
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/fetch-hot.mjs [--channel 推荐|美食|...] [--limit 20] [--detail 3] [--json] [--out file]");
    console.log("频道:", Object.keys(CHANNELS).join(" / "));
    return;
  }

  try {
    let rows = await fetchFeed(args.channel);
    if (args.sort === "likes") rows.sort((a, b) => b.likesNum - a.likesNum);
    rows = rows.slice(0, args.limit);

    if (args.detail > 0) {
      const n = Math.min(args.detail, rows.length);
      for (let i = 0; i < n; i++) {
        rows[i] = await fetchNote(rows[i]);
        await new Promise((r) => setTimeout(r, 400)); // 别把风控惹毛
      }
    }

    const out = args.json ? JSON.stringify(rows, null, 2) : toMarkdown(rows, args.channel);
    if (args.out) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(args.out, out, "utf8");
      console.error(`已写入 ${args.out}（${rows.length} 条）`);
    } else {
      process.stdout.write(out + "\n");
    }
  } catch (err) {
    console.error(`错误：${err.message}`);
    console.error("排查：");
    console.error("  1. 换网络/稍等再试（免登录接口有频控）");
    console.error("  2. 确认请求头带 user-agent + accept-encoding: br");
    console.error("  3. 还是不行就人工给帖子链接 —— 不要编数据");
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
