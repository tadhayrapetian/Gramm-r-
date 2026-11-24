"""Точка входа для собранного приложения (vdl.app).

`vdl --selftest` — проверка сборки без окна: движок, ffmpeg и пробная загрузка.
"""
import sys


def selftest() -> int:
    import subprocess
    import tempfile
    from pathlib import Path

    import vdl

    print("yt-dlp:", vdl.engine_version(), "from", vdl.yt_dlp.__file__)
    ff = vdl.find_ffmpeg()
    print("ffmpeg:", ff)
    if not ff:
        return 1
    print(subprocess.run([ff, "-version"], capture_output=True, text=True).stdout.splitlines()[0])
    with tempfile.TemporaryDirectory() as d:
        errors = vdl.download(
            ["https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"],
            out_dir=d, quality=240, quiet=True,
        )
        files = list(Path(d).iterdir())
        print("downloaded:", [f.name for f in files], "errors:", errors)
        return 0 if files and not errors else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    from gui import run_gui
    run_gui()
