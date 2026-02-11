// service_worker.js (Manifest V3)

// ==========================
// CONFIG
// ==========================

import { OPENAI_API_KEY } from "./config.js";

const OPENAI_MODEL = "gpt-4o";    // change si besoin
const COMMAND_ANALYZE = "analyze-page";

// ==========================
// Command handler
// ==========================
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== COMMAND_ANALYZE) return;

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Onglet actif introuvable.");

    if (!isInjectableUrl(tab.url)) {
      throw new Error(
        `Page non compatible (${tab.url}). Teste sur une page https:// normale.`
      );
    }

    // 1) Extraction texte (depuis content.js)
    const extracted = await sendMessageSafe(tab.id, {
      type: "QAIA_EXTRACT"
    });

    const { text, url, title } = extracted || {};
    if (!text || !text.trim()) throw new Error("Impossible d'extraire le texte de la page.");

    const page = { title: title || "", url: url || tab.url || "", text };

    // 2) L'IA extrait les questions réellement présentes
    await sendMessageSafe(tab.id, {
      type: "QAIA_RENDER",
      answers: [{ question: "Analyse", answer: "Détection des questions dans la page…" }]
    });

    const questions = await extractQuestionsWithOpenAI({ page });

    if (!questions.length) {
      await sendMessageSafe(tab.id, {
        type: "QAIA_RENDER",
        answers: [{
          question: "Aucune question détectée",
          answer: "Je n’ai trouvé aucune question explicite dans le contenu de cette page."
        }]
      });
      return;
    }

    // 3) L'IA répond + preuves
    await sendMessageSafe(tab.id, {
      type: "QAIA_RENDER",
      answers: [{ question: "Analyse", answer: `Questions trouvées: ${questions.length}. Réponse en cours…` }]
    });

    const answers = await answerQuestionsWithOpenAI({ page, questions });

    // 4) Rendu final
    await sendMessageSafe(tab.id, { type: "QAIA_RENDER", answers });

  } catch (err) {
    const msg = err?.message || String(err);
    console.error("QAIA error:", err);

    try {
      if (!tab) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        tab = tabs?.[0];
      }
      if (tab?.id && isInjectableUrl(tab.url)) {
        await sendMessageSafe(tab.id, { type: "QAIA_ERROR", error: msg });
      }
    } catch (_) {
      // ignore
    }
  }
});

// ==========================
// Injection / messaging
// ==========================
function isInjectableUrl(url) {
  if (!url) return false;
  if (url.startsWith("chrome://")) return false;
  if (url.startsWith("chrome-extension://")) return false;
  if (url.startsWith("edge://")) return false;
  if (url.startsWith("about:")) return false;
  if (url.startsWith("view-source:")) return false;
  if (url.includes("chrome.google.com/webstore")) return false;
  // file:// possible mais nécessite l'option "Autoriser l’accès aux URL de fichier"
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://");
}

async function ensureContentScript(tabId) {
  // CSS d'abord (pas bloquant si déjà injecté)
  await chrome.scripting.insertCSS({
  target: { tabId, frameIds: [0] },
  files: ["overlay.css"]
});

  // Puis content script
  await chrome.scripting.executeScript({
  target: { tabId, frameIds: [0] },
  files: ["content.js"]
});
}

async function sendMessageSafe(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e1) {
    // Souvent: "Receiving end does not exist." => content.js non présent
    try {
      await ensureContentScript(tabId);
    } catch (e2) {
      const reason = e2?.message || String(e2);
      throw new Error(
        `Impossible d'injecter content.js sur cette page.\n` +
        `Détails: ${reason}\n\n` +
        `Si c'est une page file://, active "Autoriser l’accès aux URL de fichier" ` +
        `dans chrome://extensions > ton extension.`
      );
    }
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

// ==========================
// OpenAI - step 1: extract questions
// ==========================
async function extractQuestionsWithOpenAI({ page }) {
  const clipped = clipText(page.text, 70_000);

  const prompt = `
Tu dois EXTRAIRE les questions réellement présentes dans le contenu ci-dessous.
N'invente rien. Si une question est implicite mais non formulée, ne l'ajoute pas.
Garde seulement les questions utiles (FAQ, questions utilisateur, titres interrogatifs).
Limite à 12.

Retourne du JSON strict:
{
  "questions": ["...", "..."]
}

Contenu:
"""${clipped}"""
`.trim();

  const data = await callOpenAI(prompt);

  const out = extractTextFromResponses(data);
  const parsed = tryParseJson(out);

  const qs = Array.isArray(parsed?.questions) ? parsed.questions : [];
  return [...new Set(
    qs.map(q => String(q).trim()).filter(q => q.length >= 5 && q.length <= 250)
  )].slice(0, 12);
}

// ==========================
// OpenAI - step 2: answer questions with evidence
// ==========================
async function answerQuestionsWithOpenAI({ page, questions }) {
  const clipped = clipText(page.text, 70_000);

  const prompt = `
Tu dois répondre de manière ULTRA DIRECTE.

Règles STRICTES :
- Maximum 1 phrase.
- Pas d’introduction.
- Pas de reformulation de la question.
- Pas de contexte.
- Pas de justification.
- Pas de citations dans la réponse.
- Réponse factuelle, brute, compacte.

Si la réponse n’est pas trouvable dans le texte :
"Non présent dans la page."

Retourne JSON strict :

{
  "answers": [
    {
      "question": "...",
      "answer": "...",
      "evidence": []
    }
  ]
}

Contenu:
"""${clipped}"""

Questions:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
`;

  const data = await callOpenAI(prompt);

  const out = extractTextFromResponses(data);
  const parsed = tryParseJson(out);

  const answers = Array.isArray(parsed?.answers) ? parsed.answers : null;

  if (!answers) {
    // fallback texte brut
    return questions.map(q => ({
      question: q,
      answer: out || "Pas de sortie exploitable.",
      evidence: []
    }));
  }

  // Normalisation
  return answers.map(a => ({
    question: String(a.question ?? ""),
    answer: String(a.answer ?? ""),
    evidence: Array.isArray(a.evidence) ? a.evidence.map(x => String(x)) : []
  }));
}

// ==========================
// OpenAI call helper (Responses API)
// ==========================
async function callOpenAI(prompt) {
  if (!OPENAI_API_KEY || !OPENAI_API_KEY.startsWith("sk-")) {
    throw new Error("Clé API OpenAI manquante ou invalide (OPENAI_API_KEY).");
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt
    })
  });

  if (!res.ok) {
    const t = await safeReadText(res);
    throw new Error(`OpenAI API error (${res.status}): ${t}`);
  }

  return await res.json();
}

// ==========================
// Utils
// ==========================
function clipText(text, maxChars) {
  if (!text) return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function extractTextFromResponses(data) {
  // Most common convenience field
  if (typeof data?.output_text === "string") return data.output_text;

  const out = data?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") return c.text;
        }
      }
    }
  }
  return "";
}

function tryParseJson(s) {
  if (!s) return null;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
