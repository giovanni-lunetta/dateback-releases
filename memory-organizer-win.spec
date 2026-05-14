# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['python/cli.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        # PIL C backend — occasionally missed by static analysis
        'PIL._imaging',
        # certifi provides the CA bundle for requests SSL on frozen builds
        'certifi',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='memory-organizer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX triggers AV false positives on Windows
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    codesign_identity=None,
    entitlements_file=None,
)
