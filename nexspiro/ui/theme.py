"""Nexspiro look: dark slicer chrome with Bambu-style green accent."""

ACCENT = "#00AE42"
ACCENT_HOVER = "#00C94C"
BG = "#1E1F22"
PANEL = "#26282C"
PANEL_ALT = "#2E3035"
BORDER = "#3A3D43"
TEXT = "#E6E7E9"
TEXT_DIM = "#9A9DA3"
DANGER = "#E5484D"

QSS = f"""
* {{ font-family: "Segoe UI", "SF Pro Text", sans-serif; font-size: 13px; color: {TEXT}; }}
QMainWindow, QWidget#Root {{ background: {BG}; }}
QFrame#Panel {{ background: {PANEL}; border: 1px solid {BORDER}; border-radius: 8px; }}
QFrame#TopBar {{ background: {PANEL}; border-bottom: 1px solid {BORDER}; }}
QLabel#Brand {{ font-size: 16px; font-weight: 600; }}
QLabel#BrandAccent {{ font-size: 16px; font-weight: 600; color: {ACCENT}; }}
QLabel#H1 {{ font-size: 18px; font-weight: 600; }}
QLabel#H2 {{ font-size: 12px; font-weight: 600; color: {TEXT_DIM}; text-transform: uppercase; }}
QLabel#Dim {{ color: {TEXT_DIM}; }}
QLabel#Chip {{ background: {PANEL_ALT}; border: 1px solid {BORDER}; border-radius: 10px; padding: 2px 8px; color: {TEXT_DIM}; font-size: 11px; }}
QLabel#ChipAccent {{ background: transparent; border: 1px solid {ACCENT}; border-radius: 10px; padding: 2px 8px; color: {ACCENT}; font-size: 11px; }}
QLineEdit, QComboBox, QDoubleSpinBox, QSpinBox {{
    background: {PANEL_ALT}; border: 1px solid {BORDER}; border-radius: 6px; padding: 5px 8px; min-height: 20px; }}
QLineEdit:focus, QComboBox:focus, QDoubleSpinBox:focus, QSpinBox:focus {{ border-color: {ACCENT}; }}
QComboBox QAbstractItemView {{ background: {PANEL_ALT}; border: 1px solid {BORDER}; selection-background-color: {ACCENT}; }}
QPushButton {{ background: {PANEL_ALT}; border: 1px solid {BORDER}; border-radius: 6px; padding: 7px 14px; }}
QPushButton:hover {{ border-color: {ACCENT}; }}
QPushButton:disabled {{ color: {TEXT_DIM}; }}
QPushButton#Primary {{ background: {ACCENT}; border: none; color: white; font-weight: 600; }}
QPushButton#Primary:hover {{ background: {ACCENT_HOVER}; }}
QPushButton#Primary:disabled {{ background: {BORDER}; color: {TEXT_DIM}; }}
QPushButton#Tab {{ background: transparent; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 10px 14px; color: {TEXT_DIM}; }}
QPushButton#Tab:checked {{ color: {TEXT}; border-bottom-color: {ACCENT}; }}
QListWidget {{ background: transparent; border: none; outline: 0; }}
QListWidget::item {{ border-radius: 6px; padding: 0; margin: 2px 0; }}
QListWidget::item:selected {{ background: {PANEL_ALT}; border: 1px solid {ACCENT}; }}
QListWidget::item:hover:!selected {{ background: {PANEL_ALT}; }}
QCheckBox::indicator {{ width: 16px; height: 16px; border-radius: 4px; border: 1px solid {BORDER}; background: {PANEL_ALT}; }}
QCheckBox::indicator:checked {{ background: {ACCENT}; border-color: {ACCENT}; }}
QPlainTextEdit {{ background: {BG}; border: 1px solid {BORDER}; border-radius: 6px; font-family: Consolas, Menlo, monospace; font-size: 12px; }}
QScrollArea {{ border: none; background: transparent; }}
QScrollBar:vertical {{ background: transparent; width: 8px; }}
QScrollBar::handle:vertical {{ background: {BORDER}; border-radius: 4px; min-height: 24px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
QProgressBar {{ background: {PANEL_ALT}; border: none; border-radius: 3px; height: 6px; }}
QProgressBar::chunk {{ background: {ACCENT}; border-radius: 3px; }}
QToolTip {{ background: {PANEL_ALT}; border: 1px solid {BORDER}; color: {TEXT}; }}
"""
