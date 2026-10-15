from __future__ import annotations
import importlib.util
import os
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

from .plugin_api import API_VERSION, NexPlugin, Param, PluginError


@dataclass
class PluginSpec:
    id: str
    name: str
    version: str
    kind: str
    description: str
    params: dict[str, Param]
    path: Path

    def load(self) -> NexPlugin:
        mod_name = f"nexspiro_plugin_{self.id}"
        spec = importlib.util.spec_from_file_location(mod_name, self.path / "plugin.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)
        return mod.Plugin()

    def resolve_params(self, given: dict[str, str]) -> dict:
        unknown = set(given) - set(self.params)
        if unknown:
            raise PluginError(f"unknown params: {sorted(unknown)}")
        return {k: p.coerce(given.get(k, p.default)) for k, p in self.params.items()}


def plugin_dirs() -> list[Path]:
    dirs = []
    if env := os.environ.get("NEXSPIRO_PLUGIN_PATH"):
        dirs += [Path(p) for p in env.split(os.pathsep) if p]
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    dirs.append(base / "plugins")
    if sys.executable and getattr(sys, "frozen", False):
        dirs.append(Path(sys.executable).parent / "plugins")
    return dirs


def discover() -> dict[str, PluginSpec]:
    found: dict[str, PluginSpec] = {}
    for d in plugin_dirs():
        if not d.is_dir():
            continue
        for manifest in sorted(d.glob("*/plugin.toml")):
            data = tomllib.loads(manifest.read_text(encoding="utf-8"))
            if data.get("api_version", 1) > API_VERSION:
                continue
            params = {n: Param(name=n, **p) for n, p in data.get("params", {}).items()}
            sid = data["id"]
            found.setdefault(sid, PluginSpec(sid, data.get("name", sid), data.get("version", "0"),
                                             data["kind"], data.get("description", ""), params,
                                             manifest.parent))
    return found
