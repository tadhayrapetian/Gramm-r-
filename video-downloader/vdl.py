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
    python vdl.py -S "название фильма"   # найти на YouTube и выбрать
    python vdl.py --gui                  # оконный интерфейс
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import urllib.request
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))  # запущено как собранное приложение (.app)


def data_dir() -> Path:
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home()))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "vdl"


# В собранном приложении pip недоступен, поэтому свежий yt-dlp скачивается
# отдельным файлом (кнопка «Обновить движок») и подключается раньше встроенного.
ENGINE_FILE = data_dir() / "yt-dlp.zip"
ENGINE_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
if FROZEN and ENGINE_FILE.is_file():
    sys.path.insert(0, str(ENGINE_FILE))

try:
    import yt_dlp
    from yt_dlp.utils import DownloadError
except ImportError:  # pragma: no cover
    sys.exit("Не установлен yt-dlp. Выполните:  pip install -U yt-dlp")


DRM_MARKERS = ("drm", "widevine", "playready", "fairplay")


def engine_version() -> str:
    return yt_dlp.version.__version__


def update_engine() -> str:
    """Скачивает последнюю версию yt-dlp. Подхватывается после перезапуска."""
    ENGINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = ENGINE_FILE.with_suffix(".part")
    with urllib.request.urlopen(ENGINE_URL, timeout=60) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    tmp.replace(ENGINE_FILE)
    return str(ENGINE_FILE)


def find_ffmpeg() -> str | None:
    """Ищет ffmpeg: внутри приложения, в PATH, в Homebrew."""
    candidates = []
    if FROZEN:
        candidates.append(Path(getattr(sys, "_MEIPASS", "")) / "ffmpeg")
        candidates.append(Path(sys.executable).parent / "ffmpeg")
    found = shutil.which("ffmpeg")
    if found:
        candidates.append(Path(found))
    candidates += [Path("/opt/homebrew/bin/ffmpeg"), Path("/usr/local/bin/ffmpeg")]
    for c in candidates:
        if c.is_file() and os.access(c, os.X_OK):
            return str(c)
    return None


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
    logger=None,
) -> dict:
    ffmpeg = find_ffmpeg()
    has_ffmpeg = ffmpeg is not None
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
        "noprogress": quiet,
        "allow_unplayable_formats": False,  # никогда не тянем зашифрованные потоки
    }
    if has_ffmpeg:
        opts["ffmpeg_location"] = ffmpeg
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
    if logger is not None:
        # в приложении без терминала stdout/stderr может не быть — пишем через logger
        opts["logger"] = logger
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


SEARCH_SITES = {
    "youtube": ("ytsearch", "YouTube"),
    "soundcloud": ("scsearch", "SoundCloud"),
    "bilibili": ("bilisearch", "Bilibili"),
    "nico": ("nicosearch", "Niconico"),
}


def _fmt_duration(sec) -> str:
    if not sec:
        return "--:--"
    sec = int(sec)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02}:{s:02}" if h else f"{m}:{s:02}"


def search(query: str, site: str = "youtube", limit: int = 10, logger=None) -> list[dict]:
    """Ищет видео на открытой площадке. Возвращает [{title, url, duration, channel}]."""
    key, _ = SEARCH_SITES[site]
    opts = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True}
    if logger is not None:
        opts["logger"] = logger
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"{key}{limit}:{query}", download=False)
    results = []
    for e in info.get("entries") or []:
        if not e:
            continue
        url = e.get("webpage_url") or e.get("url")
        if site == "youtube" and e.get("id"):
            url = f"https://www.youtube.com/watch?v={e['id']}"
        results.append({
            "title": e.get("title") or "(без названия)",
            "url": url,
            "duration": e.get("duration"),
            "channel": e.get("channel") or e.get("uploader") or "",
        })
    return results


def parse_selection(text: str, count: int) -> list[int]:
    """'1,3,5-7' / 'all' / 'все' -> индексы с нуля."""
    text = text.strip().lower()
    if text in ("all", "все", "*"):
        return list(range(count))
    picked: list[int] = []
    for part in text.replace(" ", ",").split(","):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            rng = range(int(a), int(b) + 1)
        else:
            rng = [int(part)]
        for n in rng:
            if 1 <= n <= count and n - 1 not in picked:
                picked.append(n - 1)
    return picked


def interactive_search(query: str, site: str, limit: int) -> list[str]:
    name = SEARCH_SITES[site][1]
    print(f"Ищу «{query}» на {name}…\n")
    try:
        results = search(query, site, limit)
    except DownloadError as exc:
        print(f"Поиск не удался: {exc}", file=sys.stderr)
        return []
    if not results:
        print("Ничего не найдено.")
        return []
    for i, r in enumerate(results, 1):
        ch = f" — {r['channel']}" if r["channel"] else ""
        print(f"{i:>2}. [{_fmt_duration(r['duration']):>7}] {r['title']}{ch}")
        print(f"    {r['url']}")
    try:
        answer = input("\nНомера для загрузки (например 1,3 или 2-4, all — все, Enter — отмена): ")
    except (EOFError, KeyboardInterrupt):
        return []
    try:
        idx = parse_selection(answer, len(results))
    except ValueError:
        print("Не понял номера.")
        return []
    return [results[i]["url"] for i in idx]


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
    p.add_argument("-S", "--search", metavar="ЗАПРОС",
                   help="найти видео по названию на открытой площадке и выбрать, что скачать")
    p.add_argument("--site", default="youtube", choices=list(SEARCH_SITES),
                   help="где искать (по умолч. youtube)")
    p.add_argument("-n", "--results", type=int, default=10, help="сколько результатов показать")
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
    if args.search:
        urls += interactive_search(args.search, args.site, args.results)
        if not urls:
            return 0
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

    if not find_ffmpeg():
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
