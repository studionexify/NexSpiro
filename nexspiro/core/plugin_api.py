from __future__ import annotations
import logging
from dataclasses import dataclass, field
from typing import Any

API_VERSION = 1
TYPES = {"float": float, "int": int, "bool": lambda v: str(v).lower() in ("1", "true", "yes"), "str": str}


class PluginError(Exception):
    pass


@dataclass
class Param:
    name: str
    type: str = "float"
    default: Any = None
    min: float | None = None
    max: float | None = None
    choices: list | None = None
    help: str = ""

    def coerce(self, value: Any) -> Any:
        if self.type not in TYPES:
            raise PluginError(f"param '{self.name}': unknown type {self.type}")
        v = TYPES[self.type](value)
        if self.min is not None and v < self.min:
            raise PluginError(f"param '{self.name}'={v} below min {self.min}")
        if self.max is not None and v > self.max:
            raise PluginError(f"param '{self.name}'={v} above max {self.max}")
        if self.choices and v not in self.choices:
            raise PluginError(f"param '{self.name}'={v} not in {self.choices}")
        return v


@dataclass
class PluginContext:
    path: str
    log: logging.Logger
    gcode: Any = None   # GCode for kind=gcode
    mesh: Any = None    # trimesh.Trimesh for kind=mesh
    config: dict = field(default_factory=dict)
    printer: Any = None  # core.printers.Printer, if known


class NexPlugin:
    """Subclass and implement run(). Mutate ctx.gcode / ctx.mesh in place."""

    def run(self, ctx: PluginContext, params: dict) -> None:
        raise NotImplementedError
