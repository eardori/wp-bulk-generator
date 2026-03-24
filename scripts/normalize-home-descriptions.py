#!/usr/bin/env python3
import re
import subprocess
from pathlib import Path


def wp(path: Path, *args: str) -> str:
    cmd = ["sudo", "wp", *args, f"--path={path}", "--allow-root"]
    return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL, timeout=20).strip()


def build_desc(title: str, tagline: str) -> str:
    title = re.sub(r"\s+", " ", title or "").strip()
    tagline = re.sub(r"\s+", " ", tagline or "").strip()
    source = f"{title} {tagline}"
    is_ko = any("\uac00" <= ch <= "\ud7a3" for ch in source)

    if is_ko:
        base = tagline or "실용적인 방문 가이드와 추천 정보를 제공하는 사이트입니다."
        desc = f"{title}. {base}" if title and title not in base else base
        desc = desc.rstrip(".! ") + ". 실용적인 방문 팁과 메뉴 정보, 최신 게시글을 한곳에서 확인하세요."
        if len(desc) < 70:
            desc += " 믿을 수 있는 핵심 정보와 정리된 가이드를 빠르게 확인할 수 있습니다."
    else:
        base = tagline or "Practical guides, recommendations, and local tips."
        desc = f"{title}. {base}" if title and title.lower() not in base.lower() else base
        desc = desc.rstrip(".! ") + ". Explore practical recommendations, detailed information, and the latest posts in one place."
        if len(desc) < 70:
            desc += " Find trustworthy highlights and clearly organized guides without extra noise."

    desc = re.sub(r"\s+", " ", desc).strip()
    if len(desc) > 155:
        desc = desc[:152].rstrip() + "..."
    return desc


def main() -> None:
    checked = 0
    updated = 0

    for path in sorted(Path("/var/www").iterdir()):
        if not path.is_dir() or path.name == "html" or not (path / "wp-config.php").exists():
            continue

        try:
            home = wp(path, "option", "get", "home")
        except Exception:
            continue

        if ".allmyreview.site" not in home:
            continue

        checked += 1
        try:
            title = wp(path, "option", "get", "blogname")
        except Exception:
            title = ""

        try:
            tagline = wp(path, "option", "get", "blogdescription")
        except Exception:
            tagline = ""

        new_desc = build_desc(title, tagline)
        if new_desc == tagline:
            continue

        subprocess.run(
            ["sudo", "wp", "option", "update", "blogdescription", new_desc, f"--path={path}", "--allow-root", "--quiet"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
        updated += 1

    print(f"CHECKED {checked}")
    print(f"UPDATED {updated}")


if __name__ == "__main__":
    main()
