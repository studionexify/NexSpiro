import pytest

from nexspiro.core.gcode import GCode
from nexspiro.core.plugin_api import PluginError
from nexspiro.runner.cli import main
from nexspiro.runner.sandbox import run_plugin

SAMPLE = "\r\n".join([
    "; HEADER_BLOCK_START", "; layer_height = 0.2", "; HEADER_BLOCK_END",
    "G28", "; CHANGE_LAYER", "; FEATURE: Outer wall",
    "G1 X10 Y10 E0.5 F3000 ; wall", "G1 X20 Y10 E1.0",
    "; FEATURE: Inner wall", "G1 X30 Y10 E1.5 F6000", "",
])


def test_roundtrip_identical():
    assert GCode.parse(SAMPLE).render() == SAMPLE


def test_config_and_features():
    g = GCode.parse(SAMPLE)
    assert g.config["layer_height"] == "0.2"
    assert [l.layer for l in g.moves("Outer wall")] == [1, 1]


def test_speed_scale_plugin(tmp_path):
    f = tmp_path / "a.gcode"
    f.write_bytes(SAMPLE.encode())
    run_plugin("speed_scale", str(f), {"factor": "0.5"})
    out = f.read_bytes().decode()
    assert "G1 X10 Y10 E0.5 F1500 ; wall" in out
    assert "G1 X30 Y10 E1.5 F6000" in out
    assert "\r\n" in out


def test_bad_param_leaves_file(tmp_path):
    f = tmp_path / "a.gcode"
    f.write_bytes(SAMPLE.encode())
    with pytest.raises(PluginError):
        run_plugin("speed_scale", str(f), {"factor": "99"})
    assert f.read_bytes() == SAMPLE.encode()
    assert list(tmp_path.iterdir()) == [f]


def test_cli_list(capsys):
    assert main(["list"]) == 0
    assert "speed_scale" in capsys.readouterr().out
