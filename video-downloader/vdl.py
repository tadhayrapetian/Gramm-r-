#!/usr/bin/env python3
"""vdl — универсальный загрузчик видео на базе yt-dlp.

Поддерживает тысячи сайтов (YouTube, VK, Rutube, TikTok, Twitch, Vimeo,
Instagram, X/Twitter, Reddit, Dailymotion и т.д.), прямые ссылки на файлы,
а также потоки HLS (.m3u8) и DASH (.mpd) без DRM.

Видео, защищённые DRM (Widevine/PlayReady/FairPlay — Netflix, Disney+,
Кинопоиск, Okko, Spotify и т.п.), программа НЕ расшифровывает: она
распознаёт такую защиту и сообщает об этом.

Запуск:
    python vdl.py URL [URL ...]          # скачать в лучшем качестве
    python vdl.py URL -q 720             # не выше 720p
    python vdl.py URL --audio            # только звук в mp3
    python vdl.py URL --cookies-from-browser chrome   # видео из вашего аккаунта
    python vdl.py --gui                  # оконный интерфейс
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

try:
    import yt_dlp
    from yt_dlp.utils import DownloadError
except ImportError:  # pragma: no cover
    sys.exit("Не установлен yt-dlp. Выполните:  pip install -U yt-dlp")


DRM_MARKERS = ("drm", "widevine", "playready", "fairplay")


class DRMProtectedError(Exception):
    """Видео защищено DRM и не может быть сохранено."""


def build_options(
    out_dir: str = "downloads",
    quality: int | None = None,
    audio_only: bool = False,
    audio_format: str = "mp3",
    playlist: bool = False,
    subtitles: bool = False,
    cookies_from_browser: str | None = None,
    cookies_file: str | None = None,
    template: str = "%(title).150B [%(id)s].%(ext)s",
    progress_hook=None,
    quiet: bool = False,
) -> dict:
    has_ffmpeg = shutil.which("ffmpeg") is not None
    height = f"[height<={quality}]" if quality else ""

    if audio_only:
        fmt = "bestaudio/best"
    elif has_ffmpeg:
        # лучшее видео + лучший звук, склеиваются ffmpeg'ом
        fmt = f"bestvideo{height}+bestaudio/best{height}/best"
    else:
        # без ffmpeg можно взять только готовый файл со звуком
        fmt = f"best{height}[acodec!=none][vcodec!=none]/best"

    opts: dict = {
        "format": fmt,
        "outtmpl": str(Path(out_dir) / template),
        "noplaylist": not playlist,
        "ignoreerrors": playlist,  # в плейлисте не падаем на одном битом видео
        "retries": 10,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 4,
        "continuedl": True,
        "windowsfilenames": True,
        "quiet": quiet,
        "no_warnings": quiet,
        "allow_unplayable_formats": False,  # никогда не тянем зашифрованные потоки
    }
    if has_ffmpeg and not audio_only:
        opts["merge_output_format"] = "mp4"

    postprocessors = []
    if audio_only and has_ffmpeg:
        postprocessors.append({
            "key": "FFmpegExtractAudio",
            "preferredcodec": audio_format,
            "preferredquality": "0",
        })
    if subtitles:
        opts.update({
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["ru", "en", "ru.*", "en.*"],
        })
        if has_ffmpeg and not audio_only:
            postprocessors.append({"key": "FFmpegEmbedSubtitle"})
    if postprocessors:
        opts["postprocessors"] = postprocessors

    if cookies_from_browser:
        opts["cookiesfrombrowser"] = (cookies_from_browser,)
    if cookies_file:
        opts["cookiefile"] = cookies_file
    if progress_hook:
        opts["progress_hooks"] = [progress_hook]
    return opts


def _looks_like_drm(message: str) -> bool:
    low = message.lower()
    return any(m in low for m in DRM_MARKERS)


def download(urls: list[str], **kwargs) -> list[str]:
    """Скачивает список ссылок. Возвращает список ошибок (пустой — всё ок)."""
    errors: list[str] = []
    opts = build_options(**kwargs)
    with yt_dlp.YoutubeDL(opts) as ydl:
        for url in urls:
            try:
                ydl.download([url])
            except DownloadError as exc:
                msg = str(exc)
                if _looks_like_drm(msg):
                    msg = (f"{url}\n  Видео защищено DRM. Такие видео можно смотреть "
                           "только в официальном приложении/плеере сервиса "
                           "(многие из них поддерживают офлайн-загрузку).")
                errors.append(msg)
    return errors


def list_formats(url: str, **kwargs) -> None:
    opts = build_options(**kwargs)
    opts["listformats"] = True
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=False)


# ---------------------------------------------------------------- CLI
def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="vdl",
        description="Скачивание видео с YouTube, VK, Rutube, TikTok и ещё ~1800 сайтов.",
    )
    p.add_argument("urls", nargs="*", help="ссылки на видео / плейлисты")
    p.add_argument("-o", "--out", default="downloads", help="папка для сохранения (по умолч. downloads)")
    p.add_argument("-q", "--quality", type=int, metavar="H",
                   help="максимальная высота кадра: 360, 480, 720, 1080, 2160…")
    p.add_argument("-a", "--audio", action="store_true", help="скачать только звук")
    p.add_argument("--audio-format", default="mp3", choices=["mp3", "m4a", "opus", "flac", "wav"])
    p.add_argument("-p", "--playlist", action="store_true", help="скачать весь плейлист/канал")
    p.add_argument("-s", "--subs", action="store_true", help="скачать и встроить субтитры")
    p.add_argument("-f", "--file", metavar="TXT", help="файл со списком ссылок (по одной в строке)")
    p.add_argument("--cookies-from-browser", metavar="BROWSER",
                   help="взять вход в аккаунт из браузера: chrome, firefox, edge, opera, brave…")
    p.add_argument("--cookies", metavar="FILE", help="cookies.txt в формате Netscape")
    p.add_argument("-F", "--formats", action="store_true", help="показать доступные форматы и выйти")
    p.add_argument("--gui", action="store_true", help="открыть оконный интерфейс")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    if args.gui:
        from gui import run_gui
        run_gui()
        return 0

    urls = list(args.urls)
    if args.file:
        lines = Path(args.file).read_text(encoding="utf-8").splitlines()
        urls += [l.strip() for l in lines if l.strip() and not l.lstrip().startswith("#")]
    if not urls:
        try:
            urls = [input("Вставьте ссылку на видео: ").strip()]
        except (EOFError, KeyboardInterrupt):
            return 1
        if not urls[0]:
            return 1

    common = dict(cookies_from_browser=args.cookies_from_browser, cookies_file=args.cookies)
    if args.formats:
        for u in urls:
            list_formats(u, **common)
        return 0

    if not shutil.which("ffmpeg"):
        print("! ffmpeg не найден: максимальное качество и конвертация звука недоступны.\n"
              "  Установите ffmpeg (https://ffmpeg.org) для лучшего результата.\n")

    Path(args.out).mkdir(parents=True, exist_ok=True)
    errors = download(
        urls, out_dir=args.out, quality=args.quality, audio_only=args.audio,
        audio_format=args.audio_format, playlist=args.playlist, subtitles=args.subs,
        **common,
    )
    if errors:
        print("\nНе удалось скачать:", file=sys.stderr)
        for e in errors:
            print(" •", e, file=sys.stderr)
        return 2
    print(f"\nГотово. Файлы в папке: {Path(args.out).resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
