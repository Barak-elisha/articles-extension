function buildExcelBlob(articles, lists) {
  const XLSX = window.XLSX;
  const listName = {};
  lists.forEach((l) => { listName[l.id] = l.name; });

  const rows = articles
    .slice()
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0))
    .map((a) => ({
      ["רשימה"]: listName[a.listId] || "ללא רשימה",
      ["כותרת"]: a.title || "",
      ["תקציר AI"]: a.summary || "",
      ["כתובת אתר"]: a.url || "",
      ["תאריך שמירה"]: a.savedAt ? new Date(a.savedAt).toLocaleString() : "",
      ["גוף המאמר"]: a.content || "",
    }));

  const wb = XLSX.utils.book_new();
  const allSheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  XLSX.utils.book_append_sheet(wb, allSheet, "כל המאמרים");

  // One sheet per list
  lists.forEach((list) => {
    const listRows = rows.filter((r) => r["רשימה"] === list.name);
    if (!listRows.length) return;
    const sheet = XLSX.utils.json_to_sheet(listRows);
    XLSX.utils.book_append_sheet(wb, sheet, String(list.name).slice(0, 30) || "רשימה");
  });

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
