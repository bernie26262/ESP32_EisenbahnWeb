# pyright: reportUndefinedVariable=false
from __future__ import annotations

import re
from pathlib import Path
from datetime import datetime

from SCons.Script import Import  # type: ignore
Import("env")
_env = globals()["env"]

print("[UI-BUMP] PROJECT_DIR:", _env["PROJECT_DIR"])

ASSETS = {"style.css", "script.js", "safety_ui_texts.js"}
TOKEN = datetime.now().strftime("%Y%m%d%H%M%S")

ATTR_RE = re.compile(
    r"""(?P<attr>\b(?:src|href)\s*=\s*)(?P<q>["'])(?P<val>[^"']*)(?P=q)""",
    re.IGNORECASE,
)

BROKEN_RE = re.compile(
    r"^(style\.css|script\.js|safety_ui_texts\.js)[A-Za-z0-9_-]+$"
)

def fix_url(url: str) -> str:
    url = url.strip()
    tail = url.rsplit("/", 1)[-1]

    # Repariere kaputte Fälle:
    # 1) style.cssP123...
    # 2) style.cssv=2026...   (fehlendes '?')
    m = re.match(r"^(style\.css|script\.js|safety_ui_texts\.js)(?:[A-Za-z0-9_-]+|v=\d+)$", tail)
    if m:
        asset = m.group(1)
        prefix = url[: url.rfind(asset)]
        return f"{prefix}{asset}?v={TOKEN}"

    base = url.split("?", 1)[0]
    name = base.rsplit("/", 1)[-1]
    if name not in ASSETS:
        return url

    if "?" in url:
        # v= ersetzen, aber Separator behalten
        if re.search(r"([?&])v=", url):
            return re.sub(r"([?&])v=[^&]*", rf"\1v={TOKEN}", url)
        # sonst v= anhängen
        return url + "&v=" + TOKEN

    return url + "?v=" + TOKEN


def process_html(text: str) -> str:
    def repl(m: re.Match) -> str:
        return f"{m.group('attr')}{m.group('q')}{fix_url(m.group('val'))}{m.group('q')}"
    return ATTR_RE.sub(repl, text)

def before_fs(*args, **kwargs):
    data = Path(_env["PROJECT_DIR"]) / "data"
    files = list(data.rglob("*.htm")) + list(data.rglob("*.html"))

    for f in files:
        old = f.read_text(encoding="utf-8", errors="replace")
        new = process_html(old)
        if old != new:
            f.write_text(new, encoding="utf-8")
            print(f"[UI] patched {f.name} -> v={TOKEN}")

_env.AddPreAction("buildfs", before_fs)
_env.AddPreAction("uploadfs", before_fs)
