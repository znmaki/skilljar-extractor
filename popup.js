// popup.js v3

const PRESETS = {
  resumen: `Eres mi tutor personal. Te voy a pasar el contenido de una lección (en inglés) de la Anthropic Academy. Por favor:

1. Hazme un resumen claro en ESPAÑOL, bien estructurado con títulos y bullets.
2. Al final incluye una sección "Conceptos clave" con los 5-8 términos más importantes y su definición breve.
3. Si hay ejemplos o casos de uso, tradúcelos y explícalos.

Contenido de la lección:
---`,
  "resumen-detalle": `Eres mi tutor personal. Produce en español:

1. **Resumen ejecutivo** (3-4 oraciones).
2. **Puntos principales** desarrollados en detalle.
3. **Conceptos clave** — glosario con 8-12 términos y definición.
4. **Ejemplos y casos prácticos** — traducidos y explicados.
5. **Preguntas de auto-evaluación** — 5 preguntas abiertas.

Contenido de la lección:
---`,
  examen: `Eres mi profesor. Genera un examen de práctica de 10 preguntas en ESPAÑOL:
- 6 opción múltiple (4 opciones, una correcta)
- 2 verdadero/falso
- 2 preguntas abiertas cortas

Al final, sección "RESPUESTAS Y EXPLICACIONES" con respuestas y justificación breve.

Contenido:
---`,
  flashcards: `Genera 15-25 flashcards en español:

**[Frente]** pregunta o concepto
**[Dorso]** respuesta o definición

Cubre conceptos, definiciones, relaciones causa-efecto y casos de uso.

Contenido:
---`,
  traducir: `Traduce al español manteniendo estructura (títulos, listas, código). Para términos técnicos sin buena traducción, déjalos en inglés entre paréntesis la primera vez.

Contenido:
---`,
};

// ── DOM ──────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const presetSel = $("preset");
const customWrap = $("customWrap");
const customPrompt = $("customPrompt");
const statusEl = $("status");
const statsEl = $("stats");
const serverBadge = $("serverBadge");
const serverText = $("serverText");
const folderLabel = $("folderLabel");
const btnSaveAndClaude = $("btnSaveAndClaude");
const btnSaveOnly = $("btnSaveOnly");
const btnCopyOnly = $("btnCopyOnly");
const btnOpenFolder = $("btnOpenFolder");

// ── Tabs ─────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`panel-${tab.dataset.tab}`).classList.add("active");
  });
});

// ── Settings ─────────────────────────────────────
let cfg = {
  rootFolder: "",
  langs: "en,en-US,es,es-ES",
  lastPreset: "raw",
  lastCustom: "",
};

function loadConfig() {
  return new Promise((res) => {
    chrome.storage.local.get(
      ["rootFolder", "langs", "lastPreset", "lastCustom"],
      (data) => {
        cfg = { ...cfg, ...data };
        $("settingsFolder").value = cfg.rootFolder || "";
        $("settingsLangs").value = cfg.langs || "en,en-US,es,es-ES";
        folderLabel.textContent =
          cfg.rootFolder || "No configurada — ve a ⚙ Configuración";
        presetSel.value = cfg.lastPreset || "raw";
        customPrompt.value = cfg.lastCustom || "";
        customWrap.style.display = presetSel.value === "custom" ? "block" : "none";
        res();
      }
    );
  });
}

$("btnSaveSettings").addEventListener("click", () => {
  const folder = $("settingsFolder").value.trim();
  const langs = $("settingsLangs").value.trim() || "en,en-US,es,es-ES";
  chrome.storage.local.set({ rootFolder: folder, langs }, () => {
    cfg.rootFolder = folder;
    cfg.langs = langs;
    folderLabel.textContent = folder || "No configurada";
    const msg = $("settingsMsg");
    msg.style.display = "block";
    setTimeout(() => (msg.style.display = "none"), 2000);
  });
});

presetSel.addEventListener("change", () => {
  customWrap.style.display = presetSel.value === "custom" ? "block" : "none";
});

// ── Server status (con check periódico) ───────────
let serverUp = false;

function updateButtonsForServerStatus(up) {
  // Los botones que dependen del server:
  btnSaveAndClaude.disabled = !up;
  btnSaveOnly.disabled = !up;
  // El botón de "solo copiar" funciona SIN servidor (fallback)
  // btnCopyOnly siempre habilitado
}

function checkServer() {
  serverBadge.className = "checking";
  serverText.textContent = "Verificando servidor…";
  chrome.runtime.sendMessage({ type: "CHECK_SERVER" }, (res) => {
    const up = res && res.up;
    serverUp = up;
    serverBadge.className = up ? "online" : "offline";
    serverText.textContent = up
      ? "Servidor local activo ✓"
      : "Servidor offline — ejecuta: python server.py";
    updateButtonsForServerStatus(up);
  });
}

// Chequear cada 5 segundos mientras el popup está abierto
let serverCheckInterval = null;
function startServerCheck() {
  checkServer();
  serverCheckInterval = setInterval(checkServer, 5000);
}
window.addEventListener("unload", () => {
  if (serverCheckInterval) clearInterval(serverCheckInterval);
});

// ── Open folder button ────────────────────────────
btnOpenFolder.addEventListener("click", () => {
  if (!cfg.rootFolder) {
    setStatus("Configura primero la carpeta raíz en ⚙ Configuración", "warn");
    return;
  }
  if (!serverUp) {
    setStatus("Necesitas el servidor corriendo para abrir la carpeta.", "warn");
    return;
  }
  chrome.runtime.sendMessage({ type: "OPEN_FOLDER", path: cfg.rootFolder });
});

