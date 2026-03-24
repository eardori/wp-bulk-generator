#!/usr/bin/env python3
"""
Submit published WordPress post URLs to the Bing URL Submission API.

Usage:
  python3 scripts/bing-submit-urls.py \
    --api-key "$BING_WEBMASTER_API_KEY" \
    --site-url "https://allmyreview.site" \
    --web-root /var/www
"""

from __future__ import annotations

import argparse
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
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
    if path != "/" and not value.endswith("/"):
        value = value + "/"
    return value


def call_bing(api_key: str, method: str, payload: dict[str, object]) -> tuple[int, str]:
    url = f"{API_BASE}/{method}?apikey={urllib.parse.quote(api_key)}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "WPBulkBingSubmit/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status, response.read().decode("utf-8", "ignore")


def call_bing_allow_error(api_key: str, method: str, payload: dict[str, object]) -> tuple[int, str]:
    try:
        return call_bing(api_key, method, payload)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "ignore")
        return error.code, body


def is_throttle(status: int, body: str) -> bool:
    return status in {429, 500, 502, 503, 504} or "Throttle" in body


def get_published_urls(site_dir: Path) -> list[str]:
    php = (
        "$posts = get_posts(['post_type' => 'post', 'post_status' => 'publish', "
        "'posts_per_page' => -1, 'orderby' => 'ID', 'order' => 'ASC', 'fields' => 'ids']); "
        "foreach ($posts as $id) { $url = get_permalink($id); if ($url) { echo $url, PHP_EOL; } }"
    )
    result = subprocess.run(
        ["wp", "eval", php, f"--path={site_dir}", "--allow-root"],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        return []
    urls = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            urls.append(normalize_url(line))
        except ValueError:
            continue
    return urls


def is_wordpress_site(site_dir: Path) -> bool:
    result = subprocess.run(
        ["wp", "core", "is-installed", f"--path={site_dir}", "--allow-root"],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    return result.returncode == 0


def collect_urls(web_root: Path) -> list[str]:
    urls: list[str] = []
    for site_dir in sorted(web_root.iterdir()):
        if not site_dir.is_dir():
            continue
        if not is_wordpress_site(site_dir):
            continue
        urls.extend(get_published_urls(site_dir))
    return sorted(set(urls))


def collect_urls_from_dashboard_cache(cache_path: Path) -> list[str]:
    payload = json.loads(cache_path.read_text())
    sites = payload.get("sites", {})
    urls: list[str] = []
    if not isinstance(sites, dict):
        return urls
    for site_data in sites.values():
        if not isinstance(site_data, dict):
            continue
        posts = site_data.get("posts", [])
        if not isinstance(posts, list):
            continue
        for post in posts:
            if not isinstance(post, dict):
                continue
            link = post.get("link")
            if not isinstance(link, str) or not link.strip():
                continue
            try:
                urls.append(normalize_url(link))
            except ValueError:
                continue
    return sorted(set(urls))


def chunked(values: list[str], chunk_size: int) -> list[list[str]]:
    return [values[index : index + chunk_size] for index in range(0, len(values), chunk_size)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--site-url", required=True)
    parser.add_argument("--web-root", default="/var/www")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--max-urls", type=int, default=0)
    parser.add_argument("--start-after-url")
    parser.add_argument("--dashboard-cache-file")
    parser.add_argument("--sleep-seconds", type=float, default=1.5)
    parser.add_argument("--max-retries", type=int, default=5)
    parser.add_argument("--state-file", default="/tmp/bing-submit-urls-state.json")
    args = parser.parse_args()

    property_url = normalize_url(args.site_url)
    web_root = Path(args.web_root)
    state_path = Path(args.state_file)

    if args.dashboard_cache_file:
        urls = collect_urls_from_dashboard_cache(Path(args.dashboard_cache_file))
        source_label = args.dashboard_cache_file
    else:
        urls = collect_urls(web_root)
        source_label = str(web_root)
    print(f"Collected {len(urls)} URLs from {source_label}")
    if not urls:
        print("No URLs to submit")
        return 0

    start_after_url = normalize_url(args.start_after_url) if args.start_after_url else None
    if start_after_url:
        try:
            start_index = urls.index(start_after_url) + 1
        except ValueError:
            print(f"Start-after URL not found: {start_after_url}")
            return 1
        urls = urls[start_index:]

    if args.max_urls and args.max_urls > 0:
        urls = urls[: args.max_urls]

    if not urls:
        print("No URLs selected for submission")
        return 0

    failed_batches: list[dict[str, object]] = []
    state: dict[str, object] = {
        "siteUrl": property_url,
        "source": source_label,
        "totalUrls": len(urls),
        "submittedUrls": len(urls),
        "submitted": 0,
        "firstUrl": urls[0],
        "lastUrl": urls[-1],
        "startAfterUrl": start_after_url,
        "failedBatches": failed_batches,
    }

    for index, batch in enumerate(chunked(urls, max(1, args.batch_size)), 1):
        status = 0
        body = ""
        ok = False
        for attempt in range(1, args.max_retries + 1):
            status, body = call_bing_allow_error(
                args.api_key,
                "SubmitUrlBatch",
                {
                    "siteUrl": property_url,
                    "urlList": batch,
                },
            )
            if 200 <= status < 300:
                ok = True
                break
            if not is_throttle(status, body):
                break
            print(f"[{index}] RETRY {attempt} status={status} body={body[:160]}")
            time.sleep(min(120, args.sleep_seconds * attempt))

        if ok:
            state["submitted"] = int(state["submitted"]) + len(batch)
            print(f"[{index}] OK batch={len(batch)} status={status}")
        else:
            failed = {
                "batchIndex": index,
                "status": status,
                "body": body[:500],
                "urls": batch,
            }
            failed_batches.append(failed)
            print(f"[{index}] FAIL batch={len(batch)} status={status} body={body[:200]}")

        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
        time.sleep(args.sleep_seconds)

    print("SUMMARY", json.dumps(state, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
