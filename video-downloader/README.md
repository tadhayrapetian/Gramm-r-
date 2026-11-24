# vdl — загрузчик видео

Скачивает видео с YouTube, VK, Rutube, TikTok, Twitch, Instagram, X/Twitter,
Reddit, Dailymotion и ещё ~1800 сайтов (на базе [yt-dlp](https://github.com/yt-dlp/yt-dlp)),
а также прямые ссылки на файлы и потоки HLS (`.m3u8`) / DASH (`.mpd`).

## Приложение для Mac

1. Откройте страницу релиза **vdl-latest** в репозитории (раздел *Releases*)
   и скачайте `vdl-macos-arm64.dmg` (для Mac на M1/M2/M3/M4).
2. Откройте .dmg и перетащите **vdl** в папку «Программы».
3. Первый запуск: macOS заблокирует неподписанное приложение. Зайдите в
   «Системные настройки» → «Конфиденциальность и безопасность» → «Всё равно открыть».
   Или выполните в Терминале: `xattr -dr com.apple.quarantine /Applications/vdl.app`

ffmpeg уже встроен. Файлы по умолчанию сохраняются в `~/Downloads/vdl`.
Если какой-то сайт перестал скачиваться — нажмите **«Обновить движок»** внизу окна
и перезапустите приложение.

Сборка делается автоматически на GitHub (`.github/workflows/vdl-macos.yml`)
при каждом изменении папки `video-downloader/`.

## Установка из исходников (Windows / Linux / Mac)

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

## Поиск по названию

Не знаете ссылку или видео есть на открытой площадке — найдите его прямо из программы:

```bash
python vdl.py -S "название"                        # поиск на YouTube, 10 результатов
python vdl.py -S "название" -n 20                  # больше результатов
python vdl.py -S "название" --site soundcloud -a   # музыка с SoundCloud в mp3
```
Площадки: `youtube`, `soundcloud`, `bilibili`, `nico`. Программа покажет список
(название, длительность, канал, ссылка) и спросит номера: `1`, `1,3`, `2-5` или `all`.
Остальные параметры (`-q`, `-a`, `-s`, `-o`) работают как обычно.

## Что не скачивается

Видео под DRM (Widevine / PlayReady / FairPlay): Netflix, Disney+, Amazon Prime,
Кинопоиск, Okko, Иви и т.п. Программа распознаёт защиту и сообщает об этом.
Для офлайн-просмотра используйте загрузку в официальном приложении сервиса.

Если сайт пишет «требуется вход» — добавьте `--cookies-from-browser <браузер>`,
предварительно войдя в аккаунт в этом браузере. Обновлять yt-dlp стоит регулярно:
`pip install -U yt-dlp` — сайты часто меняются.
