# Skilljar → Claude Extractor

Extensión de Chrome + servidor local en Python que extrae lecciones de [Skilljar](https://www.skilljar.com/) (incluyendo `academy.anthropic.com`), las guarda como archivos `.md` organizados por curso, y opcionalmente abre Claude.ai con el contenido listo para analizar.

Soporta transcripción de videos embebidos de **YouTube**, **Wistia** y **JW Player** usando `yt-dlp`.

---

## ¿Qué hace?

1. Detectas que estás en una lección de Skilljar (ej: `https://anthropic.skilljar.com/...`).
2. Abres el popup de la extensión y eliges qué quieres que haga Claude con la lección (resumen, examen, flashcards, traducción, prompt personalizado, o sólo extraer).
3. Un clic y:
   - Extrae el HTML de la lección + los transcripts de todos los videos embebidos.
   - Guarda un `.md` en `carpeta-raíz/nombre-del-curso/nombre-de-la-leccion.md`.
   - Copia el contenido al portapapeles.
   - Abre [claude.ai](https://claude.ai) con el prompt pre-cargado.

---

## Arquitectura

```
┌─────────────────────────┐       ┌──────────────────────────┐
│  Chrome Extension (MV3) │◄─────►│  server.py (localhost)   │
│  - popup.html / popup.js│ HTTP  │  - /health               │
│  - content-skilljar.js  │ :9099 │  - /transcript (yt-dlp)  │
│  - content-wistia.js    │       │  - /save                 │
│  - content-jwplayer.js  │       │  - /open-folder          │
│  - background.js        │       └──────────────────────────┘
└─────────────────────────┘
```

El servidor local hace dos cosas que una extensión no puede:
- Descargar transcripts de YouTube/Wistia via `yt-dlp`.
- Escribir archivos en tu disco.

La autenticación es por token simple (`X-Skilljar-Token`) para que ninguna página web aleatoria pueda llamar al servidor.

---

## Requisitos

- **Python 3.9+**
- **Google Chrome** (u otro navegador basado en Chromium)
- **Windows, macOS o Linux**

---

## Setup

### 1. Clonar el repo

```bash
git clone https://github.com/znmaki/skilljar-extractor.git
cd skilljar-extractor
```

### 2. Instalar dependencias del servidor

Crea un virtualenv (recomendado) e instala `yt-dlp`:

**Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install yt-dlp
```

**Windows (CMD/Git Bash):**
```bash
python -m venv .venv
.venv/Scripts/activate
pip install yt-dlp
```

**macOS / Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install yt-dlp
```

### 3. Instalar la extensión en Chrome

1. Abre `chrome://extensions`
2. Activa **Modo de desarrollador** (esquina superior derecha)
3. Clic en **Cargar descomprimida**
4. Selecciona la carpeta del repo (`skilljar-extractor/`)
5. Fija la extensión en la barra de herramientas (opcional)

### 4. Configurar carpeta de notas

1. Clic en el icono de la extensión.
2. Ve a la pestaña **⚙ Configuración**.
3. En **Carpeta raíz para las notas** escribe la ruta donde quieres guardar los `.md`, por ejemplo:
   - Windows: `C:\Users\tu-usuario\Desktop\notas`
   - macOS: `/Users/tu-usuario/Documents/notas`
4. (Opcional) ajusta los idiomas preferidos para transcripts (default: `en,en-US,es,es-ES`).
5. Clic en **Guardar configuración**.

---

## Uso

### Arrancar el servidor

Con el virtualenv activado:

```bash
python server.py
```

Salida esperada:
```
[server] yt-dlp 2026.X.X ✓
[server] Skilljar → Claude Extractor v3
[server] Corriendo en http://localhost:9099
[server] Token auth activado (header X-Skilljar-Token)
```

Deja la terminal abierta mientras uses la extensión.

### Extraer una lección

1. Abre cualquier lección en Skilljar (ej: una página de `anthropic.skilljar.com`).
2. Clic en el icono de la extensión.
3. El badge **Verificando servidor…** debe ponerse verde (`● Servidor OK`).
4. Elige qué quieres hacer con el contenido en el selector:
   - **Solo extraer contenido** — `.md` crudo sin prompt.
   - **Resumen en español**
   - **Resumen detallado + conceptos clave**
   - **Examen de práctica (10 preguntas)**
   - **Flashcards de repaso**
   - **Traducir al español**
   - **Prompt personalizado** — escribe el tuyo.
5. Clic en uno de los tres botones:
   - **Guardar .md + Abrir Claude** — guarda, copia al portapapeles, abre `claude.ai`.
   - **Solo guardar .md** — guarda sin abrir Claude.
   - **Solo copiar al portapapeles** — funciona aunque el servidor esté apagado.

El archivo queda en:
```
carpeta-raíz/
  nombre-del-curso/
    nombre-de-la-leccion.md
```

---

## Endpoints del servidor

Todos requieren el header `X-Skilljar-Token: skilljar-local-2026`.

| Método | Ruta            | Descripción                                     |
|--------|-----------------|-------------------------------------------------|
| GET    | `/health`       | Ping (responde `{ok: true, version: "3.0"}`)    |
| GET    | `/transcript`   | `?videoId=XXX&langs=en,es` — descarga subtítulos |
| POST   | `/save`         | Body: `{rootFolder, courseName, lessonName, content}` |
| GET    | `/open-folder`  | `?path=C:/...` — abre carpeta en el explorador  |

El token vive en [server.py](server.py) (`AUTH_TOKEN`) y en [background.js](background.js). Si cambias uno, cambia el otro.

---

## Archivos del proyecto

| Archivo                      | Rol                                                        |
|------------------------------|------------------------------------------------------------|
| `manifest.json`              | Manifest V3 de la extensión                                |
| `popup.html` / `popup.js`    | UI del popup                                               |
| `background.js`              | Service worker — orquesta extracción, guardado y Claude    |
| `content-skilljar.js`        | Extrae HTML de la lección en páginas de Skilljar           |
| `content-wistia.js`          | Detecta videos Wistia                                      |
| `content-jwplayer.js`        | Detecta videos JW Player                                   |
| `injected-jw-*.js`           | Scripts inyectados en el contexto de la página para hablar con la API de JW Player |
| `server.py`                  | Servidor HTTP local (transcripts + guardado)               |
| `icons/`                     | Iconos de la extensión (16/48/128 px)                      |

---

## Troubleshooting

**El badge dice "Servidor offline":**
- Verifica que `python server.py` esté corriendo.
- Confirma que el puerto `9099` no esté ocupado por otra app.
- El token en la extensión y en `server.py` debe coincidir.

**No extrae transcripts:**
- El video debe tener subtítulos (manuales o autogenerados).
- `yt-dlp` debe estar instalado (`pip install yt-dlp`).
- Algunos videos privados o con restricciones no son accesibles.

**El servidor arranca pero dice "yt-dlp no encontrado":**
- Instalaste `yt-dlp` fuera del virtualenv. Activa el venv y reinstala:
  ```bash
  .venv/Scripts/activate   # Windows
  source .venv/bin/activate  # macOS/Linux
  pip install yt-dlp
  ```

**La extracción no funciona en una página de Skilljar:**
- Refresca la página después de instalar la extensión.
- Comprueba en `chrome://extensions` que la extensión esté activa y tenga permisos para el dominio.

---

## Detener el servidor

`Ctrl+C` en la terminal.
