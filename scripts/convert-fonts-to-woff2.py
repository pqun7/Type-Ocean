from __future__ import annotations

import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTFont


SUPPORTED_EXTS = {".ttf", ".otf"}


def convert_font_to_woff2(input_path: Path, output_path: Path, *, overwrite: bool) -> bool:
    if output_path.exists() and not overwrite:
        return False

    font = TTFont(str(input_path))
    font.flavor = "woff2"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(output_path))
    return True


def iter_font_files(root: Path) -> list[Path]:
    return [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Convert TTF/OTF fonts under public/fonts to WOFF2 for better web performance."
    )
    parser.add_argument(
        "--root",
        default=str(Path("public") / "fonts"),
        help="Root folder to search (default: public/fonts)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing .woff2 files",
    )
    parser.add_argument(
        "--delete-sources",
        action="store_true",
        help="Delete .ttf/.otf files after successful conversion (or if .woff2 already exists)",
    )
    args = parser.parse_args(argv)

    root = Path(args.root)
    if not root.exists():
        print(f"Root folder not found: {root}", file=sys.stderr)
        return 2

    font_files = iter_font_files(root)
    if not font_files:
        print(f"No .ttf/.otf files found under: {root}")
        return 0

    created = 0
    skipped = 0
    deleted = 0
    failed: list[tuple[Path, str]] = []

    def display_path(path: Path) -> str:
        try:
            return path.relative_to(Path.cwd()).as_posix()
        except Exception:  # noqa: BLE001
            return path.as_posix()

    for input_path in sorted(font_files):
        output_path = input_path.with_suffix(".woff2")
        try:
            did_create = convert_font_to_woff2(input_path, output_path, overwrite=args.overwrite)
            if did_create:
                created += 1
                print(f"+ {display_path(output_path)}")
            else:
                skipped += 1
                print(f"= {display_path(output_path)} (exists)")

            if args.delete_sources:
                if output_path.exists():
                    input_path.unlink()
                    deleted += 1
                    print(f"- {display_path(input_path)}")
        except Exception as e:  # noqa: BLE001
            failed.append((input_path, str(e)))
            print(f"! Failed: {input_path} -> {output_path}: {e}", file=sys.stderr)

    print(
        f"\nDone. created={created} skipped={skipped} deleted={deleted} failed={len(failed)}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
