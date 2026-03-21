#!/usr/bin/env python3
"""
Submit sitemap_index.xml feeds to Bing Webmaster Tools with slow retries/state.

Usage examples:
  python3 scripts/bing-submit-feeds.py \
    --api-key "$BING_API_KEY" \
    --property-url "https://allmyreview.site/" \
    --feeds-file /tmp/bing-feeds.txt

  python3 scripts/bing-submit-feeds.py \
    --api-key "$BING_API_KEY" \
    --property-url "https://allmyreview.site/" \
    --posts-json /tmp/indexnow-posts.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path


API_BASE = "https://ssl.bing.com/webmaster/api.svc/json"


def normalize_url(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("empty URL")
    parsed = urllib.parse.urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        raise ValueError(f"invalid URL: {value}")
    path = parsed.path or "/"
    if path != "/" and value.endswith("/") is False:
        value = value + "/"
    return value


def build_feed_url(host: str) -> str:
    return f"https://{host}/sitemap_index.xml"


def load_feeds_from_posts_json(path: Path) -> list[str]:
    rows = json.loads(path.read_text())
    hosts = sorted({urllib.parse.urlparse(row["link"]).netloc.lower() for row in rows if row.get("link")})
    return [build_feed_url(host) for host in hosts]


def load_feeds_from_file(path: Path) -> list[str]:
    feeds = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        feeds.append(normalize_url(line))
    return feeds


def call_bing(api_key: str, method: str, payload: dict[str, str]) -> tuple[int, str]:
    url = f"{API_BASE}/{method}?apikey={urllib.parse.quote(api_key)}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status, response.read().decode("utf-8", "ignore")


def call_bing_allow_error(api_key: str, method: str, payload: dict[str, str]) -> tuple[int, str]:
    try:
        return call_bing(api_key, method, payload)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "ignore")
        return error.code, body


def is_throttle(body: str, status: int) -> bool:
    return status in {429, 500, 502, 503, 504} or "Throttle" in body


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--property-url", required=True)
    parser.add_argument("--posts-json")
    parser.add_argument("--feeds-file")
    parser.add_argument("--remove-feed")
    parser.add_argument("--state-file", default="/tmp/bing-submit-feeds-state.json")
    parser.add_argument("--sleep-seconds", type=int, default=15)
    parser.add_argument("--max-retries", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    property_url = normalize_url(args.property_url)
    state_path = Path(args.state_file)
    state: dict[str, dict[str, object]] = {}
    if state_path.exists():
        try:
            state = json.loads(state_path.read_text())
        except Exception:
            state = {}

    if args.remove_feed:
        status, body = call_bing_allow_error(
            args.api_key,
            "RemoveFeed",
            {
                "siteUrl": property_url,
                "feedUrl": normalize_url(args.remove_feed),
            },
        )
        print(f"REMOVE {args.remove_feed} -> {status} {body[:300]}")

    if bool(args.posts_json) == bool(args.feeds_file):
        print("Provide exactly one of --posts-json or --feeds-file", file=sys.stderr)
        return 1

    if args.posts_json:
        feeds = load_feeds_from_posts_json(Path(args.posts_json))
    else:
        feeds = load_feeds_from_file(Path(args.feeds_file))

    if args.limit > 0:
        feeds = feeds[: args.limit]

    counts = Counter()

    for index, feed_url in enumerate(feeds, 1):
        prior = state.get(feed_url, {})
        if prior.get("ok"):
            counts["skipped_ok"] += 1
            print(f"[{index}/{len(feeds)}] SKIP {feed_url} already OK")
            continue

        status = 0
        body = ""
        ok = False
        for attempt in range(1, args.max_retries + 1):
            status, body = call_bing_allow_error(
                args.api_key,
                "SubmitFeed",
                {
                    "siteUrl": property_url,
                    "feedUrl": feed_url,
                },
            )
            if 200 <= status < 300:
                ok = True
                break
            if not is_throttle(body, status):
                break
            print(f"[{index}/{len(feeds)}] RETRY {feed_url} try={attempt} status={status} body={body[:160]}")
            time.sleep(min(120, args.sleep_seconds * attempt))

        state[feed_url] = {
            "ok": ok,
            "status": status,
            "body": body[:500],
            "updatedAt": int(time.time()),
        }
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))

        if ok:
            counts["ok"] += 1
            print(f"[{index}/{len(feeds)}] OK {feed_url} -> {status}")
        else:
            counts["fail"] += 1
            print(f"[{index}/{len(feeds)}] FAIL {feed_url} -> {status} {body[:200]}")

        time.sleep(args.sleep_seconds)

    print(
        "SUMMARY",
        json.dumps(
            {
                "feeds": len(feeds),
                "ok": counts["ok"],
                "fail": counts["fail"],
                "skipped_ok": counts["skipped_ok"],
                "state_file": str(state_path),
            },
            ensure_ascii=False,
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
