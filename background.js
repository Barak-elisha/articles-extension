chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "EXTRACT_ARTICLE") {
    extractActiveTab()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }
  if (msg && msg.type === "GENERATE_SUMMARY") {
    generateSummary(msg.apiKey, msg.content, msg.title, msg.model)
      .then((data) => sendResponse({ ok: true, summary: data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }
});

async function generateSummary(apiKey, content, title, model) {
  if (!apiKey) throw new Error("לא הוזן API key");
  const m = model || "gemini-2.0-flash";
  const prompt =
    "כתוב תקציר מקיף ואובייקטיבי של המאמר הבא בעברית, המסכם את עיקרי הדברים בצורה מפורטת.\n\n" +
    (title ? "כותרת המאמר: " + title + "\n\n" : "") +
    "גוף המאמר:\n" + content.slice(0, 12000);

  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(m) +
      ":generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    }
  );

  if (!resp.ok) {
    let detail = "HTTP " + resp.status;
    try {
      const j = await resp.json();
      if (j && j.error && j.error.message) detail = j.error.message;
    } catch (e) {}
    throw new Error("שגיאה מ-Google AI: " + detail);
  }

  const json = await resp.json();
  const parts =
    (json.candidates &&
      json.candidates[0] &&
      json.candidates[0].content &&
      json.candidates[0].content.parts) ||
    [];
  const text = parts.map((p) => p.text || "").join("");
  if (!text) throw new Error("המודל לא החזיר תקציר");
  return text.trim();
}

async function extractActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error("לא נמצא Tab פעיל");
  if (!/^https?:/.test(tab.url || "")) throw new Error("הדף אינו נגיש (אין כתובת HTTP/HTTPS)");

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractFromPage,
  });

  const value = result && result[0] && result[0].result;
  if (!value) throw new Error("לא ניתן היה לחלץ את המאמר");
  return value;
}

// Runs inside the page context (serialized into the tab).
function extractFromPage() {
  function getTitle() {
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content && og.content.trim()) return og.content.trim();
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return document.title ? document.title.trim() : "";
  }

  function pickMain() {
    const article = document.querySelector("article");
    const main = document.querySelector("main");
    const content = document.getElementById("content");
    const candidates = [article, main, content, document.body, document.documentElement];
    for (const el of candidates) {
      if (el && el.textContent.trim().length > 50) return el;
    }
    return document.body || document.documentElement;
  }

  function extractText(root) {
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll("script,style,noscript,iframe,nav,header,footer,form,aside")
      .forEach((n) => n.remove());
    const text = clone.innerText || clone.textContent || "";
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  let content = "";
  try {
    content = extractText(pickMain());
  } catch (e) {
    content = (document.body ? document.body.innerText : "") || "";
  }

  return {
    title: getTitle(),
    content: content,
    url: window.location.href,
  };
}
