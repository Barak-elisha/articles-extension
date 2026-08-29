function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = String(html || "");
  return (div.textContent || "").trim();
}

function buildApaCitation(a) {
  const title = (a.title || "(ללא כותרת)").trim();
  let site = "";
  try {
    site = new URL(a.url || "").hostname.replace(/^www\./, "");
  } catch (e) {}
  const d = a.savedAt ? new Date(a.savedAt) : null;
  const dateStr = d
    ? d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const hasDate = d ? " (" + dateStr + ")." : "";
  const sitePart = site ? " " + site + "." : "";
  const urlPart = a.url ? " " + a.url : "";
  return (title + hasDate + sitePart + urlPart).trim();
}

function styleSheet(ws) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const maxR = range.e.r;
  const maxC = range.e.c;
  const headerStyle = {
    font: { bold: true },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
  };
  const bodyStyle = { alignment: { wrapText: true, vertical: "top" } };
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
    widths.push(Math.max(10, Math.min(50, maxLen + 2)));
  }
  ws["!cols"] = widths.map((wch) => ({ wch }));
}

const excelMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function escXml(s) {
  return String(s)
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
  lines.forEach((raw) => {
    if (raw.length > 0 && runs.length) runs.push({ text: "\n" });
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
      runs.push(Object.assign({}, style, r));
    });
  });
  return runs;
}

function runToXml(r) {
  let props = "";
  if (r.bold) props += "<b/>";
  if (r.italic) props += "<i/>";
  if (r.underline) props += "<u/>";
  if (r.size) props += '<sz val="' + r.size + '"/>';
  if (r.color) props += '<color rgb="' + r.color + '"/>';
  if (!props) props = '<sz val="11"/>';
  return "<r><rPr>" + props + '<rFont val="Calibri"/></rPr><t xml:space="preserve">' + escXml(r.text) + "</t></r>";
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
  const wrap = document.createElement("div");
  wrap.innerHTML = String(html || "");
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
  walk(wrap, {}, null);
  return runs;
}

const unescapeXml = (s) =>
  s.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// Rewrites the given columns of every worksheet as rich-text inline strings.
async function applyRichText(zip, columns) {
  const sheetPaths = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
  for (const p of sheetPaths) {
    let xml = await zip.file(p).async("string");
    for (const spec of columns) {
      const colLetter = spec.col;
      const cellRe = new RegExp('<c r="' + colLetter + '(\\d+)"[^>]*>[\\s\\S]*?</c>', "g");
      xml = xml.replace(cellRe, (full, rowStr) => {
        const row = parseInt(rowStr, 10);
        if (row <= 1) return full;
        const val = (full.match(/<v[^>]*>([\s\S]*?)<\/v>/) || [])[1] || "";
        const runs = spec.type === "html" ? htmlToRuns(unescapeXml(val)) : markdownToRuns(unescapeXml(val));
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

// Turns every value in the given URL column into a clickable cell hyperlink.
async function applyHyperlinks(zip, colLetter) {
  const sheetPaths = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
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
    xml = xml.replace("</worksheet>", "<hyperlinks>" + hyperlinks + "</hyperlinks></worksheet>");
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

async function enhanceWorkbook(arrayBuf, summaryCol, urlCol, notesCol) {
  if (!(arrayBuf && window.JSZip)) return arrayBuf;
  const zip = await window.JSZip.loadAsync(arrayBuf);
  const richCols = [];
  if (summaryCol) richCols.push({ col: summaryCol, type: "markdown" });
  if (notesCol) richCols.push({ col: notesCol, type: "html" });
  if (richCols.length) await applyRichText(zip, richCols);
  if (urlCol) await applyHyperlinks(zip, urlCol);
  return zip.generateAsync({ type: "uint8array", mimeType: excelMime });
}

async function buildExcelBlob(articles, lists) {
  const listName = {};
  lists.forEach((l) => { listName[l.id] = l.name; });

  const rows = articles
    .slice()
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))
    .map((a) => ({
      ["רשימה"]: listName[a.listId] || "ללא רשימה",
      ["כותרת"]: a.title || "",
      ["תקציר AI"]: a.summary || "",
      ["הערות"]: window.JSZip ? (a.notes || "") : stripHtml(a.notes),
      ["ציטוט APA"]: buildApaCitation(a),
      ["כתובת אתר"]: a.url || "",
      ["תאריך שמירה"]: a.savedAt ? new Date(a.savedAt).toLocaleString() : "",
    }));

  const wb = XLSX.utils.book_new();
  const allSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  styleSheet(allSheet);
  XLSX.utils.book_append_sheet(wb, allSheet, "כל המאמרים");

  // One sheet per list
  lists.forEach((list) => {
    const listRows = rows.filter((r) => r["רשימה"] === list.name);
    if (!listRows.length) return;
    const sheet = XLSX.utils.json_to_sheet(listRows);
    styleSheet(sheet);
    XLSX.utils.book_append_sheet(wb, sheet, String(list.name).slice(0, 30) || "רשימה");
  });

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const final = await enhanceWorkbook(out, XLSX.utils.encode_col(2), XLSX.utils.encode_col(5), XLSX.utils.encode_col(3));
  return new Blob([final], { type: excelMime });
}
