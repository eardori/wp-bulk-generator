#!/usr/bin/env python3

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit


def build_urls(cache_path: Path) -> list[str]:
    payload = json.loads(cache_path.read_text())
    seen = set()
    urls: list[str] = []

    for site in payload.get("sites", {}).values():
        posts = site.get("posts") or []
        for post in posts:
            link = (post or {}).get("link")
            if not link:
                continue

            parsed = urlsplit(link)
            base = f"{parsed.scheme}://{parsed.netloc}/"

            for url in (base, link):
                if url in seen:
                    continue
                seen.add(url)
                urls.append(url)

    return sorted(urls, key=lambda url: (urlsplit(url).hostname or "", len(url)))


def warm_url(url: str, timeout: int) -> tuple[str, str, float]:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    command = [
        "curl",
        "-k",
        "-L",
        "-sS",
        "--max-time",
        str(timeout),
        "--resolve",
        f"{host}:443:127.0.0.1",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code} %{time_total}",
        url,
    ]

    started = time.time()
    try:
        output = subprocess.check_output(command, text=True, timeout=timeout + 15).strip()
        code, total = output.split(" ", 1)
        return code, total, time.time() - started
    except subprocess.CalledProcessError:
        return "ERR", "-", time.time() - started
    except subprocess.TimeoutExpired:
        return "TIMEOUT", "-", time.time() - started


def main() -> int:
    parser = argparse.ArgumentParser(description="Warm nginx fastcgi cache for WordPress sites.")
    parser.add_argument(
        "--cache-file",
        default="/home/ubuntu/wp-bulk-generator/bridge-api/data/dashboard-cache.json",
        help="Path to dashboard cache JSON",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="Per-request curl max-time in seconds",
    )
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.5,
        help="Sleep between requests in seconds",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional max URL count, 0 means all",
    )
    args = parser.parse_args()

    cache_path = Path(args.cache_file)
    urls = build_urls(cache_path)
    if args.limit > 0:
        urls = urls[: args.limit]

    print(f"URLS {len(urls)}", flush=True)

    ok = 0
    failed = 0
    started = time.time()

    for index, url in enumerate(urls, start=1):
        code, total, elapsed = warm_url(url, args.timeout)
        if code == "200":
            ok += 1
        else:
            failed += 1

        print(
            f"[{index}/{len(urls)}] {code} total={total} elapsed={elapsed:.1f}s {url}",
            flush=True,
        )

        if args.sleep > 0:
            time.sleep(args.sleep)

    print(
        f"SUMMARY ok={ok} failed={failed} duration={time.time() - started:.1f}s",
        flush=True,
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
