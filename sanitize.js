(function () {
  // Allowed tags, mapped to true. Everything else is dropped (its text is kept).
  const ALLOWED_TAGS = {
    B: true, STRONG: true, I: true, EM: true, U: true, S: true, STRIKE: true,
    FONT: true, SPAN: true, DIV: true, P: true, BR: true,
    UL: true, OL: true, LI: true, BLOCKQUOTE: true, PRE: true, CODE: true,
    H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
    A: true, TABLE: true, THEAD: true, TBODY: true, TR: true, TH: true, TD: true,
  };

  // Attributes kept per tag. "*" applies to every allowed tag.
  const ALLOWED_ATTRS = {
    "*": ["dir", "lang", "title", "style", "align"],
    A: ["href", "target", "rel"],
    FONT: ["color", "size", "face"],
    OL: ["start", "type"],
    LI: ["value"],
  };

  const ATTR_ALLOW = {};
  for (const k in ALLOWED_ATTRS) ATTR_ALLOW[k] = {};
  ALLOWED_ATTRS["*"].forEach((a) => { ATTR_ALLOW["*"][a.toLowerCase()] = true; });
  Object.keys(ALLOWED_ATTRS).forEach((tag) => {
    if (tag === "*") return;
    ALLOWED_ATTRS[tag].forEach((a) => { ATTR_ALLOW[tag][a.toLowerCase()] = true; });
  });

  function attrAllowed(tag, name) {
    const byTag = ATTR_ALLOW[tag] && ATTR_ALLOW[tag][name];
    const global = ATTR_ALLOW["*"] && ATTR_ALLOW["*"][name];
    return !!(byTag || global);
  }

  function safeUrl(value) {
    if (typeof value !== "string") return null;
    const v = value.trim();
    if (!v || /^[\u0000-\u001f]/.test(v)) return null;
    const c = v.replace(/[\u0000-\u0020"'`<>]/g, "");
    if (/^(javascript|vbscript|data|file):/i.test(c)) return null;
    if (/^[\w+.-]+:/i.test(c) && !/^(https?|ftp|mailto):/i.test(c)) return null;
    return v;
  }

  function safeStyle(style) {
    if (typeof style !== "string") return "";
    // Only formatting used by the article/notes editors may cross this boundary.
    const allowed = new Set(["color", "background-color", "font-size", "font-weight",
      "font-style", "text-decoration", "text-align", "vertical-align", "white-space"]);
    const out = document.createElement("span").style;
    style.split(";").forEach((decl) => {
      const idx = decl.indexOf(":");
      if (idx <= 0) return;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (!allowed.has(prop) || /[\\@{}]|url|expression|var\s*\(|env\s*\(|!important/i.test(val)) return;
      if (prop === "font-size" && !/^(?:[8-9]|[1-3]\d|4[0-8])(?:\.\d+)?(?:px|pt)$/.test(val)) return;
      out.setProperty(prop, val);
    });
    return out.cssText;
  }

  function escapeHtml(input) {
    return String(input == null ? "" : input).replace(/&/g, "&amp;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function articleContentToHtml(input, format) {
    const text = String(input == null ? "" : input);
    // Records without a format predate this boundary; retain their safe formatting.
    if (format === "html" || (!format && /<[a-z][\s\S]*>/i.test(text))) return sanitizeHtml(text);
    return escapeHtml(text).replace(/\n/g, "<br>\n");
  }

  function protectRichTextEditor(editor) {
    editor.addEventListener("paste", (event) => {
      event.preventDefault();
      if (editor.contentEditable !== "true") return;
      const data = event.clipboardData;
      const html = data && data.getData("text/html");
      const safe = html ? sanitizeHtml(html) : articleContentToHtml(data ? data.getData("text/plain") : "", "text");
      document.execCommand("insertHTML", false, safe);
    });
    // A dropped external HTML fragment would otherwise bypass the paste boundary.
    editor.addEventListener("drop", (event) => event.preventDefault());
  }

  function sanitizeHtml(input) {
    const html = String(input == null ? "" : input);
    if (!html) return "";
    const template = document.createElement("template");
    template.innerHTML = html;
    return cleanNode(template.content);
  }

  function cleanNode(node) {
    const safe = document.createElement("span");
    // Clean in place, returning a sanitized clone.
    cleanChildren(node, safe);
    return safe.innerHTML;
  }

  function cleanChildren(node, out, depth = 0) {
    if (depth > 100) { out.appendChild(document.createTextNode(node.textContent || "")); return; }
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        // Text is safe.
        out.appendChild(document.createTextNode(child.nodeValue));
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toUpperCase();
      const isAllowed = Object.hasOwn(ALLOWED_TAGS, tag);

      if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED" || tag === "LINK" || tag === "META" || tag === "BASE" || tag === "FORM" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") {
        // Dangerous: drop entirely (including content for script/style).
        if (tag === "SCRIPT" || tag === "STYLE") return;
        // For other dangerous tags keep only the text content.
        out.appendChild(document.createTextNode(child.textContent || ""));
        return;
      }

      if (!isAllowed) {
        // Unknown tag: keep text content, recurse to strip nested danger.
        cleanChildren(child, out, depth + 1);
        return;
      }

      const el = document.createElement(tag);
      [...child.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (!attrAllowed(tag, name) || /^on/i.test(name)) return;
        let value = attr.value;
        if (name === "style") value = safeStyle(value);
        if (name === "href" || name === "src") {
          const s = safeUrl(value);
          if (s == null) return;
          value = s;
        }
        el.setAttribute(attr.name, value);
      });
      // Anchor hardening: force rel/target.
      if (tag === "A") {
        el.setAttribute("rel", "noopener noreferrer");
        el.setAttribute("target", "_blank");
      }
      cleanChildren(child, el, depth + 1);
      out.appendChild(el);
    });
  }

  window.sanitizeHtml = sanitizeHtml;
  window.articleContentToHtml = articleContentToHtml;
  window.protectRichTextEditor = protectRichTextEditor;
})();
