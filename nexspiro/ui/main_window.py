"""Nexspiro main window — Plugin Space.

Layout (mirrors Bambu Studio chrome):
  Top bar   : brand · tabs (Prepare / Preview / Plugins) · printer selector
  Plugins   : [library list] | [plugin detail + settings] | [run panel: file, log]
Prepare/Preview are placeholders until the slicer host is built.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import QObject, QSettings, Qt, QThread, Signal
from PySide6.QtGui import QAction, QGuiApplication
from PySide6.QtWidgets import (QApplication, QButtonGroup, QComboBox, QFileDialog, QFrame,
                               QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
                               QMainWindow, QPlainTextEdit, QProgressBar, QPushButton,
                               QScrollArea, QSplitter, QStackedWidget, QVBoxLayout, QWidget)

from ..core.plugin_api import PluginError
from ..core.printers import Printer, printers
from ..core.registry import PluginSpec, discover
from ..runner.sandbox import run_plugin
from . import theme
from .widgets import ParamForm, PluginCard, chip, label, panel


class _RunWorker(QObject):
    finished = Signal(bool, str)

    def __init__(self, plugin_id: str, path: str, params: dict, printer_id: str):
        super().__init__()
        self.args = (plugin_id, path, params)
        self.printer_id = printer_id

    def run(self) -> None:
        try:
            run_plugin(*self.args, printer_id=self.printer_id)
            self.finished.emit(True, "Applied successfully.")
        except PluginError as e:
            self.finished.emit(False, str(e).strip().splitlines()[-1])


class PluginsPage(QWidget):
    def __init__(self, window: "MainWindow"):
        super().__init__()
        self.win = window
        self.specs: dict[str, PluginSpec] = {}
        self.current: PluginSpec | None = None
        self._thread: QThread | None = None

        split = QSplitter(Qt.Horizontal)
        split.setHandleWidth(10)
        split.addWidget(self._build_library())
        split.addWidget(self._build_detail())
        split.addWidget(self._build_run())
        split.setSizes([300, 520, 380])
        lay = QHBoxLayout(self)
        lay.setContentsMargins(12, 12, 12, 12)
        lay.addWidget(split)

    # ---- left: library -------------------------------------------------
    def _build_library(self) -> QWidget:
        p = panel()
        v = QVBoxLayout(p)
        v.setContentsMargins(12, 12, 12, 12)
        head = QHBoxLayout()
        head.addWidget(label("Plugin Library", "H2"))
        head.addStretch()
        reload_btn = QPushButton("Reload")
        reload_btn.clicked.connect(self.reload)
        head.addWidget(reload_btn)
        v.addLayout(head)
        self.search = QLineEdit(placeholderText="Search plugins…")
        self.search.textChanged.connect(self._filter)
        v.addWidget(self.search)
        self.category = QComboBox()
        self.category.currentTextChanged.connect(self._filter)
        v.addWidget(self.category)
        self.list = QListWidget()
        self.list.currentItemChanged.connect(self._select)
        v.addWidget(self.list, 1)
        self.count = label("", "Dim")
        v.addWidget(self.count)
        return p

    # ---- centre: detail + settings ------------------------------------
    def _build_detail(self) -> QWidget:
        p = panel()
        v = QVBoxLayout(p)
        v.setContentsMargins(20, 18, 20, 18)
        v.setSpacing(10)
        self.title = label("Select a plugin", "H1")
        v.addWidget(self.title)
        self.chips = QHBoxLayout()
        v.addLayout(self.chips)
        self.desc = label("", "Dim")
        self.desc.setWordWrap(True)
        v.addWidget(self.desc)
        line = QFrame(frameShape=QFrame.HLine)
        line.setStyleSheet(f"color: {theme.BORDER};")
        v.addWidget(line)
        v.addWidget(label("Settings", "H2"))
        self.form = ParamForm()
        scroll = QScrollArea(widgetResizable=True)
        scroll.setWidget(self.form)
        v.addWidget(scroll, 1)
        row = QHBoxLayout()
        self.reset_btn = QPushButton("Reset to defaults")
        self.reset_btn.clicked.connect(self.form.reset)
        self.copy_btn = QPushButton("Copy Bambu Studio command")
        self.copy_btn.setToolTip("Paste into Process › Others › Post-processing scripts")
        self.copy_btn.clicked.connect(self._copy_command)
        row.addWidget(self.reset_btn)
        row.addStretch()
        row.addWidget(self.copy_btn)
        v.addLayout(row)
        return p

    # ---- right: run panel ---------------------------------------------
    def _build_run(self) -> QWidget:
        p = panel()
        v = QVBoxLayout(p)
        v.setContentsMargins(16, 16, 16, 16)
        v.setSpacing(10)
        v.addWidget(label("Apply to file", "H2"))
        frow = QHBoxLayout()
        self.file = QLineEdit(placeholderText="G-code / STL / 3MF file")
        self.file.textChanged.connect(self._update_run_state)
        browse = QPushButton("Browse…")
        browse.clicked.connect(self._browse)
        frow.addWidget(self.file, 1)
        frow.addWidget(browse)
        v.addLayout(frow)
        self.printer_note = label("", "Dim")
        self.printer_note.setWordWrap(True)
        v.addWidget(self.printer_note)
        self.run_btn = QPushButton("Apply Plugin")
        self.run_btn.setObjectName("Primary")
        self.run_btn.clicked.connect(self._run)
        v.addWidget(self.run_btn)
        self.progress = QProgressBar(maximum=0, textVisible=False)
        self.progress.hide()
        v.addWidget(self.progress)
        v.addWidget(label("Activity", "H2"))
        self.log = QPlainTextEdit(readOnly=True)
        v.addWidget(self.log, 1)
        return p

    # ---- behaviour ------------------------------------------------------
    def reload(self) -> None:
        self.specs = discover()
        cats = sorted({s.category for s in self.specs.values()})
        self.category.blockSignals(True)
        self.category.clear()
        self.category.addItems(["All categories", *cats])
        self.category.blockSignals(False)
        self._filter()

    def _filter(self) -> None:
        q = self.search.text().lower()
        cat = self.category.currentText()
        printer = self.win.printer()
        keep = self.current.id if self.current else None
        self.list.clear()
        shown = 0
        for s in sorted(self.specs.values(), key=lambda s: (not s.supports(printer.id), s.name)):
            if q and q not in (s.name + s.description + s.id).lower():
                continue
            if cat and cat != "All categories" and s.category != cat:
                continue
            item = QListWidgetItem()
            item.setData(Qt.UserRole, s.id)
            card = PluginCard(s, s.supports(printer.id))
            item.setSizeHint(card.sizeHint())
            if not s.supports(printer.id):
                item.setFlags(item.flags() & ~Qt.ItemIsSelectable)
            self.list.addItem(item)
            self.list.setItemWidget(item, card)
            shown += 1
            if s.id == keep:
                self.list.setCurrentItem(item)
        self.count.setText(f"{shown} of {len(self.specs)} plugins")
        if not self.list.currentItem():
            self._show(None)

    def _select(self, item: QListWidgetItem | None, _prev=None) -> None:
        self._show(self.specs.get(item.data(Qt.UserRole)) if item else None)

    def _show(self, spec: PluginSpec | None) -> None:
        self.current = spec
        while self.chips.count():
            w = self.chips.takeAt(0).widget()
            if w:
                w.deleteLater()
        if not spec:
            self.title.setText("Select a plugin")
            self.desc.setText("Choose a plugin from the library to configure it.")
            self.form.set_params({})
        else:
            self.title.setText(spec.name)
            self.desc.setText(spec.description)
            for c in (chip(spec.kind.upper(), True), chip(spec.category), chip(f"v{spec.version}"),
                      chip("All printers" if not spec.printers else ", ".join(spec.printers))):
                self.chips.addWidget(c)
            self.chips.addStretch()
            self.form.set_params(spec.params)
        self.reset_btn.setEnabled(bool(spec))
        self.copy_btn.setEnabled(bool(spec))
        self._update_run_state()

    def _update_run_state(self) -> None:
        printer = self.win.printer()
        self.printer_note.setText(f"Target: {printer.name} · {printer.volume[0]:g}×{printer.volume[1]:g}"
                                  f"×{printer.volume[2]:g} mm · {printer.kinematics}")
        busy = self._thread is not None
        self.run_btn.setEnabled(bool(self.current and self.file.text().strip()) and not busy)

    def _browse(self) -> None:
        kind = self.current.kind if self.current else "gcode"
        flt = "G-code (*.gcode *.gco)" if kind == "gcode" else "Models (*.stl *.3mf *.obj)"
        start = QSettings().value("last_dir", str(Path.home()))
        path, _ = QFileDialog.getOpenFileName(self, "Choose file", start, flt)
        if path:
            QSettings().setValue("last_dir", str(Path(path).parent))
            self.file.setText(path)

    def _command(self) -> str:
        exe = sys.executable if getattr(sys, "frozen", False) else "nexspiro-plugin"
        parts = [f'"{exe}"', "run", self.current.id, "--printer", self.win.printer().id]
        for k, v in self.form.values().items():
            parts += ["-p", f'"{k}={v}"' if " " in f"{k}={v}" else f"{k}={v}"]
        return " ".join(parts)

    def _copy_command(self) -> None:
        if self.current:
            QGuiApplication.clipboard().setText(self._command())
            self._log("Command copied to clipboard.")

    def _run(self) -> None:
        if not self.current:
            return
        self._log(f"▶ {self.current.name} → {Path(self.file.text()).name} ({self.win.printer().name})")
        self.progress.show()
        self._thread = QThread(self)
        self._worker = _RunWorker(self.current.id, self.file.text().strip(), self.form.values(),
                                  self.win.printer().id)
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)
        self._worker.finished.connect(self._done)
        self._thread.start()
        self._update_run_state()

    def _done(self, ok: bool, msg: str) -> None:
        self._thread.quit()
        self._thread.wait()
        self._thread = None
        self.progress.hide()
        self._log(("✔ " if ok else "✖ ") + msg + ("" if ok else "  (file left unchanged)"))
        self._update_run_state()

    def _log(self, text: str) -> None:
        self.log.appendPlainText(text)


class PlaceholderPage(QWidget):
    def __init__(self, title: str, note: str):
        super().__init__()
        v = QVBoxLayout(self)
        v.addStretch()
        for w in (label(title, "H1"), label(note, "Dim")):
            w.setAlignment(Qt.AlignCenter)
            v.addWidget(w)
        v.addStretch()


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Nexspiro — Studio Nexify")
        self.resize(1320, 820)
        root = QWidget(objectName="Root")
        v = QVBoxLayout(root)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(0)
        v.addWidget(self._build_topbar())
        self.pages = QStackedWidget()
        self.pages.addWidget(PlaceholderPage("Prepare", "3D plate & object editing — coming with the slicer core."))
        self.pages.addWidget(PlaceholderPage("Preview", "Toolpath preview — coming with the slicer core."))
        self.plugins = PluginsPage(self)
        self.pages.addWidget(self.plugins)
        v.addWidget(self.pages, 1)
        self.setCentralWidget(root)
        self._tabs.button(2).setChecked(True)
        self.pages.setCurrentIndex(2)
        self.plugins.reload()
        reload_act = QAction(self, shortcut="Ctrl+R", triggered=self.plugins.reload)
        self.addAction(reload_act)

    def _build_topbar(self) -> QWidget:
        bar = QFrame(objectName="TopBar")
        h = QHBoxLayout(bar)
        h.setContentsMargins(16, 0, 16, 0)
        h.addWidget(label("Nex", "Brand"))
        h.addWidget(label("spiro", "BrandAccent"))
        h.addSpacing(28)
        self._tabs = QButtonGroup(self)
        for i, name in enumerate(("Prepare", "Preview", "Plugins")):
            b = QPushButton(name, objectName="Tab", checkable=True)
            self._tabs.addButton(b, i)
            h.addWidget(b)
        self._tabs.idClicked.connect(lambda i: self.pages.setCurrentIndex(i))
        h.addStretch()
        h.addWidget(label("Printer", "Dim"))
        self.printer_box = QComboBox(minimumWidth=230)
        for p in printers().values():
            self.printer_box.addItem(p.name + ("  ★" if p.tier == 1 else ""), p.id)
        saved = QSettings().value("printer", "P1S")
        self.printer_box.setCurrentIndex(max(0, self.printer_box.findData(saved)))
        self.printer_box.currentIndexChanged.connect(self._printer_changed)
        h.addWidget(self.printer_box)
        return bar

    def printer(self) -> Printer:
        return printers()[self.printer_box.currentData()]

    def _printer_changed(self) -> None:
        QSettings().setValue("printer", self.printer().id)
        self.plugins._filter()
        self.plugins._update_run_state()


def main() -> int:
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setOrganizationName("Studio Nexify")
    app.setApplicationName("Nexspiro")
    app.setStyle("Fusion")
    app.setStyleSheet(theme.QSS)
    w = MainWindow()
    w.show()
    return app.exec()
