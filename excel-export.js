function stripHtml(html) {
  const div = document.createElement("template");
  div.innerHTML = sanitizeHtml(html);
  return (div.content.textContent || "").trim();
}

function _t(k) {
  return (window.I18N && window.I18N.t ? window.I18N.t(k) : k);
}

function buildApaCitation(a) {
  const title = (a.title || _t("noTitle")).trim();

  // Clean site name (hostname without www.)
  let siteName = "";
  try {
    if (a.url) {
      siteName = new URL(a.url).hostname.replace(/^www\./, "");
    }
  } catch (e) {}

  // Retrieval date (when the article was saved locally), styled per APA 7
  let retrievalStr = "";
  if (a.savedAt) {
    const d = new Date(a.savedAt);
    const dateFormatted = d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    retrievalStr = `Retrieved ${dateFormatted}, from `;
  }

  // APA 7 structure for a webpage without an explicit author:
  // Title. (n.d.). Site Name. Retrieved Month Day, Year, from URL
  const parts = [];

  if (title) parts.push(title.endsWith(".") ? title : title + ".");
  parts.push("(n.d.).");
  if (siteName) parts.push(siteName + ".");
  if (a.url) parts.push(`${retrievalStr}${a.url}`);

  return parts.join(" ");
}

// Build each message separately so first-line headings/lists retain their style,
// and speaker labels cannot be confused with text inside the conversation.
function chatToRuns(chat) {
  if (!Array.isArray(chat)) return [];
  const runs = [];
  chat.forEach((m, index) => {
    if (index) runs.push({ text: "\n\n" });
    const user = m.role === "user";
    runs.push({
      text: _t(user ? "chatPrefixUser" : "chatPrefixAi") + ":\n",
      bold: true,
      color: user ? "FF285DE5" : "FF485776",
    });
    const body = String(m.text || "").replace(/\r\n?/g, "\n").trim();
    runs.push(...markdownToRuns(body));
  });
  return runs;
}

function chatToText(chat) {
  return chatToRuns(chat).map(run => run.text).join("");
}

function styleSheet(ws) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const maxR = range.e.r;
  const maxC = range.e.c;
  const headerBorder = { style: "thin", color: { rgb: "FFCFE6D3" } };
  const headerStyle = {
    font: { name: "Calibri", sz: 12, bold: true, color: { rgb: "FF234D30" } },
    fill: { patternType: "solid", fgColor: { rgb: "FFE3F6E7" } },
    border: { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder },
    alignment: { horizontal: "left", vertical: "center", wrapText: true, indent: 4 },
  };
  const bodyStyle = { alignment: { wrapText: true, vertical: "top" } };
  const minimumWidths = [18, 24, 26, 21, 30, 28, 22, 26];
  const widths = [];
  for (let c = 0; c <= maxC; c++) {
    let maxLen = 0;
    for (let r = 0; r <= maxR; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      cell.s = r === 0 ? headerStyle : bodyStyle;
      const v = cell.w != null ? String(cell.w) : cell.v != null ? String(cell.v) : "";
      const lineMax = v.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
      maxLen = Math.max(maxLen, lineMax);
    }
    widths.push(Math.max(minimumWidths[c] || 18, Math.min(50, maxLen + 2)));
  }
  ws["!cols"] = widths.map((wch) => ({ wch }));
  ws["!rows"] = [{ hpt: 42 }];
}

const excelMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Strips characters that are invalid in XML 1.0 (control chars apart from \t \n \r,
// noncharacters, and lone surrogate halves).
function sanitizeXml(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|(?:(?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/g, "");
}

function escXml(s) {
  return sanitizeXml(String(s))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineRuns(seg) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\$([^$]+)\$|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(seg))) {
    if (m.index > last) parts.push({ text: seg.slice(last, m.index) });
    parts.push({
      text: m[1] || m[2] || m[3] || m[4],
      bold: !!m[1],
      italic: !!(m[2] || m[3]),
      mono: !!m[4],
    });
    last = m.index + m[0].length;
  }
  if (last < seg.length) parts.push({ text: seg.slice(last) });
  return parts;
}

