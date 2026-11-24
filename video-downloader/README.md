# vdl — загрузчик видео

Скачивает видео с YouTube, VK, Rutube, TikTok, Twitch, Instagram, X/Twitter,
Reddit, Dailymotion и ещё ~1800 сайтов (на базе [yt-dlp](https://github.com/yt-dlp/yt-dlp)),
а также прямые ссылки на файлы и потоки HLS (`.m3u8`) / DASH (`.mpd`).

## Установка

```bash
pip install -r requirements.txt
```
Для максимального качества и конвертации в mp3 установите **ffmpeg**
(Windows: `winget install ffmpeg`, macOS: `brew install ffmpeg`, Linux: `apt install ffmpeg`).

## Использование

```bash
python vdl.py https://youtu.be/...                 # лучшее качество, mp4
python vdl.py URL -q 720                           # не выше 720p
python vdl.py URL -a                               # только звук (mp3)
python vdl.py URL -a --audio-format flac
python vdl.py URL -p                               # весь плейлист / канал
python vdl.py URL -s                               # + субтитры (ru/en)
python vdl.py -f links.txt -o D:\Video             # список ссылок из файла
python vdl.py URL -F                               # показать все форматы
python vdl.py URL --cookies-from-browser chrome    # видео, доступные вашему аккаунту
python vdl.py --gui                                # окно с кнопкой «Скачать»
```

## Что не скачивается

Видео под DRM (Widevine / PlayReady / FairPlay): Netflix, Disney+, Amazon Prime,
Кинопоиск, Okko, Иви и т.п. Программа распознаёт защиту и сообщает об этом.
Для офлайн-просмотра используйте загрузку в официальном приложении сервиса.

Если сайт пишет «требуется вход» — добавьте `--cookies-from-browser <браузер>`,
предварительно войдя в аккаунт в этом браузере. Обновлять yt-dlp стоит регулярно:
`pip install -U yt-dlp` — сайты часто меняются.
