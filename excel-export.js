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

function buildExcelBlob(articles, lists) {
  const listName = {};
  lists.forEach((l) => { listName[l.id] = l.name; });

  const rows = articles
    .slice()
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))
    .map((a) => ({
      ["רשימה"]: listName[a.listId] || "ללא רשימה",
      ["כותרת"]: a.title || "",
      ["תקציר AI"]: a.summary || "",
      ["הערות"]: stripHtml(a.notes),
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
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