function markdownToRuns(md) {
  const runs = [];
  const lines = String(md || "").split("\n");
  lines.forEach((raw, index) => {
    if (index) runs.push({ text: "\n" });
    const line = raw.trim();
    if (!line) return;
    let style = {};
    let content = line;
    if (/^#{1,4}\s/.test(line)) {
      const lvl = line.match(/^#+/)[0].length;
      style = { bold: true, size: lvl <= 2 ? 13 : 12 };
      content = line.replace(/^#+\s*/, "");
    } else if (/^---+\s*$/.test(line)) {
      runs.push({ text: "──────────────", color: "FFB0B7C3" });
      return;
    } else if (/^([*-])\s+/.test(line)) {
      content = "• " + line.replace(/^[*-]\s+/, "");
    } else if (/^\d+[.)]\s+/.test(line)) {
      content = "  " + line;
    }
    inlineRuns(content).forEach((r) => {
      runs.push(Object.assign({}, r, style));
    });
  });
  return runs;
}

function runToXml(r) {
  const props = ['<rFont val="Calibri"/>'];
  if (r.bold) props.push("<b/>");
  if (r.italic) props.push("<i/>");
  if (r.color) props.push('<color rgb="' + argb(r.color) + '"/>');
  if (r.size) props.push('<sz val="' + r.size + '"/>');
  if (r.underline || r.highlight) props.push("<u/>");
  if (props.length === 1) props.push('<sz val="11"/>');
  return "<r><rPr>" + props.join("") + "</rPr><t xml:space=\"preserve\">" + escXml(r.text) + "</t></r>";
}

// The schema requires an 8-digit ARGB value; colors arrive here as 6-digit RGB.
function argb(c) {
  const h = String(c).replace(/^#/, "").toUpperCase();
  return h.length === 8 ? h : "FF" + h;
}

function parseColor(c) {
  if (!c) return null;
  const s = String(c).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  const m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (m) return m.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  const names = { black: "000000", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", white: "FFFFFF", gray: "808080", orange: "FFA500", purple: "800080", cyan: "00FFFF", pink: "FFC0CB" };
  return names[s] || null;
}

// Converts rich-text notes HTML into Excel runs (bold/italic/underline, size, color).
function htmlToRuns(html) {
  const runs = [];
  const wrap = document.createElement("template");
  wrap.innerHTML = sanitizeHtml(html);
  const htmlSizeToPt = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
  const nl = () => { if (runs.length && runs[runs.length - 1].text !== "\n") runs.push({ text: "\n" }); };
  const walk = (node, style, list) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const t = child.nodeValue;
        if (t) runs.push(Object.assign({ text: t }, style));
        return;
      }
      if (child.nodeType !== 1) return;
      const el = child;
      const st = Object.assign({}, style);
      const tag = el.tagName.toLowerCase();
      if (tag === "b" || tag === "strong") st.bold = true;
      if (tag === "i" || tag === "em") st.italic = true;
      if (tag === "u") st.underline = true;
      if (tag === "font") {
        const c = parseColor(el.getAttribute("color"));
        if (c) st.color = c;
        const sz = el.getAttribute("size");
        if (sz) st.size = htmlSizeToPt[sz] || parseFloat(sz) || 11;
      }
      if (el.style) {
        const c = parseColor(el.style.color);
        if (c) st.color = c;
        if (el.style.backgroundColor) st.highlight = parseColor(el.style.backgroundColor);
        if (el.style.fontWeight === "700" || el.style.fontWeight === "bold") st.bold = true;
        if (el.style.fontStyle === "italic") st.italic = true;
        if (el.style.fontSize) {
          const m = String(el.style.fontSize).match(/([\d.]+)px|([\d.]+)pt/);
          if (m) st.size = m[1] ? Math.round(parseFloat(m[1]) * 0.75) : parseFloat(m[2]);
        }
      }
      if (tag === "br") { runs.push({ text: "\n" }); return; }
      if (tag === "li") {
        const prefix = list && list.type === "ordered" ? list.n++ + ". " : "• ";
        nl();
        runs.push(Object.assign({ text: prefix }, style));
        walk(el, st, list);
        return;
      }
      if (tag === "ul" || tag === "ol") {
        nl();
        walk(el, st, tag === "ol" ? { type: "ordered", n: 1 } : { type: "bullet", n: 1 });
        nl();
        return;
      }
      if (tag === "div" || tag === "p" || tag === "blockquote") {
        nl();
        if (tag === "blockquote") st.italic = true;
        walk(el, st, list);
        nl();
        return;
      }
      walk(el, st, list);
    });
  };
  walk(wrap.content, {}, null);
  return runs;
}

