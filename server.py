#!/usr/bin/env python3
"""
Skilljar Extractor v3 — Servidor local
=======================================
Puerto: http://localhost:9099

Endpoints (todos requieren header X-Skilljar-Token):
  GET  /health
  GET  /transcript?videoId=XXX&langs=en,es
  POST /save        body JSON: {rootFolder, courseName, lessonName, content}
  GET  /open-folder?path=C:/...

Instalación:
    pip install yt-dlp

Arranque:
    python server.py
"""

import json
import os
import platform
import re
import subprocess
import sys
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = 9099

# Token compartido con la extensión. No es un secreto criptográfico;
# solo previene que una página web aleatoria llame al servidor local.
# Cámbialo si quieres, pero debe coincidir con AUTH_TOKEN en background.js.
AUTH_TOKEN = "skilljar-local-2026"


# ─────────────────────────────────────────────
#  Transcript via yt-dlp
# ─────────────────────────────────────────────

def extract_transcript(video_id: str, langs: list = None) -> dict:
    if langs is None:
        langs = ["en", "en-US", "es", "es-ES", "es-419"]

    url = f"https://www.youtube.com/watch?v={video_id}"

    with tempfile.TemporaryDirectory() as tmpdir:
        for auto in [False, True]:
            lang_str = ",".join(langs)
            cmd = [
                sys.executable, "-m", "yt_dlp",
                "--skip-download",
                "--write-subs" if not auto else "--write-auto-subs",
                "--sub-langs", lang_str,
                "--sub-format", "vtt",
                "--output", os.path.join(tmpdir, "%(id)s.%(ext)s"),
                "--no-playlist",
                "--quiet",
                url,
            ]
            subprocess.run(cmd, capture_output=True, timeout=45)

            vtt_file = None
            detected_lang = "unknown"
            for fname in os.listdir(tmpdir):
                if fname.endswith(".vtt"):
                    vtt_file = os.path.join(tmpdir, fname)
                    parts = fname.rsplit(".", 2)
                    detected_lang = parts[1] if len(parts) == 3 else "unknown"
                    break

            if vtt_file:
                transcript = parse_vtt(vtt_file)
                if transcript:
                    return {
                        "ok": True,
                        "transcript": transcript,
                        "language": detected_lang,
                        "kind": "auto-generated" if auto else "manual",
                        "videoId": video_id,
                        "lineCount": len(transcript.split()),
                    }

    return {
        "ok": False,
        "error": "No se encontraron subtítulos para este video.",
        "videoId": video_id,
    }