// ── Helpers ───────────────────────────────────────
function setStatus(msg, type = "ok") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function setStats(stats) {
  if (!stats) return;
  const p = [`📝 ${stats.bodyChars.toLocaleString()} chars`];
  if (stats.youtubeDetected > 0)
    p.push(`📺 YT ${stats.youtubeExtracted}/${stats.youtubeDetected}`);
  if (stats.wistiaDetected > 0)
    p.push(`🎬 Wistia ${stats.wistiaExtracted}/${stats.wistiaDetected}`);
  if (stats.jwPlayerDetected > 0)
    p.push(`🎥 JW ${stats.jwCaptionsExtracted}/${stats.jwPlayerDetected}`);
  const totalVideos =
    (stats.youtubeDetected || 0) +
    (stats.wistiaDetected || 0) +
    (stats.jwPlayerDetected || 0);
  const totalTranscripts =
    (stats.youtubeExtracted || 0) +
    (stats.wistiaExtracted || 0) +
    (stats.jwCaptionsExtracted || 0);
  if (totalVideos === 0) {
    p.push("— sin video");
  } else {
    p.push(`Σ ${totalTranscripts}/${totalVideos} transcripciones`);
  }
  statsEl.textContent = p.join(" · ");
}

function getPromptPrefix() {
  // 'raw' = sin prompt, solo el contenido de la lección tal cual
  if (presetSel.value === "raw") return "";
  if (presetSel.value === "custom")
    return customPrompt.value.trim() || "Resume esto:";
  return PRESETS[presetSel.value];
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function extractFromPage() {
  const tab = await getActiveTab();
  if (!tab?.url) throw new Error("No hay pestaña activa");
  const isOk =
    /skilljar\.com/.test(tab.url) || /academy\.anthropic\.com/.test(tab.url);
  if (!isOk)
    throw new Error("Esta pestaña no es de Skilljar ni de academy.anthropic.com");
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "EXTRACT_LESSON",
  });
  if (!response?.markdown)
    throw new Error("Sin contenido. Recarga la pestaña de Skilljar.");
  return response;
}

// ── Main actions ──────────────────────────────────
async function doExtract(openClaude) {
  const btn = openClaude ? btnSaveAndClaude : btnSaveOnly;
  try {
    btn.disabled = true;

    if (!cfg.rootFolder) {
      setStatus("Configura la carpeta raíz en ⚙ Configuración primero.", "warn");
      return;
    }

    if (!serverUp) {
      setStatus(
        "Servidor offline. Usa 'Solo copiar al portapapeles' o ejecuta: python server.py",
        "warn"
      );
      return;
    }

    setStatus("Extrayendo lección…", "ok");
    const data = await extractFromPage();
    setStats(data.stats);

    // Guardar archivo
    setStatus("Guardando archivo…", "ok");
    const saveRes = await new Promise((res) =>
      chrome.runtime.sendMessage(
        {
          type: "SAVE_FILE",
          rootFolder: cfg.rootFolder,
          courseName: data.meta.courseTitle || "sin-curso",
          lessonName: data.meta.lessonTitle || "leccion",
          content: data.markdown,
        },
        res
      )
    );

    if (!saveRes?.ok) throw new Error(saveRes?.error || "Error al guardar");

    // Persistir último preset
    chrome.storage.local.set({
      lastPreset: presetSel.value,
      lastCustom: customPrompt.value,
    });

    if (openClaude) {
      const prompt = `${getPromptPrefix()}\n\n${data.markdown}`;
      await navigator.clipboard.writeText(prompt);
      setStatus(
        `✓ Guardado en ${saveRes.path}\n   Abriendo Claude… pega con Ctrl+V`,
        "ok"
      );
      await chrome.tabs.create({ url: "https://claude.ai/new" });
    } else {
      setStatus(`✓ Guardado en:\n${saveRes.path}`, "ok");
    }
  } catch (e) {
    setStatus(`Error: ${e.message}`, "err");
    console.error(e);
  } finally {
    // Solo re-habilitar si el server sigue arriba
    if (serverUp) btn.disabled = false;
  }
}

// Fallback: copiar al portapapeles sin depender del servidor
async function doCopyOnly() {
  try {
    btnCopyOnly.disabled = true;
    setStatus("Extrayendo…", "ok");
    const data = await extractFromPage();
    setStats(data.stats);

    const prompt = `${getPromptPrefix()}\n\n${data.markdown}`;
    await navigator.clipboard.writeText(prompt);

    chrome.storage.local.set({
      lastPreset: presetSel.value,
      lastCustom: customPrompt.value,
    });

    setStatus(
      `✓ ${prompt.length.toLocaleString()} caracteres copiados al portapapeles`,
      "ok"
    );
  } catch (e) {
    setStatus(`Error: ${e.message}`, "err");
    console.error(e);
  } finally {
    btnCopyOnly.disabled = false;
  }
}

btnSaveAndClaude.addEventListener("click", () => doExtract(true));
btnSaveOnly.addEventListener("click", () => doExtract(false));
btnCopyOnly.addEventListener("click", doCopyOnly);

// ── Init ──────────────────────────────────────────
loadConfig().then(startServerCheck);
