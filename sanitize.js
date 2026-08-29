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
    "*": ["class", "dir", "lang", "title", "style", "align"],
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
    // Keep only text-affecting, non-URL declarations.
    const out = [];
    style.split(";").forEach((decl) => {
      const idx = decl.indexOf(":");
      if (idx <= 0) return;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      if (/expression|url\(|javascript:/i.test(val)) return;
      if (/^(background|background-image|cursor|behavior|content)$/.test(prop)) return;
      out.push(prop + ": " + val);
    });
    return out.join("; ");
  }

  function sanitizeHtml(input) {
    const html = String(input == null ? "" : input);
    if (!html) return "";
    const template = document.createElement("div");
    template.innerHTML = html;
    return cleanNode(template);
  }

  function cleanNode(node) {
    const safe = document.createElement("span");
    // Clean in place, returning a sanitized clone.
    cleanChildren(node, safe);
    return safe.innerHTML;
  }

  function cleanChildren(node, out) {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        // Text is safe.
        out.appendChild(document.createTextNode(child.nodeValue));
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toUpperCase();
      const isAllowed = tag in ALLOWED_TAGS;

      if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED" || tag === "LINK" || tag === "META" || tag === "BASE" || tag === "FORM" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") {
        // Dangerous: drop entirely (including content for script/style).
        if (tag === "SCRIPT" || tag === "STYLE") return;
        // For other dangerous tags keep only the text content.
        out.appendChild(document.createTextNode(child.textContent || ""));
        return;
      }

      if (!isAllowed) {
        // Unknown tag: keep text content, recurse to strip nested danger.
        cleanChildren(child, out);
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
        if (!el.getAttribute("target")) el.setAttribute("target", "_blank");
      }
      cleanChildren(child, el);
      out.appendChild(el);
    });
  }

  window.sanitizeHtml = sanitizeHtml;
})();