def parse_vtt(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        content = f.read()

    lines = []
    seen_last = None
    for line in content.splitlines():
        line = line.strip()
        if not line or line == "WEBVTT" or "-->" in line:
            continue
        if line.isdigit():
            continue
        line = re.sub(r"<[^>]+>", "", line).strip()
        if not line or line == seen_last:
            continue
        lines.append(line)
        seen_last = line

    return " ".join(lines)


# ─────────────────────────────────────────────
#  File saving
# ─────────────────────────────────────────────

def slugify(text: str, max_len: int = 60) -> str:
    """Convierte texto a nombre de carpeta/archivo seguro en Windows."""
    text = text.strip()
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", text)
    text = re.sub(r'\s+', "-", text).strip("-")
    reserved = {"CON", "PRN", "AUX", "NUL",
                "COM1", "COM2", "COM3", "COM4", "COM5",
                "COM6", "COM7", "COM8", "COM9",
                "LPT1", "LPT2", "LPT3", "LPT4",
                "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}
    if text.upper() in reserved:
        text = "_" + text
    return text[:max_len].lower()


def save_markdown(root_folder: str, course_name: str, lesson_name: str, content: str) -> dict:
    """
    Guarda content en:
        root_folder/
          {course_slug}/
            {lesson_slug}.md
    """
    try:
        root = Path(root_folder)
        course_slug = slugify(course_name or "sin-curso")
        lesson_slug = slugify(lesson_name or "leccion")

        folder = root / course_slug
        folder.mkdir(parents=True, exist_ok=True)

        filepath = folder / f"{lesson_slug}.md"
        counter = 1
        while filepath.exists():
            filepath = folder / f"{lesson_slug}-{counter}.md"
            counter += 1

        filepath.write_text(content, encoding="utf-8")

        return {
            "ok": True,
            "path": str(filepath),
            "folder": str(folder),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def open_folder_crossplatform(folder: str) -> dict:
    """Abre una carpeta en el explorador del sistema (Windows/Mac/Linux)."""
    if not os.path.isdir(folder):
        return {"ok": False, "error": "Carpeta no encontrada"}
    try:
        system = platform.system()
        if system == "Windows":
            os.startfile(folder)
        elif system == "Darwin":
            subprocess.run(["open", folder], check=False)
        else:  # Linux / otros Unix
            subprocess.run(["xdg-open", folder], check=False)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ─────────────────────────────────────────────
#  HTTP Handler
# ─────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silenciar logs por defecto

    def _check_auth(self) -> bool:
        """Verifica el token en el header. Si falta o es incorrecto, rechaza."""
        received = self.headers.get("X-Skilljar-Token", "")
        return received == AUTH_TOKEN

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        # El endpoint /health también requiere auth — así los sitios maliciosos
        # ni siquiera pueden saber si tu server existe.
        if not self._check_auth():
            self._json({"ok": False, "error": "Token inválido o ausente"}, 403)
            return

        if parsed.path == "/health":
            self._json({"ok": True, "version": "3.0"})

        elif parsed.path == "/transcript":
            video_id = params.get("videoId", [None])[0]
            langs = params.get("langs", ["en,en-US,es,es-ES"])[0].split(",")
            if not video_id or not re.match(r"^[a-zA-Z0-9_-]{11}$", video_id):
                self._json({"ok": False, "error": "videoId inválido"}, 400)
                return
            print(f"[server] Transcribiendo: {video_id}")
            self._json(extract_transcript(video_id, langs))

        elif parsed.path == "/open-folder":
            folder = params.get("path", [None])[0]
            if not folder:
                self._json({"ok": False, "error": "path requerido"}, 400)
                return
            self._json(open_folder_crossplatform(folder))

        else:
            self._json({"ok": False, "error": "Ruta no encontrada"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if not self._check_auth():
            self._json({"ok": False, "error": "Token inválido o ausente"}, 403)
            return

        if parsed.path == "/save":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except Exception:
                self._json({"ok": False, "error": "JSON inválido"}, 400)
                return

            root_folder = data.get("rootFolder", "")
            course_name = data.get("courseName", "sin-curso")
            lesson_name = data.get("lessonName", "leccion")
            content = data.get("content", "")

            if not root_folder:
                self._json({"ok": False, "error": "rootFolder requerido"}, 400)
                return

            print(f"[server] Guardando: {course_name} / {lesson_name}")
            self._json(save_markdown(root_folder, course_name, lesson_name, content))

        else:
            self._json({"ok": False, "error": "Ruta no encontrada"}, 404)

    def _json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def _cors(self):
        # CORS abierto porque cualquier chrome-extension:// tiene un origin único
        # y no podemos listarlo por adelantado. La protección real es el token.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type, X-Skilljar-Token"
        )


# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────

def check_yt_dlp():
    try:
        r = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            print(f"[server] yt-dlp {r.stdout.strip()} ✓")
            return True
    except Exception:
        pass
    print("[server] ERROR: yt-dlp no encontrado. Instálalo con:  pip install yt-dlp")
    return False


if __name__ == "__main__":
    if not check_yt_dlp():
        sys.exit(1)

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[server] Skilljar → Claude Extractor v3")
    print(f"[server] Corriendo en http://localhost:{PORT}")
    print(f"[server] Token auth activado (header X-Skilljar-Token)")
    print(f"[server] Plataforma: {platform.system()}")
    print(f"[server] Endpoints: /health  /transcript  /save  /open-folder")
    print(f"[server] Ctrl+C para detener.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] Detenido.")
