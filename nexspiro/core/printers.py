"""Bambu Lab printer catalogue used by plugins and the UI."""
from __future__ import annotations
import tomllib
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path


@dataclass(frozen=True)
class Printer:
    id: str
    name: str
    tier: int
    volume: tuple[float, float, float]
    kinematics: str
    enclosed: bool
    max_speed: float
    max_accel: float
    nozzles: tuple[float, ...]
    ams: str
    dual_nozzle: bool = False


@cache
def printers() -> dict[str, Printer]:
    data = tomllib.loads((Path(__file__).with_name("printers.toml")).read_text(encoding="utf-8"))
    out = {}
    for pid, d in data.items():
        d = dict(d, volume=tuple(d["volume"]), nozzles=tuple(d["nozzles"]))
        out[pid] = Printer(id=pid, **d)
    return dict(sorted(out.items(), key=lambda kv: (kv[1].tier, kv[0])))


def detect(config: dict[str, str]) -> Printer | None:
    """Match printer from Bambu G-code header (printer_model / printer_settings_id)."""
    text = (config.get("printer_model", "") + " " + config.get("printer_settings_id", "")).lower()
    for p in sorted(printers().values(), key=lambda p: -len(p.name)):
        if p.name.lower() in text:
            return p
    return None
