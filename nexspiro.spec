# pyinstaller nexspiro.spec  ->  dist/Nexspiro(.exe) [GUI] + dist/nexspiro-plugin(.exe) [CLI for Bambu Studio]
datas = [("plugins", "plugins"), ("nexspiro/core/printers.toml", "nexspiro/core")]

cli = Analysis(["nexspiro_plugin.py"], pathex=["."], datas=datas, hiddenimports=["nexspiro.core.mesh"],
               excludes=["PySide6"])
cli_exe = EXE(PYZ(cli.pure), cli.scripts, cli.binaries, cli.datas, name="nexspiro-plugin", console=True)

gui = Analysis(["nexspiro_app.py"], pathex=["."], datas=datas, hiddenimports=["nexspiro.core.mesh"])
gui_exe = EXE(PYZ(gui.pure), gui.scripts, gui.binaries, gui.datas, name="Nexspiro", console=False)
