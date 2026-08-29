(function () {
  let lists = [];
  let articles = [];
  let activeListId = null;
  let aiApiKey = "";
  let aiModel = "gemini-2.0-flash";

  const $ = (sel) => document.querySelector(sel);
  const listSelect = $("#listSelect");
  const saveBtn = $("#saveBtn");
  const saveStatus = $("#saveStatus");
  const listsContainer = $("#listsContainer");
  const newListName = $("#newListName");
  const addListBtn = $("#addListBtn");
  const exportBtn = $("#exportBtn");
  const chooseDirBtn = $("#chooseDirBtn");
  const clearDirBtn = $("#clearDirBtn");
  const dirStatus = $("#dirStatus");
  const detailView = $("#detailView");
  const detailBody = $("#detailBody");
  const backBtn = $("#backBtn");
  const apiKeyInput = $("#apiKeyInput");
  const modelInput = $("#modelInput");
  const saveApiBtn = $("#saveApiBtn");
  const aiToggle = $("#aiToggle");

  async function loadAll() {
    lists = await getLists();
    articles = await getArticles();
    const st = await getSetting("activeListId");
    const savedId = st ? st.value : null;
    if (savedId && lists.some((l) => l.id === savedId)) activeListId = savedId;
    else activeListId = lists.length ? lists[0].id : null;
    if (activeListId) await setSetting("activeListId", activeListId);
    await loadAiSettings();
    render();
    renderDirStatus();
  }

  async function loadAiSettings() {
    const key = await getSetting("geminiApiKey");
    aiApiKey = key ? key.value : "";
    const model = await getSetting("geminiModel");
    aiModel = model ? model.value || "gemini-2.0-flash" : "gemini-2.0-flash";
    apiKeyInput.value = aiApiKey;
    modelInput.value = aiModel;
  }

  function render() {
    renderListSelect();
    renderLists();
  }

  function renderListSelect() {
    listSelect.innerHTML = "";
    if (!lists.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "אין רשימות - צור ראשונה";
      listSelect.appendChild(opt);
      listSelect.disabled = true;
      return;
    }
    listSelect.disabled = false;
    lists.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.name;
      if (l.id === activeListId) opt.selected = true;
      listSelect.appendChild(opt);
    });
  }

  function listName(id) {
    const l = lists.find((x) => x.id === id);
    return l ? l.name : "ללא רשימה";
  }

  function renderLists() {
    listsContainer.innerHTML = "";
    if (!lists.length) {
      const div = document.createElement("div");
      div.className = "status muted";
      div.textContent = "אין רשימות עדיין.";
      listsContainer.appendChild(div);
      return;
    }
    lists.forEach((list) => {
      const item = document.createElement("div");
      item.className = "list-item";

      const head = document.createElement("div");
      head.className = "list-head";

      const name = document.createElement("div");
      name.className = "list-name";
      name.textContent = list.name;

      const count = document.createElement("div");
      count.className = "list-count";
      const cnt = articles.filter((a) => a.listId === list.id).length;
      count.textContent = cnt + " מאמרים";

      const actions = document.createElement("div");
      actions.className = "list-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "icon-btn";
      editBtn.textContent = "ערוך";
      editBtn.title = "ערוך שם";
      editBtn.addEventListener("click", () => renameList(list.id));

      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn danger";
      delBtn.textContent = "מחק";
      delBtn.title = "מחק רשימה";
      delBtn.addEventListener("click", () => removeList(list.id));

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      head.appendChild(name);
      head.appendChild(count);
      head.appendChild(actions);
      item.appendChild(head);

      const listArticles = articles
        .filter((a) => a.listId === list.id)
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      listArticles.forEach((a) => {
        item.appendChild(renderArticleRow(a));
      });

      listsContainer.appendChild(item);
    });
  }

  function renderArticleRow(a) {
    const row = document.createElement("div");
    row.className = "article-item";

    const title = document.createElement("a");
    title.className = "article-title";
    title.textContent = a.title || "(ללא כותרת)";
    title.title = "לפתיחת צפייה";
    title.addEventListener("click", () => showDetail(a));

    const openBtn = document.createElement("button");
    openBtn.className = "icon-btn";
    openBtn.textContent = "פתח";
    openBtn.title = "פתח מקור";
    openBtn.addEventListener("click", () => {
      if (a.url) chrome.tabs.create({ url: a.url });
    });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn danger";
    delBtn.textContent = "✕";
    delBtn.title = "מחק מאמר";
    delBtn.addEventListener("click", () => removeArticle(a.id));

    row.appendChild(title);
    row.appendChild(openBtn);
    row.appendChild(delBtn);
    return row;
  }

  /* ---------- Actions ---------- */

  async function saveCurrentArticle() {
    saveStatus.className = "status";
    saveStatus.textContent = "מחלץ את המאמר...";
    if (!activeListId) {
      saveStatus.className = "status error";
      saveStatus.textContent = "צור רשימה תחילה.";
      return;
    }
    try {
      const resp = await chrome.runtime.sendMessage({ type: "EXTRACT_ARTICLE" });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "שגיאה בחילוץ");
      const article = await addArticle({
        listId: activeListId,
        title: resp.data.title,
        content: resp.data.content,
        url: resp.data.url,
      });
      if (aiToggle.checked) {
        if (!aiApiKey) {
          saveStatus.className = "status error";
          saveStatus.textContent = "המאמר נשמר, אך אין API key להפקת תקציר. הזינו מפתח בהגדרות.";
        } else {
          saveStatus.className = "status";
          saveStatus.textContent = "מפיק תקציר AI...";
          try {
            const sum = await chrome.runtime.sendMessage({
              type: "GENERATE_SUMMARY",
              apiKey: aiApiKey,
              content: article.content,
              title: article.title,
              model: aiModel,
            });
            if (sum && sum.ok) {
              article.summary = sum.summary;
              await updateArticle(article.id, { summary: article.summary });
            } else {
              throw new Error((sum && sum.error) || "שגיאה בתקציר");
            }
          } catch (aiErr) {
            saveStatus.className = "status error";
            saveStatus.textContent = "המאמר נשמר, אולם התקציר נכשל: " + aiErr.message;
          }
        }
      }
      await maybeSavePdf(article);
      articles = await getArticles();
      render();
      if (article.summary) {
        showDetail(article);
        const box = detailView.querySelector(".detail-summary");
        if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (saveStatus.className !== "status error") {
        saveStatus.className = "status success";
        saveStatus.textContent = "המאמר נשמר בהצלחה ✓";
      }
    } catch (err) {
      saveStatus.className = "status error";
      saveStatus.textContent = "שגיאה: " + err.message;
    }
  }

  async function maybeSavePdf(article) {
    const handle = await loadDirectoryHandle();
    if (!handle) return;
    const blob = generateArticlePdfBlob(article);
    const filename = sanitizeFilename(
      new Date().toISOString().slice(0, 10) + " - " + (article.title || "article")
    ) + ".pdf";
    try {
      const fileHandle = await handle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (e) {
      console.warn("PDF save to folder failed:", e);
    }
  }

  async function onAddList() {
    const name = newListName.value.trim();
    if (!name) return;
    await addList(name);
    newListName.value = "";
    await loadAll();
  }

  async function renameList(id) {
    const list = lists.find((l) => l.id === id);
    const name = prompt("שם חדש לרשימה:", list ? list.name : "");
    if (name && name.trim()) {
      await updateList(id, name.trim());
      await loadAll();
    }
  }

  async function removeList(id) {
    const list = lists.find((l) => l.id === id);
    const ok = confirm('למחוק את הרשימה "' + (list ? list.name : "") + '" ואת כל מאמריה?');
    if (!ok) return;
    await deleteList(id);
    await loadAll();
  }

  async function removeArticle(id) {
    if (!confirm("למחוק את המאמר?")) return;
    await deleteArticle(id);
    articles = await getArticles();
    render();
  }

  async function exportExcel() {
    if (!articles.length) {
      alert("אין מאמרים לייצוא.");
      return;
    }
    const blob = buildExcelBlob(articles, lists);
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: "מאמרים.xlsx",
          types: [{
            description: "Excel Workbook",
            accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        alert("קובץ ה-Excel נשמר בהצלחה.");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "מאמרים.xlsx";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled
      alert("שגיאה בייצוא: " + e.message);
    }
  }

  async function chooseDir() {
    try {
      if (!window.showDirectoryPicker) {
        alert("הדפדפן לא תומך בבחירת תיקייה. השתמש ב-Chrome העדכני.");
        return;
      }
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await saveDirectoryHandle(handle);
      renderDirStatus();
    } catch (e) {
      if (e && e.name === "AbortError") return;
      alert("שגיאה בבחירת תיקייה: " + e.message);
    }
  }

  async function clearDir() {
    if (!confirm("לבטל את בחירת התיקייה?")) return;
    await clearDirectoryHandle();
    renderDirStatus();
  }

  async function renderDirStatus() {
    const handle = await loadDirectoryHandle();
    if (handle) {
      dirStatus.className = "status success";
      dirStatus.textContent = "התיקייה נבחרה: " + handle.name;
    } else {
      dirStatus.className = "status muted";
      dirStatus.textContent = "לא נבחרה תיקייה.";
    }
  }

  async function saveAiSettings() {
    const key = apiKeyInput.value.trim();
    const model = modelInput.value.trim() || "gemini-2.0-flash";
    await setSetting("geminiApiKey", key);
    await setSetting("geminiModel", model);
    aiApiKey = key;
    aiModel = model;
    alert("מפתח ומודל ה-AI נשמרו.");
  }

  /* ---------- Detail view ---------- */

  function mdInline(s) {
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/`([^`]+)`/g, '<code style="background:#dfe6f5;padding:1px 4px;border-radius:4px;font-size:12px;">$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function renderMarkdown(text) {
    const esc = String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const lines = esc.split("\n");
    let html = "";
    let listTag = null;
    const closeList = () => {
      if (listTag) { html += "</" + listTag + ">"; listTag = null; }
    };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { closeList(); continue; }
      if (/^#{1,4}\s/.test(line)) {
        closeList();
        const level = line.match(/^#+/)[0].length;
        const text = line.replace(/^#+\s*/, "");
        const size = level === 1 ? 16 : level === 2 ? 15 : 13.5;
        html += '<div style="font-weight:700;font-size:' + size + 'px;margin:8px 0 4px;">' + mdInline(text) + "</div>";
        continue;
      }
      if (/^---+$/.test(line)) {
        closeList();
        html += '<hr style="border:none;border-top:1px solid #c9d8f6;margin:8px 0;">';
        continue;
      }
      if (/^([*-])\s+/.test(line)) {
        if (listTag !== "ul") { closeList(); html += '<ul style="margin:4px 0 8px;padding-right:18px;">'; listTag = "ul"; }
        html += "<li style=\"margin:2px 0;\">" + mdInline(line.replace(/^[*-]\s+/, "")) + "</li>";
        continue;
      }
      if (/^\d+[.)]\s+/.test(line)) {
        if (listTag !== "ol") { closeList(); html += '<ol style="margin:4px 0 8px;padding-right:18px;">'; listTag = "ol"; }
        html += "<li style=\"margin:2px 0;\">" + mdInline(line.replace(/^\d+[.)]\s+/, "")) + "</li>";
        continue;
      }
      closeList();
      html += '<p style="margin:4px 0;">' + mdInline(line) + "</p>";
    }
    closeList();
    return html;
  }

  function showDetail(a) {
    detailBody.innerHTML = "";
    const title = document.createElement("div");
    title.className = "detail-title";
    title.textContent = a.title || "(ללא כותרת)";

    const url = document.createElement("a");
    url.className = "detail-url";
    url.href = a.url;
    url.textContent = a.url;
    url.target = "_blank";

    const meta = document.createElement("div");
    meta.className = "status muted";
    meta.textContent = "רשימה: " + listName(a.listId) + "  |  " + (a.savedAt ? new Date(a.savedAt).toLocaleString() : "");

    const content = document.createElement("div");
    content.className = "detail-content";
    content.textContent = a.content || "(אין גוף מאמר)";

    detailBody.appendChild(title);
    detailBody.appendChild(url);
    detailBody.appendChild(meta);
    if (a.summary) {
      const summaryBox = document.createElement("div");
      summaryBox.className = "detail-summary";
      const sTitle = document.createElement("div");
      sTitle.className = "summary-label";
      sTitle.textContent = "תקציר AI";
      const sText = document.createElement("div");
      sText.className = "summary-text";
      sText.innerHTML = renderMarkdown(a.summary);
      summaryBox.appendChild(sTitle);
      summaryBox.appendChild(sText);
      detailBody.appendChild(summaryBox);
    }
    detailBody.appendChild(content);

    const notesBox = document.createElement("div");
    notesBox.className = "notes-box";
    const nTitle = document.createElement("div");
    nTitle.className = "summary-label";
    nTitle.textContent = "הערות שלי";
    const notes = document.createElement("textarea");
    notes.className = "input notes-input";
    notes.placeholder = "הוסף הערות אישיות...";
    notes.value = a.notes || "";
    const noteStatus = document.createElement("div");
    noteStatus.className = "status muted";
    const saveNotes = async () => {
      try {
        await updateArticle(a.id, { notes: notes.value });
        articles = await getArticles();
        noteStatus.className = "status success";
        noteStatus.textContent = "ההערות נשמרו ✓";
        setTimeout(() => { noteStatus.textContent = ""; }, 2500);
      } catch (e) {
        noteStatus.className = "status error";
        noteStatus.textContent = "שמירה נכשלה: " + e.message;
      }
    };
    notes.addEventListener("change", saveNotes);
    notesBox.appendChild(nTitle);
    notesBox.appendChild(notes);
    notesBox.appendChild(noteStatus);
    detailBody.appendChild(notesBox);
    detailView.classList.remove("hidden");
  }

  /* ---------- Events ---------- */

  saveBtn.addEventListener("click", saveCurrentArticle);
  addListBtn.addEventListener("click", onAddList);
  newListName.addEventListener("keydown", (e) => { if (e.key === "Enter") onAddList(); });
  exportBtn.addEventListener("click", exportExcel);
  chooseDirBtn.addEventListener("click", chooseDir);
  clearDirBtn.addEventListener("click", clearDir);
  saveApiBtn.addEventListener("click", saveAiSettings);
  backBtn.addEventListener("click", () => detailView.classList.add("hidden"));

  listSelect.addEventListener("change", async () => {
    activeListId = listSelect.value || null;
    if (activeListId) await setSetting("activeListId", activeListId);
  });

  loadAll();

  // refresh when panel becomes visible
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadAll();
  });
})();
