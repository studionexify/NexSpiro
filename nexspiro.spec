# pyinstaller nexspiro.spec  ->  dist/nexspiro-plugin(.exe)
a = Analysis(["nexspiro_plugin.py"], pathex=["."], datas=[("plugins", "plugins")],
             hiddenimports=["nexspiro.core.mesh"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, name="nexspiro-plugin", console=True)
