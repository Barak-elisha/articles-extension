function sanitizeFilename(name) {
  return (name || "article")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function generateArticlePdfBlob(article) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 15;
  const pageWidth = 210;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(article.title || "", maxWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 8 + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  if (article.url) {
    const urlLines = doc.splitTextToSize(article.url, maxWidth);
    doc.text(urlLines, margin, y);
    y += urlLines.length * 5;
  }
  const dateStr = article.savedAt ? new Date(article.savedAt).toLocaleString() : "";
  if (dateStr) {
    doc.text(dateStr, margin, y);
    y += 6;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  if (article.summary) {
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(11);
    const summaryLabel = "תקציר AI:";
    doc.text(summaryLabel, margin, y);
    y += 6;

    doc.setFont("helvetica", "italic");
    const summaryLines = doc.splitTextToSize(article.summary, maxWidth);
    for (let i = 0; i < summaryLines.length; i++) {
      if (y + 5 > pageHeight) { doc.addPage(); y = margin; }
      doc.text(summaryLines[i], margin, y);
      y += 5;
    }
    y += 6;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;
  }

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(11);
  const body = article.content || "";
  const bodyLines = doc.splitTextToSize(body, maxWidth);
  let pageHeight = 297 - margin;
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const lineHeight = 5;
    if (y + lineHeight > pageHeight) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  return doc.output("blob");
}