const unescapeXml = (s) =>
  s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Rewrites the given columns of every worksheet as rich-text inline strings.
async function applyRichText(zip, columns, sheetPaths) {
  for (const p of sheetPaths) {
    let xml = await zip.file(p).async("string");
    for (const spec of columns) {
      const colLetter = spec.col;
      const cellRe = new RegExp('<c r="' + colLetter + '(\\d+)"[^>]*>[\\s\\S]*?</c>', "g");
      xml = xml.replace(cellRe, (full, rowStr) => {
        const row = parseInt(rowStr, 10);
        if (row <= 1) return full;
        const val = (full.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1] || "";
        const runs = spec.type === "chat"
          ? chatToRuns(spec.sheets[p]?.[row - 2]?.chat)
          : spec.type === "summary" ? summaryToRuns(spec.sheets[p]?.[row - 2])
          : spec.type === "html" ? htmlToRuns(unescapeXml(val)) : markdownToRuns(unescapeXml(val));
        if (!runs.length) runs.push({ text: "" });
        const sMatch = full.match(/s="(\d+)"/);
        const sAttr = sMatch ? ' s="' + sMatch[1] + '"' : "";
        return '<c r="' + colLetter + rowStr + '"' + sAttr + ' t="inlineStr"><is>' + runs.map(runToXml).join("") + "</is></c>";
      });
    }
    zip.file(p, xml);
  }
}

const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const relUrlNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Small monochrome line icons, embedded as PNGs for consistent Excel rendering.
// Labels remain ordinary editable cells; no emoji font or remote image is needed.
const excelHeaderIcons = [
  '<path d="M3 6V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/><path d="M3 7h18"/>',
  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 12h8M8 16h6"/>',
  '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4M3 18v4M1 20h4"/>',
  '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M9 3v18M3 7h4M3 12h4M3 17h4M12 8h5M12 12h5M12 16h3"/>',
  '<path d="M10 5C5 5 3 8 3 13v5h6v-6H4M21 5c-5 0-7 3-7 8v5h6v-6h-5"/>',
  '<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 1) scale(.9)"/>',
  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18"/><rect x="8" y="14" width="4" height="3" rx=".5"/>',
  '<path d="M21 11a9 8 0 0 1-9 8 11 11 0 0 1-4-1l-5 3 1-6a8 8 0 0 1-1-4 9 8 0 0 1 18 0Z"/><path d="M8 11h.01M12 11h.01M16 11h.01" stroke-width="3"/>',
];

