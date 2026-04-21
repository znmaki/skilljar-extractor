// injected-jw-api.js
// MAIN world. Consulta la API global de JW Player (window.jwplayer) para
// obtener la lista de captions (con URLs directas a los .srt/.vtt) y las
// descarga desde dentro de la página (comparte cookies/credenciales).

(function () {
  "use strict";
  const REQ = "skilljar-jw-request-api-captions";
  const RES = "skilljar-jw-response-api-captions";

  // No pasamos credentials:"include" — el CDN responde con
  // Access-Control-Allow-Origin: * y eso es incompatible con include.
  // Los .srt son públicos, no necesitan cookies de sesión.
  const fetchText = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return { url, ok: false, status: res.status, text: "" };
      return { url, ok: true, text: await res.text() };
    } catch (e) {
      return { url, ok: false, error: String(e), text: "" };
    }
  };

  // Extrae tracks candidatos desde dos fuentes de la API de JW Player.
  // Fuente 1: getPlaylistItem().tracks — lista cruda del config, con kind.
  // Fuente 2: getCaptionsList() — solo captions, con id = URL.
  // Normalizamos a { url, label, language, kind }.
  const collectTracks = (p) => {
    const out = [];
    try {
      const item = p.getPlaylistItem && p.getPlaylistItem();
      const rawTracks = (item && item.tracks) || [];
      for (const t of rawTracks) {
        if (!t || !t.file) continue;
        const kind = (t.kind || "").toLowerCase();
        if (kind && kind !== "captions" && kind !== "subtitles") continue;
        out.push({
          url: t.file,
          label: t.label || "",
          language: t.language || "",
          kind: kind || "captions",
        });
      }
    } catch {}
    if (out.length === 0 && typeof p.getCaptionsList === "function") {
      try {
        const list = p.getCaptionsList() || [];
        for (const c of list) {
          if (!c || !c.id) continue;
          if (c.id === "off") continue;
          if (!/^https?:/.test(String(c.id))) continue;
          out.push({
            url: c.id,
            label: c.label || "",
            language: c.language || "",
            kind: "captions",
          });
        }
      } catch {}
    }
    return out;
  };

  const run = async () => {
    if (typeof window.jwplayer !== "function") {
      return { ok: false, error: "jwplayer global no disponible", tracks: [] };
    }
    const p = window.jwplayer();
    if (!p) {
      return { ok: false, error: "no hay instancia de jwplayer", tracks: [] };
    }
    const candidates = collectTracks(p);
    if (candidates.length === 0) {
      return { ok: false, error: "no hay tracks de captions en la API", tracks: [] };
    }

    // Preferir English/Spanish; intentar descargar en orden, parar en el
    // primero que funcione. Si el fetch directo falla (CORS), devolvemos
    // la lista sin texto y el content script la descarga vía background.
    const score = (c) => {
      const lang = (c.language || "").toLowerCase();
      const label = (c.label || "").toLowerCase();
      if (/^en/.test(lang) || /english|inglés/.test(label)) return 2;
      if (/^es/.test(lang) || /spanish|español/.test(label)) return 1;
      return 0;
    };
    candidates.sort((a, b) => score(b) - score(a));

    // Intentar descargar el top-pick desde la página.
    const chosen = candidates[0];
    const r = await fetchText(chosen.url);
    return {
      ok: true,
      error: r.ok ? null : (r.error || `HTTP ${r.status}`),
      // Siempre devolvemos la lista completa por si el content script
      // necesita reintentar vía background. El top-pick lleva text si el
      // fetch directo funcionó; si no, va vacío y hay fallback.
      tracks: candidates.map((c, i) => ({
        url: c.url,
        label: c.label,
        language: c.language,
        text: i === 0 && r.ok ? r.text : "",
      })),
    };
  };

  window.addEventListener(REQ, function () {
    run().then((result) => {
      try {
        window.dispatchEvent(new CustomEvent(RES, { detail: result }));
      } catch {}
    });
  });
})();
