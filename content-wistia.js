// content-wistia.js
// Corre DENTRO de iframes de wistia.com / wistia.net
// Extrae la transcripción del JSON que Wistia embebe en <script> tags,
// y también escucha al API de Wistia si está disponible.

(function () {
  "use strict";

  // Wistia embebe un script con un JSON gigante que incluye "transcript" y/o "captions".
  // Estrategia: buscar scripts que mencionen "transcript" o "captions" y parsear el JSON.
  function extractFromScripts() {
    const scripts = [...document.querySelectorAll("script")];
    for (const s of scripts) {
      const t = s.textContent || "";
      if (!t.includes("transcript") && !t.includes("captions")) continue;

      // Intenta encontrar uno o más bloques JSON dentro del script
      const jsonCandidates = t.match(/\{[\s\S]*\}/g) || [];
      for (const raw of jsonCandidates) {
        try {
          const obj = JSON.parse(raw);
          const found = searchTranscript(obj);
          if (found) return found;
        } catch {
          // sigue intentando con otros candidatos
        }
      }
    }
    return null;
  }

  // Busca recursivamente un campo "transcript" o "captions" dentro de un objeto
  function searchTranscript(obj, depth = 0) {
    if (!obj || depth > 8) return null;

    if (typeof obj === "object") {
      // Caso 1: campo transcript string directo
      if (typeof obj.transcript === "string" && obj.transcript.length > 40) {
        return {
          transcript: obj.transcript,
          name: obj.name || obj.title || null,
          source: "script-transcript-field",
        };
      }

      // Caso 2: captions array de objetos {text, start, ...}
      if (Array.isArray(obj.captions) && obj.captions.length > 0) {
        const text = obj.captions
          .map((c) => (typeof c === "string" ? c : c.text || c.content || ""))
          .filter(Boolean)
          .join(" ");
        if (text.length > 40) {
          return {
            transcript: text,
            name: obj.name || obj.title || null,
            source: "script-captions-array",
          };
        }
      }

      // Caso 3: captions objeto con "lines" o "body" (formato WebVTT-like)
      if (obj.captions && typeof obj.captions === "object") {
        const lines = obj.captions.lines || obj.captions.body || null;
        if (Array.isArray(lines)) {
          const text = lines
            .map((l) => (typeof l === "string" ? l : l.text || ""))
            .filter(Boolean)
            .join(" ");
          if (text.length > 40) {
            return { transcript: text, source: "script-captions-lines" };
          }
        }
      }

      // Recurre
      for (const k in obj) {
        try {
          const r = searchTranscript(obj[k], depth + 1);
          if (r) return r;
        } catch {}
      }
    }
    return null;
  }

  // Plan B: leer los nodos de transcripción renderizados en el DOM (si Wistia puso el plugin v2 visible)
  function extractFromDOM() {
    const candidates = document.querySelectorAll(
      '[class*="transcript" i], [id*="transcript" i]'
    );
    for (const el of candidates) {
      const txt = (el.textContent || "").trim();
      if (txt.length > 60) {
        return { transcript: txt, source: "dom-scrape" };
      }
    }
    return null;
  }

  // Plan C: usar el API de Wistia si está cargado
  function extractFromWistiaAPI() {
    try {
      const W = window.Wistia || window._wq;
      if (!W) return null;
      // La API de Wistia expone .captions() en la instancia del video
      if (Array.isArray(window._wq)) {
        // no hay forma síncrona fiable aquí
      }
    } catch {}
    return null;
  }

  function extract() {
    return (
      extractFromScripts() || extractFromDOM() || extractFromWistiaAPI() || null
    );
  }

  // Escucha mensajes desde el content script padre
  window.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!data || data.__skilljarExtractor !== "get-transcript") return;

    const result = extract();
    try {
      ev.source.postMessage(
        {
          __skilljarExtractor: "wistia-transcript",
          payload: result, // null si no se encontró
        },
        "*"
      );
    } catch (e) {
      // nada que hacer
    }
  });
})();
