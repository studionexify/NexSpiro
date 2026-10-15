"""Reusable widgets: plugin card, auto-generated parameter form."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDoubleSpinBox, QFormLayout, QFrame,
                               QHBoxLayout, QLabel, QLineEdit, QSpinBox, QVBoxLayout, QWidget)

from ..core.plugin_api import Param
from ..core.registry import PluginSpec


def label(text: str, name: str = "") -> QLabel:
    lbl = QLabel(text)
    if name:
        lbl.setObjectName(name)
    return lbl


def chip(text: str, accent: bool = False) -> QLabel:
    return label(text, "ChipAccent" if accent else "Chip")


class PluginCard(QWidget):
    """Row shown in the plugin library list."""

    def __init__(self, spec: PluginSpec, compatible: bool):
        super().__init__()
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 10, 12, 10)
        lay.setSpacing(4)
        top = QHBoxLayout()
        top.addWidget(label(spec.name))
        top.addStretch()
        top.addWidget(chip(spec.kind.upper(), accent=True))
        lay.addLayout(top)
        desc = label(spec.description or "—", "Dim")
        desc.setWordWrap(True)
        lay.addWidget(desc)
        meta = QHBoxLayout()
        meta.addWidget(chip(spec.category))
        meta.addWidget(chip(f"v{spec.version}"))
        if not compatible:
            meta.addWidget(chip("Not for this printer"))
        meta.addStretch()
        lay.addLayout(meta)
        self.setEnabled(compatible)


class ParamForm(QWidget):
    """Builds an input per Param from plugin.toml. values() returns strings for the runner."""
    changed = Signal()

    def __init__(self):
        super().__init__()
        self._form = QFormLayout(self)
        self._form.setLabelAlignment(Qt.AlignLeft)
        self._form.setHorizontalSpacing(16)
        self._form.setVerticalSpacing(10)
        self._inputs: dict[str, tuple[Param, QWidget]] = {}

    def set_params(self, params: dict[str, Param]) -> None:
        while self._form.rowCount():
            self._form.removeRow(0)
        self._inputs.clear()
        if not params:
            self._form.addRow(label("This plugin has no settings.", "Dim"))
            return
        for p in params.values():
            w = self._make(p)
            w.setToolTip(p.help)
            self._inputs[p.name] = (p, w)
            self._form.addRow(label(p.name.replace("_", " ").capitalize()), w)

    def _make(self, p: Param) -> QWidget:
        if p.choices:
            w = QComboBox()
            w.addItems([str(c) for c in p.choices])
            w.setCurrentText(str(p.default))
            w.currentTextChanged.connect(self.changed)
        elif p.type == "bool":
            w = QCheckBox()
            w.setChecked(bool(p.default))
            w.toggled.connect(self.changed)
        elif p.type in ("float", "int"):
            w = QDoubleSpinBox() if p.type == "float" else QSpinBox()
            if p.type == "float":
                w.setDecimals(3)
                w.setSingleStep(0.05)
            w.setRange(p.min if p.min is not None else -1e6, p.max if p.max is not None else 1e6)
            w.setValue(p.default or 0)
            w.valueChanged.connect(self.changed)
        else:
            w = QLineEdit(str(p.default or ""))
            w.textChanged.connect(self.changed)
        return w

    def values(self) -> dict[str, str]:
        out = {}
        for name, (p, w) in self._inputs.items():
            if isinstance(w, QComboBox):
                out[name] = w.currentText()
            elif isinstance(w, QCheckBox):
                out[name] = "true" if w.isChecked() else "false"
            elif isinstance(w, (QDoubleSpinBox, QSpinBox)):
                out[name] = str(w.value())
            else:
                out[name] = w.text()
        return out

    def reset(self) -> None:
        for p, w in self._inputs.values():
            if isinstance(w, QComboBox):
                w.setCurrentText(str(p.default))
            elif isinstance(w, QCheckBox):
                w.setChecked(bool(p.default))
            elif isinstance(w, (QDoubleSpinBox, QSpinBox)):
                w.setValue(p.default or 0)
            else:
                w.setText(str(p.default or ""))


def panel() -> QFrame:
    f = QFrame()
    f.setObjectName("Panel")
    return f
