"""Простое окно для vdl (tkinter входит в стандартный Python на Windows/macOS)."""
from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from vdl import download


def run_gui() -> None:
    root = tk.Tk()
    root.title("vdl — загрузчик видео")
    root.geometry("620x330")
    events: queue.Queue = queue.Queue()

    frm = ttk.Frame(root, padding=12)
    frm.pack(fill="both", expand=True)
    frm.columnconfigure(1, weight=1)

    ttk.Label(frm, text="Ссылки (по одной в строке):").grid(row=0, column=0, columnspan=3, sticky="w")
    urls_box = tk.Text(frm, height=5)
    urls_box.grid(row=1, column=0, columnspan=3, sticky="nsew", pady=4)

    ttk.Label(frm, text="Папка:").grid(row=2, column=0, sticky="w")
    out_var = tk.StringVar(value="downloads")
    ttk.Entry(frm, textvariable=out_var).grid(row=2, column=1, sticky="ew", padx=4)
    ttk.Button(frm, text="…", width=3,
               command=lambda: out_var.set(filedialog.askdirectory() or out_var.get())
               ).grid(row=2, column=2)

    opts = ttk.Frame(frm)
    opts.grid(row=3, column=0, columnspan=3, sticky="w", pady=6)
    ttk.Label(opts, text="Качество:").pack(side="left")
    quality_var = tk.StringVar(value="лучшее")
    ttk.Combobox(opts, textvariable=quality_var, width=8, state="readonly",
                 values=["лучшее", "2160", "1440", "1080", "720", "480", "360"]).pack(side="left", padx=4)
    audio_var, playlist_var, subs_var = tk.BooleanVar(), tk.BooleanVar(), tk.BooleanVar()
    ttk.Checkbutton(opts, text="только звук (mp3)", variable=audio_var).pack(side="left", padx=6)
    ttk.Checkbutton(opts, text="весь плейлист", variable=playlist_var).pack(side="left", padx=6)
    ttk.Checkbutton(opts, text="субтитры", variable=subs_var).pack(side="left", padx=6)

    progress = ttk.Progressbar(frm, maximum=100)
    progress.grid(row=4, column=0, columnspan=3, sticky="ew", pady=4)
    status = tk.StringVar(value="Готов к работе")
    ttk.Label(frm, textvariable=status).grid(row=5, column=0, columnspan=3, sticky="w")
    btn = ttk.Button(frm, text="Скачать")
    btn.grid(row=6, column=0, columnspan=3, pady=8)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            pct = d.get("downloaded_bytes", 0) * 100 / total if total else 0
            events.put(("progress", pct, f"Загрузка: {pct:5.1f}%  {d.get('_speed_str', '').strip()}"))
        elif d["status"] == "finished":
            events.put(("progress", 100, "Обработка файла…"))

    def worker(urls, kw):
        try:
            errors = download(urls, progress_hook=hook, quiet=True, **kw)
        except Exception as exc:  # noqa: BLE001
            errors = [str(exc)]
        events.put(("done", errors))

    def start():
        urls = [u.strip() for u in urls_box.get("1.0", "end").splitlines() if u.strip()]
        if not urls:
            messagebox.showwarning("vdl", "Вставьте хотя бы одну ссылку")
            return
        q = quality_var.get()
        kw = dict(out_dir=out_var.get(), quality=None if q == "лучшее" else int(q),
                  audio_only=audio_var.get(), playlist=playlist_var.get(), subtitles=subs_var.get())
        btn.state(["disabled"])
        status.set("Начинаю…")
        threading.Thread(target=worker, args=(urls, kw), daemon=True).start()

    def poll():
        while not events.empty():
            ev = events.get()
            if ev[0] == "progress":
                progress["value"], _ = ev[1], status.set(ev[2])
            else:
                btn.state(["!disabled"])
                if ev[1]:
                    status.set("Есть ошибки")
                    messagebox.showerror("vdl", "\n\n".join(ev[1]))
                else:
                    status.set("Готово!")
                    progress["value"] = 100
        root.after(150, poll)

    btn.configure(command=start)
    poll()
    root.mainloop()


if __name__ == "__main__":
    run_gui()
