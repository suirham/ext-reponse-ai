// content.js — Tooltip ultra-discret, ALT obligatoire, anti-multi (no iframes)

// Empêche les iframes de créer leur propre tooltip
if (window.top !== window) {
  // On garde quand même la capacité d'extraction si jamais tu veux,
  // mais pour éviter les tooltips multiples, on stoppe tout le reste.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "QAIA_EXTRACT") {
      const text = (document.body?.innerText || "").trim();
      sendResponse({ text, url: location.href, title: document.title });
      return true;
    }
  });
} else {

  // ==========================
  // Réglages
  // ==========================
  const HOVER_DELAY_MS = 520;
  const MIN_SCORE = 26;
  const OFFSET_X = 10;
  const OFFSET_Y = 14;

  // ==========================
  // Extraction texte page
  // ==========================
  function getMainText() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
    clone.querySelectorAll("nav, footer, header, aside").forEach((el) => el.remove());
    const text = clone.innerText || "";
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  // ==========================
  // Tooltip ghost UI (unique)
  // ==========================
  let tooltipEl = null;
  let lastMouse = { x: 0, y: 0 };
  let qaPairs = []; // [{question, answer, evidence?}]

  function ensureTooltip() {
    // Si un tooltip existe déjà (injection multiple), on le réutilise
    let existing = document.getElementById("qaia-tooltip");
    if (existing) {
      tooltipEl = existing;
      return tooltipEl;
    }

    tooltipEl = document.createElement("div");
    tooltipEl.id = "qaia-tooltip";
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(text) {
    if (!text) return hideTooltip();
    const el = ensureTooltip();
    el.textContent = text;

    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    el.classList.add("qaia-show");
    el.style.left = "0px";
    el.style.top = "0px";

    const rect = el.getBoundingClientRect();

    let x = lastMouse.x + OFFSET_X;
    let y = lastMouse.y + OFFSET_Y;

    if (x + rect.width + pad > vw) x = vw - rect.width - pad;
    if (y + rect.height + pad > vh) y = vh - rect.height - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function hideTooltip() {
    const el = document.getElementById("qaia-tooltip");
    if (!el) return;
    el.classList.remove("qaia-show");
  }

  // Souris
  document.addEventListener(
    "mousemove",
    (e) => {
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
    },
    { passive: true }
  );

  // ==========================
  // Matching (sélectif)
  // ==========================
  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[“”"’'`]/g, "")
      .trim();
  }

  function pickBestAnswerFromText(haystackText) {
    if (!qaPairs.length) return null;

    const h = normalize(haystackText);
    if (!h || h.length < 6) return null;

    let best = null;
    let bestScore = 0;

    for (const qa of qaPairs) {
      const q = normalize(qa.question);
      if (!q) continue;

      let score = 0;
      if (h.includes(q)) score = q.length;
      else if (q.includes(h)) score = h.length * 0.7;

      if (q.endsWith("?")) score *= 1.05;

      if (score > bestScore) {
        bestScore = score;
        best = qa;
      }
    }

    if (bestScore < MIN_SCORE) return null;
    return best;
  }

  function getHoverText(target) {
    if (!target) return "";

    // Si tu veux limiter STRICTEMENT aux liens, dé-commente le bloc ci-dessous :
    /*
    const aOnly = target.closest?.("a");
    if (!aOnly) return "";
    return aOnly.getAttribute("aria-label") || aOnly.title || aOnly.innerText || "";
    */

    // Mode mixte (liens prioritaires)
    const a = target.closest?.("a");
    if (a) return a.getAttribute("aria-label") || a.title || a.innerText || "";

    return target.innerText || target.textContent || "";
  }

  // ==========================
  // Hover logic (ALT via event.altKey — fiable)
  // ==========================
  let hoverTimer = null;
  let currentTarget = null;
  let lastAltKey = false;

  function scheduleHoverCheck(altKey) {
    if (hoverTimer) clearTimeout(hoverTimer);

    // ALT obligatoire : si pas ALT -> on cache et on sort
    if (!altKey) {
      hideTooltip();
      return;
    }

    hoverTimer = setTimeout(() => {
      // ALT obligatoire au moment du déclenchement aussi (on relit lastAltKey)
      if (!lastAltKey) return hideTooltip();

      const t = currentTarget;
      if (!t) return;

      const text = getHoverText(t);
      const best = pickBestAnswerFromText(text);

      if (best?.answer) showTooltip(best.answer);
      else hideTooltip();
    }, HOVER_DELAY_MS);
  }

  document.addEventListener(
    "mouseover",
    (e) => {
      currentTarget = e.target;
      lastAltKey = !!e.altKey;
      scheduleHoverCheck(lastAltKey);
    },
    { passive: true }
  );

  document.addEventListener(
    "mousemove",
    (e) => {
      // Si l'utilisateur relâche ALT pendant qu'il survole, on cache immédiatement
      if (lastAltKey && !e.altKey) {
        lastAltKey = false;
        if (hoverTimer) clearTimeout(hoverTimer);
        hideTooltip();
        return;
      }
      // Si l'utilisateur appuie ALT pendant qu'il est déjà sur un élément,
      // on peut (re)programmer discrètement
      if (!lastAltKey && e.altKey) {
        lastAltKey = true;
        scheduleHoverCheck(true);
      }
    },
    { passive: true }
  );

  document.addEventListener(
    "mouseout",
    () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hideTooltip();
    },
    { passive: true }
  );

  window.addEventListener("blur", () => {
    lastAltKey = false;
    if (hoverTimer) clearTimeout(hoverTimer);
    hideTooltip();
  });

  // ==========================
  // Messages service worker
  // ==========================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "QAIA_EXTRACT") {
      const text = getMainText();
      sendResponse({
        text,
        url: location.href,
        title: document.title
      });
      return true;
    }

    if (msg?.type === "QAIA_RENDER") {
      qaPairs = Array.isArray(msg.answers) ? msg.answers : [];
      hideTooltip();
      return;
    }

    if (msg?.type === "QAIA_ERROR") {
      // Ultra-discret : console only
      console.warn("QAIA_ERROR:", msg.error);
      hideTooltip();
      return;
    }
  });
}
