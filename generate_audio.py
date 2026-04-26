#!/usr/bin/env python3
"""Generate ElevenLabs TTS narration for every card in cards.json.

Usage (from this directory):
    export ELEVENLABS_API_KEY="sk_..."
    export ELEVENLABS_VOICE_ID="orF2qy9215xjwqqxqsWW"
    python3 generate_audio.py            # only generates missing/placeholder files
    python3 generate_audio.py --force    # regenerate everything

Optional env vars:
    ELEVENLABS_MODEL=eleven_multilingual_v2   # default; supports Spanish well
    PLACEHOLDER_BYTES=2000                    # files smaller than this are treated as placeholders

The script is stdlib-only (no pip install required).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "").strip()
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2").strip()
PLACEHOLDER_BYTES = int(os.environ.get("PLACEHOLDER_BYTES", "2000"))

ROOT = Path(__file__).resolve().parent
CARDS_JSON = ROOT / "cards.json"

VOICE_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.3,
    "use_speaker_boost": True,
}


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def synthesize(text: str) -> bytes:
    url = (
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
        "?output_format=mp3_44100_128"
    )
    body = json.dumps(
        {"text": text, "model_id": MODEL, "voice_settings": VOICE_SETTINGS}
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "xi-api-key": API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )

    last_err: Exception | None = None
    for attempt in range(1, 5):  # up to 4 attempts
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:500]
            last_err = RuntimeError(f"HTTP {e.code}: {err_body}")
            # 401/403 are auth — don't retry
            if e.code in (401, 403, 422):
                raise last_err
            # otherwise back off
        except Exception as e:  # noqa: BLE001
            last_err = e
        sleep_for = 2 ** attempt  # 2, 4, 8, 16
        print(f"  attempt {attempt} failed ({last_err}); retrying in {sleep_for}s")
        time.sleep(sleep_for)
    raise last_err  # type: ignore[misc]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true",
        help="Regenerate every card even if a real-looking mp3 already exists.",
    )
    parser.add_argument(
        "--only", default=None,
        help="Comma-separated card IDs to generate (e.g. '01-1,02-3').",
    )
    args = parser.parse_args()

    if not API_KEY:
        die("ELEVENLABS_API_KEY is not set in the environment.")
    if not VOICE_ID:
        die("ELEVENLABS_VOICE_ID is not set in the environment.")
    if not CARDS_JSON.exists():
        die(f"cards.json not found at {CARDS_JSON}")

    data = json.loads(CARDS_JSON.read_text(encoding="utf-8"))
    cards = data["cards"]

    only_set = None
    if args.only:
        only_set = {x.strip() for x in args.only.split(",") if x.strip()}

    targets = []
    for c in cards:
        if only_set is not None and c["id"] not in only_set:
            continue
        out_path = ROOT / c["audio_file"]
        existing = out_path.stat().st_size if out_path.exists() else 0
        if not args.force and existing >= PLACEHOLDER_BYTES:
            continue
        targets.append((c, out_path, existing))

    print(f"Cards to generate: {len(targets)} of {len(cards)}")
    if not targets:
        print("Nothing to do. Use --force to regenerate everything.")
        return

    total_chars = sum(len(c["description"]) for c, _, _ in targets)
    print(f"Approx characters to synthesize: {total_chars:,}")
    print(f"Voice: {VOICE_ID}    Model: {MODEL}")
    print()

    failed = []
    for i, (card, out_path, existing) in enumerate(targets, 1):
        prefix = f"[{i:>2}/{len(targets)}] {card['id']} {card['title']:<28}"
        text_len = len(card["description"])
        try:
            print(f"{prefix} -> {out_path.name}  ({text_len} chars) ...", end=" ", flush=True)
            audio = synthesize(card["description"])
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(audio)
            print(f"OK ({len(audio):,} B)")
        except Exception as e:  # noqa: BLE001
            print(f"FAILED: {e}")
            failed.append(card["id"])
        # gentle pacing to stay under per-minute rate limits
        time.sleep(0.4)

    print()
    print(f"Done. Success: {len(targets) - len(failed)}, Failed: {len(failed)}")
    if failed:
        print("Failed IDs:", ",".join(failed))
        print("Re-run with --only to retry just those:")
        print(f"  python3 generate_audio.py --only {','.join(failed)}")
        sys.exit(2)


if __name__ == "__main__":
    main()