async function applyHeaderIcons(zip) {
  const pngs = await Promise.all(excelHeaderIcons.map(async (shape) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#278447" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + shape + '</svg>';
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 72;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/png").split(",")[1];
  }));
  pngs.forEach((png, i) => zip.file("xl/media/header-icon-" + i + ".png", png, { base64: true }));
  let types = await zip.file("[Content_Types].xml").async("string");
  if (!/Extension="png"/.test(types)) {
    types = types.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
  }
  const sheets = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  for (const [index, path] of sheets.entries()) {
    const drawingName = "header-icons-" + (index + 1) + ".xml";
    const anchors = pngs.map((_, col) => {
      const id = col + 1;
      return '<xdr:oneCellAnchor><xdr:from><xdr:col>' + col + '</xdr:col><xdr:colOff>95250</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>161925</xdr:rowOff></xdr:from>' +
        '<xdr:ext cx="209550" cy="209550"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + id + '" name="Header icon ' + id + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip r:embed="icon' + id + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
    }).join("");
    zip.file("xl/drawings/" + drawingName, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="' + relUrlNs + '">' + anchors + '</xdr:wsDr>');
    const relationships = pngs.map((_, i) => '<Relationship Id="icon' + (i + 1) + '" Type="' + relUrlNs + '/image" Target="../media/header-icon-' + i + '.png"/>').join("");
    zip.file("xl/drawings/_rels/" + drawingName + ".rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + relNs + '">' + relationships + '</Relationships>');
    let xml = await zip.file(path).async("string");
    if (!/xmlns:r=/.test(xml)) xml = xml.replace("<worksheet ", '<worksheet xmlns:r="' + relUrlNs + '" ');
    zip.file(path, xml.replace("</worksheet>", '<drawing r:id="headerIcons"/></worksheet>'));
    const relsPath = path.replace(/sheet(\d+)\.xml$/, "_rels/sheet$1.xml.rels");
    const existing = zip.file(relsPath);
    const rels = existing ? await existing.async("string") : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + relNs + '"></Relationships>';
    zip.file(relsPath, rels.replace("</Relationships>", '<Relationship Id="headerIcons" Type="' + relUrlNs + '/drawing" Target="../drawings/' + drawingName + '"/></Relationships>'));
    types = types.replace("</Types>", '<Override PartName="/xl/drawings/' + drawingName + '" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  }
  zip.file("[Content_Types].xml", types);
}

// Turns every value in the given URL column into a clickable cell hyperlink.
async function applyHyperlinks(zip, colLetter, sheetPaths) {
  for (const p of sheetPaths) {
    let xml = await zip.file(p).async("string");
    const refs = [];
    const cellRe = new RegExp('<c r="' + colLetter + '(\\d+)"[^>]*>[\\s\\S]*?</c>', "g");
    xml = xml.replace(cellRe, (full, rowStr) => {
      const row = parseInt(rowStr, 10);
      if (row <= 1) return full;
      const val = (full.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1];
      const url = val == null ? "" : unescapeXml(val).trim();
      if (!url) return full;
      refs.push({ ref: colLetter + rowStr, url });
      return full;
    });
    if (!refs.length) continue;
    if (!/xmlns:r=/.test(xml)) {
      xml = xml.replace("<worksheet ", '<worksheet xmlns:r="' + relUrlNs + '" ');
    }
    const hyperlinks = refs.map(({ ref, url }) => '<hyperlink ref="' + ref + '" r:id="' + ref + '_link"/>').join("");
    // <hyperlinks> must come before <ignoredErrors> (SheetJS emits ignoredErrors last).
    if (/<ignoredErrors/.test(xml)) {
      xml = xml.replace(/<ignoredErrors/, "<hyperlinks>" + hyperlinks + "</hyperlinks><ignoredErrors");
    } else {
      xml = xml.replace("</worksheet>", "<hyperlinks>" + hyperlinks + "</hyperlinks></worksheet>");
    }
    zip.file(p, xml);

    const relsPath = p.replace(/sheet(\d+)\.xml$/, "_rels/sheet$1.xml.rels");
    let rels = "";
    try { rels = await zip.file(relsPath).async("string"); } catch (e) {}
    const relsXml = refs.map(({ ref, url }) =>
      '<Relationship Id="' + ref + '_link" Type="' + relUrlNs + '/hyperlink" Target="' + escXml(url) + '" TargetMode="External"/>'
    ).join("");
    if (rels) {
      zip.file(relsPath, rels.replace("</Relationships>", relsXml + "</Relationships>"));
    } else {
      zip.file(relsPath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + relNs + '">' + relsXml + "</Relationships>");
    }
  }
}

async function enhanceWorkbook(arrayBuf, summaryCol, urlCol, notesCol, articleSheets) {
  if (!(arrayBuf && window.JSZip)) return arrayBuf;
  try {
    const zip = await window.JSZip.loadAsync(arrayBuf);
    const richCols = [];
    const sheetPaths = Object.keys(articleSheets);
    if (summaryCol) richCols.push({ col: summaryCol, type: "summary", sheets: articleSheets });
    if (notesCol) richCols.push({ col: notesCol, type: "html" });
    richCols.push({ col: "H", type: "chat", sheets: articleSheets });
    if (richCols.length) await applyRichText(zip, richCols, sheetPaths);
    if (urlCol) await applyHyperlinks(zip, urlCol, Object.keys(zip.files).filter(p => /^xl\/worksheets\/sheet\d+\.xml$/.test(p)));
    await applyHeaderIcons(zip);
    const bytes = await zip.generateAsync({ type: "uint8array", mimeType: excelMime });
    if (!(await isWellFormedWorkbook(bytes))) return arrayBuf;
    return bytes;
  } catch (e) {
    return arrayBuf;
  }
}

// Re-opens the produced package and verifies every XML part is well formed,
// and that run/worksheet element ordering follows the OOXML schema.
// If anything is broken, the raw (known-good) SheetJS output is returned instead.
async function isWellFormedWorkbook(bytes) {
  if (typeof window === "undefined" || !window.DOMParser) return true;
  try {
    const zip = await window.JSZip.loadAsync(bytes);
    const results = await Promise.all(
      Object.keys(zip.files)
        .filter((p) => /\.xml$|\.rels$/.test(p))
        .map(async (p) => {
          const xml = await zip.file(p).async("string");
          const doc = new window.DOMParser().parseFromString(xml, "application/xml");
          if (doc.querySelector("parsererror")) return false;
          if (/^xl\/worksheets\/.+\.xml$/.test(p) && hasSchemaOrderIssues(xml)) return false;
          return true;
        })
    );
    return results.every(Boolean);
  } catch (e) {
    return false;
  }
}

// Verifies <hyperlinks> precedes <ignoredErrors> and that <rPr> children respect
// the canonical CT_RPrElt sequence (rFont, b, i, color, sz, u, ...).
function hasSchemaOrderIssues(xml) {
  if (/<ignoredErrors/.test(xml)) {
    const hi = xml.indexOf("<hyperlinks");
    const gi = xml.indexOf("<ignoredErrors");
    if (hi !== -1 && hi > gi) return true;
  }
  const rPrOrder = ["rfont", "charset", "family", "b", "i", "strike", "outline", "shadow", "condense", "extend", "color", "sz", "u", "vertalign", "scheme"];
  const re = /<rPr>([\s\S]*?)<\/rPr>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tags = Array.from(m[1].matchAll(/<([a-zA-Z]+)[\s\/>]/g)).map((x) => x[1].toLowerCase());
    let prev = -1;
    for (const t of tags) {
      const idx = rPrOrder.indexOf(t);
      if (idx === -1) continue;
      if (idx < prev) return true;
      prev = idx;
    }
  }
  return false;
}

// Excel dates are numeric serials without a timezone. Keep the local wall-clock
// time shown in the extension, including the original time for sorting.
function savedOnCell(value) {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const localTime = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  return { t: "n", v: (localTime - Date.UTC(1899, 11, 30)) / 86400000, z: "dd/mm/yyyy hh:mm" };
}

function summaryToRuns(article) {
  if (!article) return [];
  return article.summaryHtml && article.summaryHtmlSource === article.summary
    ? htmlToRuns(article.summaryHtml) : markdownToRuns(article.summary);
}

function highlightedPassages(runs) {
  const passages = [];
  let current = null;
  for (const run of runs) {
    if (!run.highlight) { current = null; continue; }
    if (!current || current.color !== run.highlight) {
      current = { text: "", color: run.highlight };
      passages.push(current);
    }
    current.text += run.text;
  }
  return passages.filter(p => p.text.trim());
}

// Spreadsheet rich-text runs cannot have a background fill. Keep the marked
// ranges underlined in the main sheets and preserve each original color in an
// editable excerpt cell on the Highlights sheet (one passage per row).
function appendHighlights(wb, articles, rows, sheetName) {
  const entries = [];
  articles.forEach((article, index) => {
    for (const [column, runs] of [["C", summaryToRuns(article)], ["D", htmlToRuns(article.notes)]]) {
      highlightedPassages(runs).forEach(passage => {
        entries.push({ column, ...passage, row: {
          ...rows[index],
          [_t("excelSummary")]: column === "C" ? passage.text : "",
          [_t("excelNotes")]: column === "D" ? passage.text : "",
          [_t("excelChat")]: "",
        } });
      });
    }
  });
  if (!entries.length) return;
  const sheet = XLSX.utils.json_to_sheet(entries.map(e => e.row));
  styleSheet(sheet);
  entries.forEach((entry, index) => {
    const cell = sheet[entry.column + (index + 2)];
    const rgb = entry.color;
    const luminance = .2126 * parseInt(rgb.slice(0, 2), 16) + .7152 * parseInt(rgb.slice(2, 4), 16) + .0722 * parseInt(rgb.slice(4, 6), 16);
    cell.s = { ...cell.s,
      fill: { patternType: "solid", fgColor: { rgb: argb(rgb) } },
      font: { name: "Calibri", sz: 11, color: { rgb: luminance < 140 ? "FFFFFFFF" : "FF202733" } },
    };
    const lines = entry.text.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 45)), 0);
    sheet["!rows"][index + 1] = { hpt: Math.min(409, Math.max(30, lines * 16 + 10)) };
  });
  XLSX.utils.book_append_sheet(wb, sheet, sheetName(_t("excelHighlights")));
}

