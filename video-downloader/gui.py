"""Окно приложения vdl: поиск, список ссылок, настройки, прогресс."""
from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import vdl

DEFAULT_DIR = str(Path.home() / "Downloads" / "vdl")
BROWSERS = ["нет", "safari", "chrome", "firefox", "edge", "brave", "opera", "vivaldi"]
QUALITIES = ["лучшее", "2160", "1440", "1080", "720", "480", "360"]


class QueueLogger:
    """Логгер для yt-dlp: всё пишет в окно, а не в терминал."""

    def __init__(self, events: queue.Queue):
        self.events = events

    def debug(self, msg):
        if not msg.startswith("[debug]") and not msg.startswith("[download]"):
            self.events.put(("log", msg))

    def info(self, msg):
        self.debug(msg)

    def warning(self, msg):
        self.events.put(("log", f"⚠ {msg}"))

    def error(self, msg):
        self.events.put(("log", f"✖ {msg}"))


def open_folder(path: str) -> None:
    Path(path).mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        subprocess.Popen(["open", path])
    elif os.name == "nt":
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", path])


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.events: queue.Queue = queue.Queue()
        self.logger = QueueLogger(self.events)
        self.results: list[dict] = []
        self.busy = False

        root.title("vdl — загрузчик видео")
        root.geometry("780x780")
        root.minsize(620, 560)

        main = ttk.Frame(root, padding=14)
        main.pack(fill="both", expand=True)
        main.columnconfigure(0, weight=1)

        # --- поиск
        sf = ttk.LabelFrame(main, text="Поиск по названию", padding=8)
        sf.grid(row=0, column=0, sticky="nsew")
        sf.columnconfigure(0, weight=1)
        self.query = tk.StringVar()
        q_entry = ttk.Entry(sf, textvariable=self.query)
        q_entry.grid(row=0, column=0, sticky="ew")
        q_entry.bind("<Return>", lambda e: self.do_search())
        self.site = tk.StringVar(value="youtube")
        ttk.Combobox(sf, textvariable=self.site, values=list(vdl.SEARCH_SITES),
                     width=11, state="readonly").grid(row=0, column=1, padx=6)
        self.search_btn = ttk.Button(sf, text="Найти", command=self.do_search)
        self.search_btn.grid(row=0, column=2)

        cols = ("dur", "title", "channel")
        self.tree = ttk.Treeview(sf, columns=cols, show="headings", height=7, selectmode="extended")
        for c, text, w, stretch in (("dur", "Время", 70, False), ("title", "Название", 380, True),
                                    ("channel", "Канал", 160, False)):
            self.tree.heading(c, text=text)
            self.tree.column(c, width=w, stretch=stretch, anchor="w")
        self.tree.grid(row=1, column=0, columnspan=3, sticky="nsew", pady=(8, 4))
        self.tree.bind("<Double-1>", lambda e: self.add_selected())
        sf.rowconfigure(1, weight=1)
        ttk.Button(sf, text="Добавить выбранные в загрузку ↓",
                   command=self.add_selected).grid(row=2, column=0, columnspan=3, sticky="w")

        # --- ссылки
        lf = ttk.LabelFrame(main, text="Ссылки для загрузки (по одной в строке)", padding=8)
        lf.grid(row=1, column=0, sticky="nsew", pady=10)
        lf.columnconfigure(0, weight=1)
        self.urls = tk.Text(lf, height=4, wrap="none")
        self.urls.grid(row=0, column=0, sticky="nsew")
        ttk.Button(lf, text="Очистить", command=lambda: self.urls.delete("1.0", "end")
                   ).grid(row=1, column=0, sticky="e", pady=(4, 0))

        # --- настройки
        of = ttk.LabelFrame(main, text="Настройки", padding=8)
        of.grid(row=2, column=0, sticky="ew")
        of.columnconfigure(1, weight=1)
        ttk.Label(of, text="Папка:").grid(row=0, column=0, sticky="w")
        self.out = tk.StringVar(value=DEFAULT_DIR)
        ttk.Entry(of, textvariable=self.out).grid(row=0, column=1, sticky="ew", padx=6)
        ttk.Button(of, text="Выбрать…", command=self.pick_dir).grid(row=0, column=2)
        ttk.Button(of, text="Открыть", command=lambda: open_folder(self.out.get())
                   ).grid(row=0, column=3, padx=(6, 0))

        row = ttk.Frame(of)
        row.grid(row=1, column=0, columnspan=4, sticky="w", pady=(8, 0))
        ttk.Label(row, text="Качество:").pack(side="left")
        self.quality = tk.StringVar(value="лучшее")
        ttk.Combobox(row, textvariable=self.quality, values=QUALITIES, width=8,
                     state="readonly").pack(side="left", padx=(4, 12))
        self.audio, self.playlist, self.subs = tk.BooleanVar(), tk.BooleanVar(), tk.BooleanVar()
        ttk.Checkbutton(row, text="только звук (mp3)", variable=self.audio).pack(side="left", padx=4)
        ttk.Checkbutton(row, text="весь плейлист", variable=self.playlist).pack(side="left", padx=4)
        ttk.Checkbutton(row, text="субтитры", variable=self.subs).pack(side="left", padx=4)

        row2 = ttk.Frame(of)
        row2.grid(row=2, column=0, columnspan=4, sticky="w", pady=(8, 0))
        ttk.Label(row2, text="Мой аккаунт из браузера:").pack(side="left")
        self.browser = tk.StringVar(value="нет")
        ttk.Combobox(row2, textvariable=self.browser, values=BROWSERS, width=9,
                     state="readonly").pack(side="left", padx=4)
        ttk.Label(row2, text="(для видео, доступных после входа)", foreground="gray"
                  ).pack(side="left", padx=4)

        # --- загрузка
        df = ttk.Frame(main)
        df.grid(row=3, column=0, sticky="ew", pady=(12, 0))
        df.columnconfigure(0, weight=1)
        self.progress = ttk.Progressbar(df, maximum=100)
        self.progress.grid(row=0, column=0, sticky="ew")
        self.dl_btn = ttk.Button(df, text="Скачать", command=self.do_download)
        self.dl_btn.grid(row=0, column=1, padx=(8, 0))
        self.status = tk.StringVar(value="Готов к работе")
        ttk.Label(df, textvariable=self.status).grid(row=1, column=0, columnspan=2, sticky="w", pady=4)

        self.log = tk.Text(main, height=6, state="disabled", wrap="word",
                           font=("Menlo", 11) if sys.platform == "darwin" else ("Courier", 9))
        self.log.grid(row=4, column=0, sticky="nsew")
        main.rowconfigure(0, weight=3)
        main.rowconfigure(4, weight=1)

        foot = ttk.Frame(main)
        foot.grid(row=5, column=0, sticky="ew", pady=(8, 0))
        self.engine_lbl = ttk.Label(foot, text=f"Движок yt-dlp {vdl.engine_version()}",
                                    foreground="gray")
        self.engine_lbl.pack(side="left")
        self.upd_btn = ttk.Button(foot, text="Обновить движок", command=self.do_update)
        self.upd_btn.pack(side="right")
        if not vdl.find_ffmpeg():
            self.write_log("⚠ ffmpeg не найден: лучшее качество и mp3 недоступны.")

        self.poll()

    # ------------------------------------------------------------ helpers
    def write_log(self, msg: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def pick_dir(self):
        d = filedialog.askdirectory(initialdir=self.out.get())
        if d:
            self.out.set(d)

    def set_busy(self, busy: bool):
        self.busy = busy
        state = ["disabled"] if busy else ["!disabled"]
        for b in (self.dl_btn, self.search_btn, self.upd_btn):
            b.state(state)

    def run_bg(self, fn, *args):
        def wrap():
            try:
                fn(*args)
            except Exception as exc:  # noqa: BLE001
                self.events.put(("fail", str(exc)))
        threading.Thread(target=wrap, daemon=True).start()

    # ------------------------------------------------------------ search
    def do_search(self):
        q = self.query.get().strip()
        if not q or self.busy:
            return
        self.set_busy(True)
        self.status.set(f"Ищу «{q}»…")
        self.run_bg(lambda: self.events.put(
            ("results", vdl.search(q, self.site.get(), 20, logger=self.logger))))

    def show_results(self, results):
        self.results = results
        self.tree.delete(*self.tree.get_children())
        for i, r in enumerate(results):
            self.tree.insert("", "end", iid=str(i),
                             values=(vdl._fmt_duration(r["duration"]), r["title"], r["channel"]))
        self.status.set(f"Найдено: {len(results)}. Выберите и нажмите «Добавить» (или двойной щелчок).")

    def add_selected(self):
        have = set(self.urls.get("1.0", "end").split())
        for iid in self.tree.selection():
            url = self.results[int(iid)]["url"]
            if url not in have:
                self.urls.insert("end", ("" if self.urls.get("1.0", "end").strip() == "" else "\n") + url)
                have.add(url)

    # ------------------------------------------------------------ download
    def hook(self, d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = d.get("downloaded_bytes", 0) * 100 / total if total else 0
            name = Path(d.get("filename", "")).name
            self.events.put(("progress", pct,
                             f"{pct:5.1f}%  {d.get('_speed_str', '').strip()}  {name[:60]}"))
        elif d["status"] == "finished":
            self.events.put(("progress", 100, "Обработка файла…"))

    def do_download(self):
        if self.busy:
            return
        urls = [u.strip() for u in self.urls.get("1.0", "end").splitlines() if u.strip()]
        if not urls:
            messagebox.showinfo("vdl", "Вставьте ссылку или найдите видео через поиск.")
            return
        q = self.quality.get()
        br = self.browser.get()
        kw = dict(out_dir=self.out.get(), quality=None if q == "лучшее" else int(q),
                  audio_only=self.audio.get(), playlist=self.playlist.get(),
                  subtitles=self.subs.get(), cookies_from_browser=None if br == "нет" else br,
                  progress_hook=self.hook, quiet=True, logger=self.logger)
        Path(kw["out_dir"]).mkdir(parents=True, exist_ok=True)
        self.set_busy(True)
        self.progress["value"] = 0
        self.status.set("Начинаю…")
        self.run_bg(lambda: self.events.put(("done", vdl.download(urls, **kw))))

    # ------------------------------------------------------------ engine
    def do_update(self):
        if self.busy:
            return
        if not vdl.FROZEN:
            messagebox.showinfo("vdl", "Запущено из исходников: обновите командой\n"
                                       "pip install -U yt-dlp")
            return
        self.set_busy(True)
        self.status.set("Скачиваю свежий yt-dlp…")
        self.run_bg(lambda: self.events.put(("updated", vdl.update_engine())))

    # ------------------------------------------------------------ event loop
    def poll(self):
        while True:
            try:
                ev = self.events.get_nowait()
            except queue.Empty:
                break
            kind = ev[0]
            if kind == "log":
                self.write_log(ev[1])
            elif kind == "progress":
                self.progress["value"] = ev[1]
                self.status.set(ev[2])
            elif kind == "results":
                self.set_busy(False)
                self.show_results(ev[1])
            elif kind == "done":
                self.set_busy(False)
                if ev[1]:
                    self.status.set("Есть ошибки — подробности ниже")
                    for e in ev[1]:
                        self.write_log(f"✖ {e}")
                    messagebox.showerror("vdl", "\n\n".join(ev[1])[:1500])
                else:
                    self.progress["value"] = 100
                    self.status.set("Готово! Файлы в папке " + self.out.get())
            elif kind == "updated":
                self.set_busy(False)
                self.status.set("Движок обновлён")
                messagebox.showinfo("vdl", "Движок обновлён. Перезапустите приложение.")
            elif kind == "fail":
                self.set_busy(False)
                self.status.set("Ошибка")
                self.write_log(f"✖ {ev[1]}")
                messagebox.showerror("vdl", ev[1][:1500])
        self.root.after(120, self.poll)


def run_gui() -> None:
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    run_gui()
