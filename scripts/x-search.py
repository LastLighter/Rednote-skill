#!/usr/bin/env python3
"""Search X posts through Apify and rank them by bookmark/like ratio.

The script is deliberately dependency-free (Python 3.9+ standard library only)
so it can be dropped into any workspace.

Usage
-----
    set APIFY_API_TOKEN=apify_api_xxx

    python scripts/x-search.py --query "(burnout OR \"return to office\") lang:en min_faves:800 since:2026-07-01 -filter:replies -filter:nativeretweets" --name work --max 30

Environment variables (used when the flag is omitted)
-----------------------------------------------------
    APIFY_API_TOKEN   Apify token
    X_QUERY           default search query
    X_MAX             default max items (30)

Output
------
    <out>/<name>.json   raw dataset items (one tweet object per row)
    stdout              a table sorted by bookmark/like ratio

Exit codes: 0 ok, 1 request/parse error, 2 bad arguments.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ACTOR = "xquik/x-tweet-scraper"
ENDPOINT = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items".format(
    actor=ACTOR.replace("/", "~")
)
PRICE_PER_ITEM = 0.00015  # USD, pay-per-result
DEFAULT_OUT = Path("data") / "x"


def _stdout_utf8() -> None:
    """Windows consoles default to cp936; text has emoji and CJK."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass


def _get(obj: dict, *path, default=None):
    cur = obj
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur


def _short(text: str, limit: int = 110) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _date(raw: str) -> str:
    raw = str(raw or "")
    for fmt in ("%a %b %d %H:%M:%S %z %Y", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw[:10]


def _num(item: dict, *path) -> int:
    try:
        return int(_get(item, *path) or 0)
    except (TypeError, ValueError):
        return 0


def fetch(query: str, token: str, max_items: int, timeout: int = 300) -> list[dict]:
    payload = {
        "searchTerms": [query],
        "maxItems": max_items,
        "queryType": "Latest + Top",
        "outputVariant": "rich",
        "fieldStyle": "camelCase",
        "outputPreset": "flat",
    }
    url = ENDPOINT + "?" + urllib.parse.urlencode({"token": token, "clean": "true"})
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as exc:  # 4xx / 5xx carry a JSON reason
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise SystemExit(f"[error] HTTP {exc.code} from Apify: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"[error] cannot reach Apify: {exc.reason}") from exc

    try:
        items = json.loads(body)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"[error] non-JSON response (HTTP {status}): {body[:300]}") from exc

    if not isinstance(items, list):
        raise SystemExit(f"[error] unexpected response shape: {str(items)[:300]}")

    # apidojo/x-tweet-scraper signals quota exhaustion as a single success row.
    if len(items) == 1 and isinstance(items[0], dict) and items[0].get("noResults"):
        raise SystemExit(
            "[warn] dataset is empty AND the run reported SUCCEEDED.\n"
            "       Most likely cause: the actor's monthly free-run quota is exhausted\n"
            "       (see references/topic-mining.md, section 3.2), not an empty query.\n"
            "       Try the other actor or a paid run before changing the query."
        )
    return items


def rank(items: list[dict], sort: str) -> list[dict]:
    rows = []
    for item in items:
        likes = _num(item, "likeCount")
        bookmarks = _num(item, "bookmarkCount")
        ratio = (bookmarks / likes) if likes else None
        rows.append(
            {
                "ratio": ratio,
                "likes": likes,
                "bookmarks": bookmarks,
                "views": _num(item, "viewCount"),
                "followers": _num(item, "authorFollowers")
                or _num(item, "author", "followers"),
                "author": item.get("authorUsername") or _get(item, "author", "userName") or "?",
                "date": _date(item.get("createdAt", "")),
                "url": item.get("tweetUrl") or item.get("url") or "",
                "text": _short(item.get("text", "")),
                "raw": item,
            }
        )

    def key(row: dict):
        if sort == "likes":
            return (row["likes"], row["bookmarks"])
        if sort == "bookmarks":
            return (row["bookmarks"], row["likes"])
        if sort == "views":
            return (row["views"], row["likes"])
        return (row["ratio"] or -1, row["bookmarks"])

    return sorted(rows, key=key, reverse=True)


def render(rows: list[dict], top: int) -> str:
    head = f"{'藏/赞':>6} {'赞':>7} {'收藏':>6} {'粉丝':>6} {'日期':<10} {'账号':<16} 原文"
    lines = [head, "-" * len(head)]
    for row in rows[:top]:
        ratio = "   -  " if row["ratio"] is None else f"{row['ratio']:6.2f}"
        lines.append(
            f"{ratio} {row['likes']:>7} {row['bookmarks']:>6} {row['followers']:>6} "
            f"{row['date']:<10} {('@' + str(row['author']))[:16]:<16} {row['text']}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    _stdout_utf8()

    parser = argparse.ArgumentParser(description="Search X posts and rank by bookmark/like ratio.")
    parser.add_argument("--query", default=os.environ.get("X_QUERY", ""), help="X advanced-search query")
    parser.add_argument("--name", default="search", help="output file stem")
    parser.add_argument("--max", type=int, default=int(os.environ.get("X_MAX", "30")), help="max items")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output directory")
    parser.add_argument("--token", default=os.environ.get("APIFY_API_TOKEN", ""), help="Apify token")
    parser.add_argument("--sort", choices=("ratio", "likes", "bookmarks", "views"), default="ratio")
    parser.add_argument("--top", type=int, default=12, help="rows to print")
    parser.add_argument("--dry-run", action="store_true", help="print the request payload and exit")
    args = parser.parse_args(argv)

    if not args.query.strip():
        parser.error("--query (or X_QUERY) is required")
    if args.max < 1:
        parser.error("--max must be >= 1")
    if args.dry_run:
        print(json.dumps({"searchTerms": [args.query], "maxItems": args.max}, ensure_ascii=False, indent=2))
        return 0
    if not args.token:
        parser.error("--token (or APIFY_API_TOKEN) is required")

    items = fetch(args.query, args.token, args.max)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{args.name}.json"
    out_file.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    rows = rank(items, args.sort)
    print(f"query : {args.query}")
    print(f"items : {len(items)}  (≈ ${len(items) * PRICE_PER_ITEM:.4f})")
    print(f"saved : {out_file}")
    print()
    print(render(rows, args.top))
    print()
    print("读法：藏/赞 ≥0.5 干货、<0.1 情绪；粉丝少赞高=纯共鸣。详见 references/topic-mining.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