async function buildExcelBlob(articles, lists) {
  const listName = Object.create(null);
  lists.forEach((l) => { listName[l.id] = l.name; });

  const orderedArticles = articles.slice().sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  const rows = orderedArticles.map((a) => ({
      [_t("excelList")]: listName[a.listId] || _t("noList"),
      [_t("excelTitle")]: a.title || "",
      [_t("excelSummary")]: a.summary || "",
      [_t("excelNotes")]: window.JSZip ? sanitizeHtml(a.notes) : stripHtml(a.notes),
      [_t("excelCitation")]: buildApaCitation(a),
      [_t("excelUrl")]: a.url || "",
      [_t("excelSavedOn")]: savedOnCell(a.savedAt),
      [_t("excelChat")]: chatToText(a.chat),
    }));

  const wb = XLSX.utils.book_new();
  const allSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  styleSheet(allSheet);
  XLSX.utils.book_append_sheet(wb, allSheet, _t("excelAllArticles"));

  const articleSheets = { "xl/worksheets/sheet1.xml": orderedArticles };
  const usedNames = new Set(wb.SheetNames.map(name => name.toLowerCase()));
  const sheetName = (value) => {
    let base = String(value || _t("excelListFallback")).replace(/[\\/:?*\[\]\u0000-\u001f]/g, " ").trim().replace(/^'+|'+$/g, "").trim() || _t("excelListFallback");
    if (/^(?:__proto__|constructor|prototype|history)$/i.test(base)) base = "List " + base;
    let name = base.slice(0, 31).replace(/'+$/g, ""), counter = 2;
    while (usedNames.has(name.toLowerCase())) {
      const suffix = " (" + counter++ + ")";
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    usedNames.add(name.toLowerCase());
    return name;
  };
  // One sheet per list; IDs keep identically named lists separate.
  lists.forEach((list) => {
    const listRows = rows.filter((r, index) => orderedArticles[index].listId === list.id);
    if (!listRows.length) return;
    const sheet = XLSX.utils.json_to_sheet(listRows);
    styleSheet(sheet);
    XLSX.utils.book_append_sheet(wb, sheet, sheetName(list.name));
    articleSheets["xl/worksheets/sheet" + wb.SheetNames.length + ".xml"] =
      orderedArticles.filter(a => a.listId === list.id);
  });

  appendHighlights(wb, orderedArticles, rows, sheetName);

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const final = await enhanceWorkbook(out, XLSX.utils.encode_col(2), XLSX.utils.encode_col(5), XLSX.utils.encode_col(3), articleSheets);
  return new Blob([final], { type: excelMime });
}
