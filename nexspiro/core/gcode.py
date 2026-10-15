"""Streaming-friendly G-code model. Lines are kept verbatim unless modified,
so untouched lines round-trip byte-identical."""
from __future__ import annotations
import re
from dataclasses import dataclass, field

_WORD = re.compile(r"([A-Za-z])([-+]?\d*\.?\d+)")


@dataclass
class GLine:
    raw: str
    layer: int = 0
    feature: str | None = None
    _dirty: bool = field(default=False, repr=False)
    _cmd: str | None = field(default=None, repr=False)
    _params: dict[str, float] | None = field(default=None, repr=False)
    _comment: str = field(default="", repr=False)

    def _parse(self) -> None:
        if self._params is not None:
            return
        code, _, comment = self.raw.partition(";")
        self._comment = (";" + comment) if _ else ""
        tokens = code.split()
        self._cmd = tokens[0].upper() if tokens else None
        self._params = {}
        for t in tokens[1:]:
            m = _WORD.fullmatch(t)
            if m:
                self._params[m.group(1).upper()] = float(m.group(2))

    @property
    def cmd(self) -> str | None:
        self._parse()
        return self._cmd

    @property
    def params(self) -> dict[str, float]:
        self._parse()
        return self._params  # type: ignore[return-value]

    @property
    def is_move(self) -> bool:
        return self.cmd in ("G0", "G1", "G2", "G3")

    def set(self, **values: float) -> None:
        self._parse()
        self._params.update({k.upper(): v for k, v in values.items()})  # type: ignore[union-attr]
        self._dirty = True

    def render(self) -> str:
        if not self._dirty:
            return self.raw
        parts = [self._cmd or ""]
        for k, v in self._params.items():  # type: ignore[union-attr]
            parts.append(f"{k}{_fmt(v)}")
        text = " ".join(parts)
        return f"{text} {self._comment}" if self._comment else text


def _fmt(v: float) -> str:
    s = f"{v:.5f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


class GCode:
    def __init__(self, lines: list[GLine], newline: str = "\n"):
        self.lines = lines
        self.newline = newline
        self.config = _parse_config(lines)

    @classmethod
    def parse(cls, text: str) -> "GCode":
        newline = "\r\n" if "\r\n" in text else "\n"
        layer, feature, out = 0, None, []
        raw_lines = text.split(newline)
        for raw in raw_lines:
            s = raw.strip()
            if s.startswith("; CHANGE_LAYER") or s.startswith(";LAYER_CHANGE"):
                layer += 1
            elif s.startswith("; FEATURE:") or s.startswith(";TYPE:"):
                feature = s.split(":", 1)[1].strip()
            out.append(GLine(raw, layer, feature))
        return cls(out, newline)

    def render(self) -> str:
        return self.newline.join(l.render() for l in self.lines)

    def moves(self, feature: str | None = None):
        for l in self.lines:
            if l.is_move and (feature is None or l.feature == feature):
                yield l


def _parse_config(lines: list[GLine]) -> dict[str, str]:
    cfg: dict[str, str] = {}
    for l in lines:
        s = l.raw.strip()
        if s.startswith("; ") and " = " in s:
            k, _, v = s[2:].partition(" = ")
            cfg[k.strip()] = v.strip()
    return cfg
