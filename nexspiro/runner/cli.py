"""nexspiro-plugin CLI.

Bambu Studio / OrcaSlicer: Process > Others > Post-processing scripts:
    "C:\\Nexspiro\\nexspiro-plugin.exe" run <plugin_id> --param key=value
The slicer appends the G-code path as the final argument.
"""
from __future__ import annotations
import argparse
import logging
import multiprocessing
import os
import sys
from pathlib import Path

from ..core.plugin_api import PluginError
from ..core.registry import discover
from .sandbox import run_plugin


def _log_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home()))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Logs"
    else:
        base = Path.home() / ".local" / "state"
    d = base / "Nexspiro" / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="nexspiro-plugin")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    i = sub.add_parser("info"); i.add_argument("plugin")
    r = sub.add_parser("run")
    r.add_argument("plugin")
    r.add_argument("--param", "-p", action="append", default=[], metavar="KEY=VALUE")
    r.add_argument("--timeout", type=float, default=120.0)
    r.add_argument("file")
    a = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        handlers=[logging.StreamHandler(),
                                  logging.FileHandler(_log_dir() / "plugins.log", encoding="utf-8")])
    plugins = discover()
    if a.cmd == "list":
        for p in plugins.values():
            print(f"{p.id:24} {p.kind:6} v{p.version}  {p.name}")
        return 0
    if a.cmd == "info":
        p = plugins.get(a.plugin)
        if not p:
            print(f"unknown plugin {a.plugin}", file=sys.stderr); return 2
        print(f"{p.name} ({p.id}) v{p.version} [{p.kind}]\n{p.description}")
        for prm in p.params.values():
            print(f"  {prm.name}: {prm.type} = {prm.default}  {prm.help}")
        return 0
    try:
        params = dict(kv.split("=", 1) for kv in a.param)
        run_plugin(a.plugin, a.file, params, a.timeout)
        logging.info("applied %s to %s", a.plugin, a.file)
        return 0
    except (PluginError, ValueError) as e:
        logging.error("%s failed: %s", a.plugin, e)
        return 1


if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(main())
