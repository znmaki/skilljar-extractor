// content-skilljar.js
// Corre en anthropic.skilljar.com / academy.anthropic.com
// Extrae: metadata, contenido de la lección (limpio), transcripciones de video
// (YouTube vía background, Wistia vía iframe message).

(function () {
  "use strict";

  // ---------- Utilidades ----------
  const clean = (s) =>
    (s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const st = window.getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      st.visibility !== "hidden" &&
      st.display !== "none" &&
      st.opacity !== "0"
    );
  };

  // ---------- Metadata ----------
  function extractMetadata() {
    const meta = {
      url: location.href,
      pageTitle: document.title,
      lessonTitle: null,
      courseTitle: null,
    };

    const titleSelectors = [
      "h1.lesson-title",
      ".lesson-title",
      ".lesson-header h1",
      ".lesson-header h2",
      "main h1",
      "h1",
      '[class*="lesson"][class*="title"]',
      '[class*="LessonTitle"]',
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && visible(el) && clean(el.textContent).length > 2) {
        meta.lessonTitle = clean(el.textContent);
        break;
      }
    }

    const courseSelectors = [
      ".course-title",
      '[class*="course"][class*="title"]',
      ".breadcrumb a",
      'nav[aria-label*="breadcrumb" i] a',
    ];
    for (const sel of courseSelectors) {
      const el = document.querySelector(sel);
      if (el && visible(el) && clean(el.textContent).length > 2) {
        meta.courseTitle = clean(el.textContent);
        break;
      }
    }

    return meta;
  }

  // ---------- Extracción del cuerpo (con limpieza agresiva) ----------
  function extractLessonBody() {
    const bodySelectors = [
      ".lesson-content",
      ".lesson-body",
      ".content-body",
      '[class*="LessonContent"]',
      '[class*="lesson-content"]',
      "main article",
      "main .content",
      "#lesson-content",
      "main",
    ];

    let bodyEl = null;
    for (const sel of bodySelectors) {
      const el = document.querySelector(sel);
      if (el && visible(el) && clean(el.textContent).length > 80) {
        bodyEl = el;
        break;
      }
    }
    if (!bodyEl) {
      const mains = [...document.querySelectorAll("main, [role='main']")];
      mains.sort((a, b) => b.textContent.length - a.textContent.length);
      bodyEl = mains[0] || document.body;
    }

    // Clonar y quitar ruido agresivamente
    const clone = bodyEl.cloneNode(true);
    const kill = [
      "script",
      "style",
      "noscript",
      "header",
      "nav",
      "footer",
      "video",
      "audio",
      ".jwplayer",
      ".jw-wrapper",
      ".jw-media",
      ".jw-controls",
      ".jw-preview",
      ".jw-captions",
      ".jw-title",
      ".jw-display-icon-container",
      "[class*='jw-' i]",
      ".video-js",
      ".vjs-control-bar",
      "[aria-hidden='true']",
      "[role='navigation']",
      "[role='banner']",
      "[role='contentinfo']",
      ".sidebar",
      ".nav",
      ".navigation",
      ".header",
      ".footer",
      ".breadcrumb",
      ".menu",
      ".user-menu",
      ".avatar",
      ".logo",
      '[class*="menu" i]',
      '[class*="sidebar" i]',
      '[class*="breadcrumb" i]',
      '[class*="header" i]',
      '[class*="footer" i]',
      '[class*="nav" i]:not([class*="navigation-complete" i])',
      'a[href*="/accounts/profile"]',
      'a[href*="/auth/logout"]',
      'a[href*="logout"]',
      'a[href="#"]',
    ];
    kill.forEach((sel) => {
      try {
        clone.querySelectorAll(sel).forEach((n) => n.remove());
      } catch {}
    });

    // Quitar también cualquier botón o form de navegación
    clone.querySelectorAll("button").forEach((b) => {
      const t = (b.textContent || "").toLowerCase();
      if (/sign out|log out|cerrar sesión|my profile|menu/.test(t)) b.remove();
    });

    // HTML → markdown-lite
    const toMd = (node) => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return "";
      const tag = node.tagName.toLowerCase();
      const kids = [...node.childNodes].map(toMd).join("");
      switch (tag) {
        case "h1":
          return `\n\n# ${clean(kids)}\n\n`;
        case "h2":
          return `\n\n## ${clean(kids)}\n\n`;
        case "h3":
          return `\n\n### ${clean(kids)}\n\n`;
        case "h4":
        case "h5":
        case "h6":
          return `\n\n#### ${clean(kids)}\n\n`;
        case "p":
          return `\n\n${kids}\n\n`;
        case "br":
          return "\n";
        case "li":
          return `\n- ${clean(kids)}`;
        case "ul":
        case "ol":
          return `\n${kids}\n`;
        case "strong":
        case "b":
          return `**${kids}**`;
        case "em":
        case "i":
          return `*${kids}*`;
        case "code":
          return `\`${kids}\``;
        case "pre":
          return `\n\n\`\`\`\n${node.textContent}\n\`\`\`\n\n`;
        case "a": {
          const href = node.getAttribute("href") || "";
          // Ignorar enlaces internos de nav y anclas
          if (!href || href.startsWith("#") || href.includes("/accounts/") ||
              href.includes("/auth/") || href === "/") {
            return clean(kids);
          }
          return href ? `[${clean(kids)}](${href})` : clean(kids);
        }
        case "img": {
          const alt = node.getAttribute("alt") || "imagen";
          const src = node.getAttribute("src") || "";
          // Filtrar logos, avatars, iconos
          if (/logo|avatar|icon|gravatar/i.test(src) ||
              /logo|avatar|icon/i.test(alt)) {
            return "";
          }
          return ` ![${alt}](${src}) `;
        }
        default:
          return kids;
      }
    };

    let md = toMd(clone);

    // Post-procesamiento: cortar todo lo anterior al primer título significativo
    // "What you'll learn", "Lo que aprenderás", o el primer h1/h2 que NO sea basura
    const anchors = [
      /^#{1,3}\s+What you['']ll learn/m,
      /^#{1,3}\s+Lo que aprenderás/m,
      /^\*\*What you['']ll learn\*\*/m,
      /^\*\*Lo que aprenderás\*\*/m,
    ];
    for (const rx of anchors) {
      const m = md.match(rx);
      if (m && m.index > 50) {
        md = md.slice(m.index);
        break;
      }
    }

    // Limpieza de líneas basura residuales.
    const noisePatterns = [
      /^\*{1,2}\s*$/,                               // líneas con solo asteriscos
      /^this video is still being processed/i,      // JW Player placeholder
      /^please check back later/i,
      /^uh oh!?\s+something went wrong/i,
      /^anthropic\s*$/i,                            // logo text suelto
      /^open in claude\s*$/i,                       // botón de Skilljar
      /^welcome to the course\s*$/i,                // duplicado del h1
      /^courses?\s*$/i,                             // link del nav
      /^anthropic academy\s*$/i,                    // header nav
    ];
    md = md
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true; // preservar blank lines por ahora
        return !noisePatterns.some((rx) => rx.test(trimmed));
      })
      .join("\n");

    // Colapsar espacios internos dentro de cada línea (pero conservar saltos).
    md = md
      .split("\n")
      .map((l) => l.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""))
      .join("\n");

    // Colapsar múltiples blank lines
    md = md.replace(/\n{3,}/g, "\n\n").trim();

    return md;
  }

  // ---------- Detección de iframes de video ----------
  function scanIframesOnce() {
    const iframes = [...document.querySelectorAll("iframe")];
    const youtube = [];
    const wistia = [];
    const others = [];

    for (const f of iframes) {
      // Probar src, data-src, src-original (Skilljar usa lazy loading)
      const src =
        f.src ||
        f.getAttribute("data-src") ||
        f.getAttribute("data-lazy-src") ||
        f.getAttribute("src-original") ||
        "";
      const ytMatch = src.match(
        /(?:youtube\.com\/(?:embed|watch\?v=)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([a-zA-Z0-9_-]{11})/
      );
      if (ytMatch) {
        youtube.push({ iframe: f, videoId: ytMatch[1], src });
        continue;
      }
      if (/wistia\.(com|net)/.test(src)) {
        wistia.push(f);
        continue;
      }
      if (src) others.push({ src, title: f.title || "" });
    }

    // Fallback 1: re-escanear los iframes que cayeron en "others" buscando
    // patrones de YouTube más laxos (por si el src tenía query params raros
    // o el primer regex falló por alguna razón sutil).
    if (youtube.length === 0 && others.length > 0) {
      const laxPattern = /[?&/]v[=/]([a-zA-Z0-9_-]{11})|\/embed\/([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})/;
      for (let i = others.length - 1; i >= 0; i--) {
        const o = others[i];
        if (/youtube|youtu\.be|ytimg/i.test(o.src)) {
          const m = o.src.match(laxPattern);
          const id = m && (m[1] || m[2] || m[3]);
          if (id) {
            youtube.push({ iframe: null, videoId: id, src: o.src });
            others.splice(i, 1);
            console.log(`[skilljar-extractor] Rescatado de others: ${id} (src: ${o.src})`);
          }
        }
      }
    }

    // Fallback 2: HTML completo (thumbnails, data attributes, JSON embebido)
    if (youtube.length === 0) {
      const html = document.documentElement.innerHTML;
      const ids = new Set();
      const patterns = [
        /youtube\.com\/(?:embed|watch\?v=)([a-zA-Z0-9_-]{11})/g,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/g,
        /youtube-nocookie\.com\/embed\/([a-zA-Z0-9_-]{11})/g,
        /i\.ytimg\.com\/vi\/([a-zA-Z0-9_-]{11})\//g,
        /img\.youtube\.com\/vi\/([a-zA-Z0-9_-]{11})\//g,
      ];
      for (const rx of patterns) {
        for (const m of html.matchAll(rx)) ids.add(m[1]);
      }
      for (const id of ids) {
        youtube.push({
          iframe: null,
          videoId: id,
          src: `detected-from-html:${id}`,
        });
      }
    }

    return { youtube, wistia, others };
  }

  // Polling: el reproductor puede cargarse lazy después de un clic.
  // Escanea hasta 5 veces con 400ms entre intentos.
  async function findVideos() {
    let result = scanIframesOnce();
    if (result.youtube.length > 0 || result.wistia.length > 0) return result;

    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 400));
      result = scanIframesOnce();
      if (result.youtube.length > 0 || result.wistia.length > 0) {
        console.log(`[skilljar-extractor] Video detectado tras ${(i + 1) * 400}ms de polling`);
        return result;
      }
    }
    return result;
  }

  // ---------- Transcripciones de YouTube (vía background) ----------
  // Envía un mensaje al background con timeout manual. Devuelve:
  //   { response, error }
  // Timeout evita que el content script se cuelgue si el service worker
  // está dormido y nunca responde.
  function sendMessageWithTimeout(message, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ response: null, error: `Timeout tras ${timeoutMs}ms` });
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({
              response: null,
              error: chrome.runtime.lastError.message || "runtime error sin mensaje",
            });
            return;
          }
          resolve({ response, error: null });
        });
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ response: null, error: e.message });
      }
    });
  }

  // Despierta el service worker con un ping barato. El primer mensaje tras
  // suspensión puede perderse silenciosamente en Chrome MV3, así que mejor
  // tirar un CHECK_SERVER primero.
  async function wakeBackground() {
    const { error } = await sendMessageWithTimeout({ type: "CHECK_SERVER" }, 3000);
    if (error) {
      console.warn("[skilljar-extractor] Ping al background falló, reintentando:", error);
      await sendMessageWithTimeout({ type: "CHECK_SERVER" }, 3000);
    }
  }

  async function requestYouTubeTranscripts(videos) {
    if (videos.length === 0) return { results: [], bridgeError: null };
    const videoIds = videos.map((v) => v.videoId);

    await wakeBackground();

    console.log("[skilljar-extractor] Pidiendo transcripciones al background para:", videoIds);

    // Reintentar hasta 2 veces si el bridge falla (service worker dormido)
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { response, error } = await sendMessageWithTimeout(
        {
          type: "GET_YOUTUBE_TRANSCRIPTS",
          videoIds,
          options: { preferredLangs: ["en", "en-US", "es", "es-ES"] },
        },
        60000
      );

      if (error) {
        console.warn(
          `[skilljar-extractor] Intento ${attempt} falló:`,
          error
        );
        if (attempt === 2) {
          return { results: [], bridgeError: error };
        }
        continue;
      }

      console.log("[skilljar-extractor] Respuesta del background:", response);
      if (!Array.isArray(response)) {
        return {
          results: [],
          bridgeError: `Respuesta inesperada del background: ${JSON.stringify(response)}`,
        };
      }
      return { results: response, bridgeError: null };
    }

    return { results: [], bridgeError: "Agotados los reintentos" };
  }

  // ---------- JW Player (videos nativos con captions .vtt) ----------
  function hasJWPlayer() {
    return !!document.querySelector(
      "video.jw-video, .jwplayer, .jw-wrapper, [class*='jw-media']"
    );
  }

  // Detecta si el texto es SRT (no WEBVTT) y lo normaliza a VTT-like.
  // SRT: cues numerados, timestamps con coma (00:00:01,500).
  function srtToVtt(text) {
    if (!text) return text;
    // Si ya parece VTT, no tocar.
    if (/^\s*WEBVTT/i.test(text.slice(0, 20))) return text;
    // Heurística: líneas con " --> " y coma en timestamp = SRT.
    if (!/\d\d:\d\d:\d\d,\d{3}\s*-->/.test(text)) return text;
    const normalized = text.replace(
      /(\d\d:\d\d:\d\d),(\d{3})/g,
      "$1.$2"
    );
    return `WEBVTT\n\n${normalized}`;
  }

  // Parsea un WebVTT (o SRT; se normaliza) a texto plano.
  function vttToPlainText(vtt) {
    if (!vtt) return "";
    vtt = srtToVtt(vtt);
    const lines = vtt.split(/\r?\n/);
    const out = [];
    let skipBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (i === 0 && /^WEBVTT/i.test(trimmed)) continue;
      if (!trimmed) {
        skipBlock = false;
        continue;
      }
      if (/^NOTE(\s|$)/.test(trimmed) || /^STYLE$/i.test(trimmed)) {
        skipBlock = true;
        continue;
      }
      if (skipBlock) continue;
      // Línea de timestamp
      if (/-->/.test(trimmed)) continue;
      // Cue identifier (número solo, o sin "-->") — si la siguiente línea
      // tiene timestamp, esto es el id y lo saltamos.
      if (/^[\w-]+$/.test(trimmed) && i + 1 < lines.length && /-->/.test(lines[i + 1])) {
        continue;
      }
      // Quitar tags <v Speaker>, <c.className>, <i>, etc.
      const stripped = trimmed
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      out.push(stripped);
    }
    // Colapsar repeticiones adyacentes (JW a veces duplica cues por rolling)
    const dedup = [];
    for (const l of out) {
      if (dedup[dedup.length - 1] !== l) dedup.push(l);
    }
    return dedup.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  // Descarga una lista de tracks vía background script (evade CORS).
  // Intenta solo el primero (top-pick) — si falla, intenta el siguiente.
  async function downloadTracksViaBackground(tracks) {
    const out = [];
    for (const t of tracks) {
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "FETCH_TEXT", url: t.url }, (r) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message, text: "" });
            } else {
              resolve(r || { ok: false, text: "" });
            }
          });
        });
        if (res.ok && res.text && res.text.length > 20) {
          out.push({ url: t.url, label: t.label, language: t.language, text: res.text });
          break; // Uno es suficiente
        }
      } catch (e) {
        console.warn(`[skilljar-extractor] Descarga bg falló para ${t.url}:`, e);
      }
    }
    return out;
  }

  // Convierte un array de cues {start, end, text} a VTT para reusar el
  // parser vttToPlainText. Más simple que tener dos pipelines.
  function cuesToVtt(cues) {
    const fmt = (t) => {
      const ms = Math.floor((t % 1) * 1000);
      const total = Math.floor(t);
      const s = total % 60;
      const m = Math.floor(total / 60) % 60;
      const h = Math.floor(total / 3600);
      const pad = (n, w) => String(n).padStart(w, "0");
      return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
    };
    const body = cues
      .map((c) => `${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}`)
      .join("\n\n");
    return `WEBVTT\n\n${body}\n`;
  }

  // Lee los cues directamente del <video>.textTracks — evita el fetch-hook,
  // más confiable porque el navegador ya parseó el VTT y tiene los cues listos
  // (incluso cuando el track fue inyectado programáticamente por JW, sin
  // pasar por fetch visible).
  async function readJWCuesAsCaptions() {
    if (typeof window.__skilljarGetJWCues !== "function") return [];
    const tracks = await window.__skilljarGetJWCues(1500);
    // Preferir tracks de subtitles/captions con cues; filtrar descriptivos
    // (kind: metadata/chapters) y los vacíos.
    const usable = tracks.filter((t) => {
      const kind = (t.kind || "").toLowerCase();
      if (kind && kind !== "subtitles" && kind !== "captions") return false;
      return t.cueCount > 0 && Array.isArray(t.cues) && t.cues.length > 0;
    });
    // Preferir English/Spanish si hay varios.
    const score = (t) => {
      const lang = (t.language || "").toLowerCase();
      const label = (t.label || "").toLowerCase();
      if (/^en/.test(lang) || /english|inglés/.test(label)) return 2;
      if (/^es/.test(lang) || /spanish|español/.test(label)) return 1;
      return 0;
    };
    usable.sort((a, b) => score(b) - score(a));

    return usable.map((t) => ({
      url: `texttrack:${t.language || t.label || t.kind}`,
      text: cuesToVtt(t.cues),
    }));
  }

  async function collectJWCaptions() {
    if (!hasJWPlayer()) return [];

    // Estrategia 1 (más confiable): consultar window.jwplayer() directamente
    // y descargar el .srt/.vtt del idioma preferido. No requiere playback,
    // no requiere abrir menús, no espera intercepciones.
    if (typeof window.__skilljarGetJWApiCaptions === "function") {
      const api = await window.__skilljarGetJWApiCaptions(6000);
      if (api && Array.isArray(api.tracks) && api.tracks.length > 0) {
        // Primer pase: ¿alguno viene ya con texto desde el MAIN world?
        let valid = api.tracks.filter((t) => t.text && t.text.length > 20);
        if (valid.length > 0) {
          console.log(`[skilljar-extractor] Captions obtenidos vía JW API (${valid.length} track(s))`);
          return valid;
        }
        // Fallback: descargar vía background script (evade CORS).
        console.log("[skilljar-extractor] Fetch directo falló, descargando vía background...");
        const downloaded = await downloadTracksViaBackground(api.tracks);
        valid = downloaded.filter((t) => t.text && t.text.length > 20);
        if (valid.length > 0) {
          console.log(`[skilljar-extractor] Captions obtenidos vía background (${valid.length} track(s))`);
          return valid;
        }
      } else if (api && api.error) {
        console.log(`[skilljar-extractor] JW API no disponible: ${api.error}`);
      }
    }

    // Estrategia 2: leer directo del <video>.textTracks (cuando JW haya
    // poblado los cues internamente).
    let caps = await readJWCuesAsCaptions();
    if (caps.length > 0) {
      console.log(`[skilljar-extractor] Cues leídos desde textTracks (${caps.length} track(s))`);
      return caps;
    }

    // Si no hay cues aún, activar playback + subtítulos para que JW los cargue.
    await startJWPlayback();
    await activateJWCaptions();

    // Polling — hasta 8 segundos. Intenta textTracks primero (más rápido),
    // luego fetch-hook como último recurso.
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      caps = await readJWCuesAsCaptions();
      if (caps.length > 0) {
        console.log(`[skilljar-extractor] Cues detectados tras ${(i + 1) * 500}ms`);
        pauseJWPlayback();
        return caps;
      }
      if (typeof window.__skilljarGetJWCaptions === "function") {
        const fetched = await window.__skilljarGetJWCaptions(200);
        if (fetched.length > 0) {
          console.log(`[skilljar-extractor] VTT capturado vía fetch-hook tras ${(i + 1) * 500}ms`);
          pauseJWPlayback();
          return fetched;
        }
      }
    }
    pauseJWPlayback();
    return [];
  }

  function pauseJWPlayback() {
    const video = document.querySelector("video.jw-video, video");
    if (video && !video.paused) {
      try {
        video.pause();
      } catch {}
    }
  }

  // Inicia la reproducción del video. JW Player no descarga el VTT de
  // subtítulos hasta que empieza el playback, aunque ya se haya seleccionado
  // idioma. Mutea primero para que el usuario no escuche audio.
  async function startJWPlayback() {
    const video = document.querySelector("video.jw-video, video");
    if (video) {
      try {
        video.muted = true;
      } catch {}
      try {
        const p = video.play();
        if (p && typeof p.catch === "function") {
          // Si falla por autoplay policy, caemos al click del botón.
          await p.catch(() => {});
        }
        if (!video.paused) {
          console.log("[skilljar-extractor] Playback iniciado vía video.play()");
          return;
        }
      } catch {}
    }
    // Fallback: click sobre el botón de play del DOM.
    const playBtn = document.querySelector(
      ".jw-display-icon-display, .jw-icon-playback, button[aria-label*='play' i], button[aria-label*='reproducir' i]"
    );
    if (playBtn) {
      try {
        playBtn.click();
        console.log("[skilljar-extractor] Playback iniciado vía click en botón");
      } catch {}
    }
    // Pequeña espera para que el player reaccione.
    await new Promise((r) => setTimeout(r, 400));
  }

  // Intenta abrir el menú de subtítulos de JW Player y seleccionar un idioma.
  // JW no expone una API pública desde fuera del iframe, así que vamos por
  // simulación de clicks sobre el DOM del player.
  async function activateJWCaptions() {
    const preferredLangs = ["english", "spanish", "español", "inglés"];

    // Paso 1: abrir el menú de settings. Puede ser el icono de engranaje
    // (.jw-icon-settings) o directamente el icono CC.
    const openers = [
      ".jw-settings-captions",
      ".jw-icon-cc",
      "button[aria-label*='caption' i]",
      "button[aria-label*='subtítulo' i]",
      "button[aria-label*='subtitle' i]",
      ".jw-icon-settings",
    ];

    let opened = false;
    for (const sel of openers) {
      const el = document.querySelector(sel);
      if (el) {
        try {
          el.click();
          opened = true;
          console.log(`[skilljar-extractor] Menú abierto con ${sel}`);
          break;
        } catch {}
      }
    }
    if (!opened) {
      console.warn("[skilljar-extractor] No se encontró ningún botón para abrir el menú de CC");
      return;
    }

    // Paso 2: esperar a que aparezca el submenu y clickear un idioma.
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((r) => setTimeout(r, 300));

      // Los items del menú pueden ser botones, divs con role=button, o
      // elementos con clase .jw-submenu-item. Barrer varios selectores.
      const items = [
        ...document.querySelectorAll(
          ".jw-submenu-item, .jw-reset-text[role='menuitemradio'], .jw-submenu-topic button, .jw-submenu-captions button, button.jw-reset"
        ),
      ].filter((e) => visible(e));

      if (items.length === 0) continue;

      // Buscar por texto un idioma preferido
      let chosen = null;
      for (const lang of preferredLangs) {
        chosen = items.find((el) =>
          (el.textContent || "").trim().toLowerCase().includes(lang)
        );
        if (chosen) break;
      }
      // Fallback: primer item que no sea "Off"/"Desactivado"
      if (!chosen) {
        chosen = items.find((el) => {
          const t = (el.textContent || "").trim().toLowerCase();
          return t && !/^(off|desactivad|apagad|ninguno|none)/i.test(t);
        });
      }
      if (chosen) {
        try {
          chosen.click();
          console.log(`[skilljar-extractor] Subtítulo seleccionado: "${chosen.textContent.trim()}"`);
          return;
        } catch {}
      }
    }
    console.warn("[skilljar-extractor] No se pudo seleccionar idioma en el submenu");
  }

  // ---------- Transcripciones de Wistia (legacy, por si acaso) ----------
  async function requestWistiaTranscripts(wistiaFrames) {
    return new Promise((resolve) => {
      if (wistiaFrames.length === 0) return resolve([]);
      const results = new Array(wistiaFrames.length).fill(null);
      let received = 0;
      const timeout = setTimeout(() => resolve(results), 4000);
      const onMessage = (ev) => {
        const data = ev.data;
        if (!data || data.__skilljarExtractor !== "wistia-transcript") return;
        const idx = wistiaFrames.findIndex(
          (f) => f.contentWindow === ev.source
        );
        if (idx !== -1 && results[idx] === null) {
          results[idx] = data.payload;
          received++;
          if (received === wistiaFrames.length) {
            clearTimeout(timeout);
            window.removeEventListener("message", onMessage);
            resolve(results);
          }
        }
      };
      window.addEventListener("message", onMessage);
      wistiaFrames.forEach((f) => {
        try {
          f.contentWindow.postMessage(
            { __skilljarExtractor: "get-transcript" },
            "*"
          );
        } catch {}
      });
    });
  }

  // ---------- Ensamblaje final ----------
  async function extractAll() {
    const meta = extractMetadata();
    const body = extractLessonBody();
    const { youtube, wistia, others } = await findVideos();

    console.log("[skilljar-extractor] Videos detectados:", {
      youtube: youtube.map((v) => v.videoId),
      wistiaCount: wistia.length,
      others: others.length,
    });
    // IMPORTANTE: loguear TODOS los iframes para identificar proveedores desconocidos
    if (others.length > 0) {
      console.warn(
        "[skilljar-extractor] Iframes NO identificados (posibles videos de otro proveedor):",
        others
      );
    }
    // Loguear también TODOS los iframes crudos de la página por si el src está vacío
    // o la detección inicial falló
    console.log(
      "[skilljar-extractor] Todos los iframes de la página:",
      [...document.querySelectorAll("iframe")].map((f) => ({
        src: f.src,
        dataSrc: f.getAttribute("data-src"),
        title: f.title,
        id: f.id,
        cls: f.className,
      }))
    );

    const [ytBridge, wistiaResults, jwCaptions] = await Promise.all([
      requestYouTubeTranscripts(youtube),
      requestWistiaTranscripts(wistia),
      collectJWCaptions(),
    ]);
    const ytResults = ytBridge.results;
    const ytBridgeError = ytBridge.bridgeError;

    // Armar markdown
    let out = "";
    if (meta.courseTitle) out += `**Curso:** ${meta.courseTitle}\n`;
    if (meta.lessonTitle) out += `**Lección:** ${meta.lessonTitle}\n`;
    out += `**URL:** ${meta.url}\n\n---\n\n`;

    if (body && body.length > 20) {
      out += `## Contenido de la lección\n\n${body}\n\n`;
    }

    // Transcripciones de YouTube
    const ytOk = ytResults.filter((r) => r && r.ok);
    if (ytOk.length > 0) {
      out += `\n---\n\n## Transcripción${ytOk.length > 1 ? "es" : ""} del video (YouTube)\n\n`;
      ytOk.forEach((r, i) => {
        const label = ytOk.length > 1 ? `### Video ${i + 1}\n\n` : "";
        const kindLabel =
          r.kind === "auto-generated"
            ? "_(transcripción auto-generada)_\n\n"
            : "";
        out += `${label}${kindLabel}${r.transcript}\n\n`;
      });
    }

    // Errores o videos sin transcripción
    const ytFail = ytResults.filter((r) => r && !r.ok);
    if (ytFail.length > 0) {
      out += `\n> ⚠️ No se pudo obtener transcripción de ${ytFail.length} video(s) de YouTube. Motivos: ${ytFail.map((f) => f.error).join("; ")}\n\n`;
    }

    // Caso silencioso: detectamos videos pero no hubo ni éxito ni fallo reportado
    if (youtube.length > 0 && ytOk.length === 0 && ytFail.length === 0) {
      const reason = ytBridgeError
        ? `puente extensión⇄background falló: ${ytBridgeError}`
        : "el background no devolvió resultados (¿servidor local caído? ¿service worker dormido? Revisa la consola del service worker en chrome://extensions)";
      out += `\n> ⚠️ Se detectaron ${youtube.length} video(s) de YouTube pero no se obtuvo respuesta del background. Causa: ${reason}\n\n`;
    }

    // JW Player (video nativo con captions VTT)
    const jwPlainTexts = (jwCaptions || [])
      .map((c) => vttToPlainText(c.text))
      .filter((t) => t && t.length > 20);
    if (jwPlainTexts.length > 0) {
      out += `\n---\n\n## Transcripción${jwPlainTexts.length > 1 ? "es" : ""} del video (JW Player)\n\n`;
      jwPlainTexts.forEach((t, i) => {
        const label = jwPlainTexts.length > 1 ? `### Video ${i + 1}\n\n` : "";
        out += `${label}${t}\n\n`;
      });
    } else if (hasJWPlayer()) {
      out += `\n> ⚠️ Se detectó un video de JW Player pero no se capturaron subtítulos. Activa CC manualmente en el reproductor, espera a que carguen los subtítulos, y reintenta la extracción.\n\n`;
    }

    // Wistia (si aplica)
    const wistiaOk = (wistiaResults || []).filter(
      (t) => t && t.transcript && t.transcript.length > 20
    );
    if (wistiaOk.length > 0) {
      out += `\n---\n\n## Transcripción${wistiaOk.length > 1 ? "es" : ""} del video (Wistia)\n\n`;
      wistiaOk.forEach((t, i) => {
        out += `### Video ${i + 1}${t.name ? `: ${t.name}` : ""}\n\n${t.transcript}\n\n`;
      });
    }

    return {
      meta,
      markdown: out,
      stats: {
        bodyChars: body.length,
        youtubeDetected: youtube.length,
        youtubeExtracted: ytOk.length,
        wistiaDetected: wistia.length,
        wistiaExtracted: wistiaOk.length,
        jwPlayerDetected: hasJWPlayer() ? 1 : 0,
        jwCaptionsExtracted: jwPlainTexts.length,
      },
      debug: {
        otherIframes: others,
        ytErrors: ytFail,
      },
    };
  }

  // ---------- Listener del popup ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "EXTRACT_LESSON") {
      extractAll()
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message, markdown: "" }));
      return true;
    }
  });
})();
