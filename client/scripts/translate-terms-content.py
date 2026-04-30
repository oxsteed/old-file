#!/usr/bin/env python3
"""Translate client/src/locales/terms/en.content.json to es/fr/ht via Google Translate."""
import json
import time
from pathlib import Path

from deep_translator import GoogleTranslator
from deep_translator.exceptions import TranslationNotFound

ROOT = Path(__file__).resolve().parent.parent / "src/locales/terms"
SRC = ROOT / "en.content.json"
SKIP_KEYS = {"href", "type", "variant", "email", "mailto"}


def collect_strings(obj, acc: list) -> None:
    if isinstance(obj, str):
        acc.append(obj)
    elif isinstance(obj, list):
        for x in obj:
            collect_strings(x, acc)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k in SKIP_KEYS:
                continue
            collect_strings(v, acc)


def apply_strings(obj, it):
    if isinstance(obj, str):
        return next(it)
    if isinstance(obj, list):
        return [apply_strings(x, it) for x in obj]
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in SKIP_KEYS:
                out[k] = v
            else:
                out[k] = apply_strings(v, it)
        return out
    return obj


def translate_one(translator, text: str, retries: int = 4) -> str:
    if not text.strip():
        return text
    for attempt in range(retries):
        try:
            return translator.translate(text)
        except TranslationNotFound:
            time.sleep(0.5 * (attempt + 1))
        except Exception:
            time.sleep(0.8 * (attempt + 1))
        if len(text) > 4500 and attempt == retries - 1:
            mid = len(text) // 2
            return translate_one(translator, text[:mid]) + translate_one(
                translator, text[mid:]
            )
    print("WARN: leaving EN for:", text[:100])
    return text


def translate_flat(translator, strings: list[str]) -> list[str]:
    out: list[str] = []
    for i, s in enumerate(strings):
        if i % 25 == 0:
            print(f"    strings {i}/{len(strings)}")
        out.append(translate_one(translator, s))
        time.sleep(0.06)
    return out


def run_target(lang_code: str, suffix: str):
    data = json.loads(SRC.read_text(encoding="utf-8"))
    translator = GoogleTranslator(source="en", target=lang_code)
    sections = data["sections"]
    out_sections = {}
    for key in sorted(sections.keys(), key=lambda x: int(x)):
        print(f"  section {key} ({lang_code})...")
        sec = sections[key]
        flat: list[str] = []
        collect_strings(sec["search"], flat)
        collect_strings(sec["blocks"], flat)
        translated = translate_flat(translator, flat)
        it = iter(translated)
        new_search = apply_strings(sec["search"], it)
        new_blocks = apply_strings(sec["blocks"], it)
        try:
            next(it)
            raise RuntimeError("Mismatch string count")
        except StopIteration:
            pass
        out_sections[key] = {"search": new_search, "blocks": new_blocks}
    out_path = ROOT / f"{suffix}.content.json"
    out_path.write_text(
        json.dumps({"sections": out_sections}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("Wrote", out_path, out_path.stat().st_size)


def main():
    run_target("es", "es")
    run_target("fr", "fr")
    run_target("ht", "ht")


if __name__ == "__main__":
    main()
