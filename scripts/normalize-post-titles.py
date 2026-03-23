#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def normalize_place_name(slug: str, current_title: str) -> str:
    title = (current_title or "").strip()
    slug_l = (slug or "").lower()

    if "설야갈비" in title and "청담" in title:
        return "설야갈비 청담"

    if "설야갈비" in title:
        return "설야갈비 청담"

    if "청담" in title and "갈비" in title:
        return "설야갈비 청담"

    if "seolya" in slug_l and "galbi" in slug_l:
        return "설야갈비 청담"

    if "seolyagalbi" in slug_l:
        return "설야갈비 청담"

    if ":" in title:
        return title.split(":", 1)[0].strip()

    return "설야갈비 청담"


def infer_angle(slug: str, current_title: str) -> str:
    slug_l = (slug or "").lower()
    title = (current_title or "").strip()

    if "menu" in slug_l or "메뉴" in title or "가격" in title:
        return "메뉴와 가격 정리"
    if "family" in slug_l or "가족" in title or "모임" in title:
        return "가족 모임 가이드"
    if "first-visit" in slug_l or "visit-guide" in slug_l or "첫 방문" in title or "처음 방문" in title:
        return "첫 방문 가이드"
    if "date" in slug_l or "course" in slug_l or "데이트" in title or "분위기" in title:
        return "분위기와 방문 포인트 정리"
    if "compare" in slug_l or "difference" in slug_l or "different" in slug_l or "비교" in title or "차이" in title:
        return "차별점 정리"
    if "review" in slug_l or "후기" in title or "리뷰" in title or "방문" in title:
        return "방문 정보와 메뉴 정리"
    return "방문 가이드"


def build_title(slug: str, current_title: str) -> str:
    return f"{normalize_place_name(slug, current_title)}: {infer_angle(slug, current_title)}".strip()


def run_wp(site_path: Path, *args: str) -> str:
    cmd = ["sudo", "wp", *args, "--allow-root"]
    return subprocess.check_output(cmd, cwd=site_path, text=True, stderr=subprocess.DEVNULL).strip()


def update_site(site_path: Path) -> tuple[int, int]:
    updated = 0
    skipped = 0
    raw = run_wp(
        site_path,
        "post",
        "list",
        "--post_type=post",
        "--post_status=publish",
        "--fields=ID,post_title,post_name",
        "--format=json",
    )
    posts = json.loads(raw or "[]")

    for post in posts:
        post_id = str(post["ID"])
        current_title = (post.get("post_title") or "").strip()
        slug = (post.get("post_name") or "").strip()
        new_title = build_title(slug, current_title)

        if current_title == new_title:
            skipped += 1
            continue

        run_wp(site_path, "post", "update", post_id, f"--post_title={new_title}", "--quiet")
        run_wp(site_path, "post", "meta", "update", post_id, "_yoast_wpseo_title", new_title[:60])
        updated += 1

    return updated, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize WordPress post titles into a structured informational format.")
    parser.add_argument("--root", default="/var/www", help="WordPress site root directory")
    args = parser.parse_args()

    total_updated = 0
    total_skipped = 0

    for name in sorted(os.listdir(args.root)):
        site_path = Path(args.root) / name
        if not site_path.is_dir():
            continue
        if not (site_path / "wp-config.php").exists():
            continue

        try:
            updated, skipped = update_site(site_path)
            print(f"{name}: updated={updated} skipped={skipped}", flush=True)
            total_updated += updated
            total_skipped += skipped
        except subprocess.CalledProcessError:
            print(f"{name}: error", flush=True)

    print(f"RESULT updated={total_updated} skipped={total_skipped}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
