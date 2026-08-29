(function () {
  const isFull = new URLSearchParams(location.search).get("mode") === "full";
  if (isFull) document.body.classList.add("full");

  let lists = [];
  let articles = [];
  let activeListId = null;
  let activeArticleId = null;
  let aiApiKey = "";
  let aiModel = "gemini-2.0-flash";
  let searchQuery = "";

  const t = (k) => window.I18N.t(k);

  function articleMatches(a, query) {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    const haystack = [a.title, a.content, a.summary, a.notes, a.url]
      .filter((x) => x != null)
      .join("\n")
      .toLowerCase();
    return haystack.indexOf(q) !== -1;
  }

  const $ = (sel) => document.querySelector(sel);
  const listSelect = $("#listSelect");
  const saveBtn = $("#saveBtn");
  const saveStatus = $("#saveStatus");
  const listsContainer = $("#listsContainer");
  const searchInput = $("#searchInput");
  const newListName = $("#newListName");
  const addListBtn = $("#addListBtn");
  const exportBtn = $("#exportBtn");
  const detailView = $("#detailView");
  const detailBody = $("#detailBody");
  const backBtn = $("#backBtn");
  const apiKeyInput = $("#apiKeyInput");
  const modelInput = $("#modelInput");
  const saveApiBtn = $("#saveApiBtn");
  const aiToggle = $("#aiToggle");
  const aiSettingsToggle = $("#aiSettingsToggle");
  const aiSettings = $("#aiSettings");
  const settingsBtn = $("#settingsBtn");
  const settingsView = $("#settingsView");
  const settingsBackBtn = $("#settingsBackBtn");
  const mainView = $("#mainView");
  const expandBtn = $("#expandBtn");
  const langSelect = $("#langSelect");

  async function loadAll() {
    lists = await getLists();
    articles = await getArticles();
    await window.I18N.load();
    applyI18n();
    const st = await getSetting("activeListId");
    const savedId = st ? st.value : null;
    if (savedId && lists.some((l) => l.id === savedId)) activeListId = savedId;
    else activeListId = lists.length ? lists[0].id : null;
    if (activeListId) await setSetting("activeListId", activeListId);
    await loadAiSettings();
    render();
  }

  function applyI18n() {
    window.I18N.apply();
  }

  function applyLangSelect() {
    langSelect.value = window.I18N.lang;
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
      opt.textContent = t("noListsOption");
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
    return l ? l.name : t("noList");
  }

  function renderLists() {
    listsContainer.innerHTML = "";
    if (!lists.length) {
      const div = document.createElement("div");
      div.className = "status muted";
      div.textContent = t("noLists");
      listsContainer.appendChild(div);
      return;
    }
    lists.forEach((list) => {
      const listArticles = articles
        .filter((a) => a.listId === list.id)
        .filter((a) => articleMatches(a, searchQuery))
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

      if (searchQuery.trim() && !listArticles.length) return;

      const item = document.createElement("div");
      item.className = "list-item";

      const head = document.createElement("div");
      head.className = "list-head";

      const name = document.createElement("div");
      name.className = "list-name";
      name.textContent = list.name;

      const count = document.createElement("div");
      count.className = "list-count";
      const total = articles.filter((a) => a.listId === list.id).length;
      const shown = listArticles.length;
      count.textContent = searchQuery.trim()
        ? shown + "/" + total + " " + t("articlesCount")
        : shown + " " + t("articlesCount");

      const actions = document.createElement("div");
      actions.className = "list-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "icon-btn";
      editBtn.textContent = t("edit");
      editBtn.title = t("editTitle");
      editBtn.addEventListener("click", () => renameList(list.id));

      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn danger";
      delBtn.textContent = t("delete");
      delBtn.title = t("deleteListTitle");
      delBtn.addEventListener("click", () => removeList(list.id));

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      head.appendChild(name);
      head.appendChild(count);
      head.appendChild(actions);
      item.appendChild(head);

      listArticles.forEach((a) => {
        item.appendChild(renderArticleRow(a));
      });

      listsContainer.appendChild(item);
    });

    if (searchQuery.trim() && !listsContainer.children.length) {
      const div = document.createElement("div");
      div.className = "status muted";
      div.textContent = t("noSearchResults");
      listsContainer.appendChild(div);
    }
    applyActiveRow();
  }

  function renderArticleRow(a) {
    const row = document.createElement("div");
    row.className = "article-item";
    row.dataset.id = a.id;

    const title = document.createElement("a");
    title.className = "article-title";
    title.textContent = a.title || t("noTitle");
    title.title = t("openView");
    title.addEventListener("click", () => showDetail(a));

    const openBtn = document.createElement("button");
    openBtn.className = "icon-btn";
    openBtn.textContent = t("open");
    openBtn.title = t("openSource");
    openBtn.addEventListener("click", () => {
      if (a.url) chrome.tabs.create({ url: a.url });
    });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn danger";
    delBtn.textContent = "✕";
    delBtn.title = t("deleteArticleTitle");
    delBtn.addEventListener("click", () => removeArticle(a.id));

    row.appendChild(title);
    row.appendChild(openBtn);
    row.appendChild(delBtn);
    return row;
  }

  /* ---------- Actions ---------- */

  async function saveCurrentArticle() {
    saveStatus.className = "status";
    saveStatus.textContent = t("extracting");
    if (!activeListId) {
      saveStatus.className = "status error";
      saveStatus.textContent = t("createListFirst");
      return;
    }
    try {
      const resp = await chrome.runtime.sendMessage({ type: "EXTRACT_ARTICLE", lang: window.I18N.lang });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || t("extractError"));
      const article = await addArticle({
        listId: activeListId,
        title: resp.data.title,
        content: resp.data.content,
        url: resp.data.url,
      });
      if (aiToggle.checked) {
        if (!aiApiKey) {
          saveStatus.className = "status error";
          saveStatus.textContent = t("savedNoKey");
        } else {
          saveStatus.className = "status";
          saveStatus.textContent = t("generatingSummary");
          try {
            const sum = await chrome.runtime.sendMessage({
              type: "GENERATE_SUMMARY",
              apiKey: aiApiKey,
              content: article.content,
              title: article.title,
              model: aiModel,
              lang: window.I18N.lang,
            });
            if (sum && sum.ok) {
              article.summary = sum.summary;
              await updateArticle(article.id, { summary: article.summary });
            } else {
              throw new Error((sum && sum.error) || t("summaryError"));
            }
          } catch (aiErr) {
            saveStatus.className = "status error";
            saveStatus.textContent = t("savedButSummaryFailed") + aiErr.message;
          }
        }
      }
      articles = await getArticles();
      render();
      if (article.summary) {
        showDetail(article);
      }
      if (saveStatus.className !== "status error") {
        saveStatus.className = "status success";
        saveStatus.textContent = t("savedSuccess");
      }
    } catch (err) {
      saveStatus.className = "status error";
      saveStatus.textContent = t("errorPrefix") + err.message;
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
    const name = prompt(t("renamePrompt"), list ? list.name : "");
    if (name && name.trim()) {
      await updateList(id, name.trim());
      await loadAll();
    }
  }

  async function removeList(id) {
    const list = lists.find((l) => l.id === id);
    const ok = confirm(t("deleteListConfirm") + (list ? list.name : "") + t("deleteListConfirmSuffix"));
    if (!ok) return;
    await deleteList(id);
    await loadAll();
  }

  async function removeArticle(id) {
    if (!confirm(t("deleteArticleConfirm"))) return;
    await deleteArticle(id);
    articles = await getArticles();
    if (activeArticleId === id) { activeArticleId = null; detailView.classList.add("hidden"); }
    render();
  }

  async function exportExcel() {
    const freshLists = await getLists();
    const freshArticles = await getArticles();
    if (!freshArticles.length) {
      alert(t("noArticlesExport"));
      return;
    }
    const blob = await buildExcelBlob(freshArticles, freshLists);
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: t("excelFileName"),
          types: [{
            description: "Excel Workbook",
            accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        alert(t("exportSaved"));
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = t("excelFileName");
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled
      alert(t("exportError") + e.message);
    }
  }

  async function saveAiSettings() {
    const key = apiKeyInput.value.trim();
    const model = modelInput.value.trim() || "gemini-2.0-flash";
    await setSetting("geminiApiKey", key);
    await setSetting("geminiModel", model);
    aiApiKey = key;
    aiModel = model;
    alert(t("aiSaved"));
  }

  /* ---------- Detail view ---------- */

  // Highlights the article row currently open, so the user always knows
  // which article is being read.
  function applyActiveRow() {
    document.querySelectorAll(".article-item").forEach((row) => {
      row.classList.toggle("active", row.dataset.id === activeArticleId);
    });
  }

  // Binds the detail column height to the full (natural) height of the lists
  // column, so the page ends where the lists end while the summary, notes,
  // chat and full text scroll internally when there is not enough room.
  function fitDetailToLists() {
    if (!isFull) return;
    const mainH = mainView.getBoundingClientRect().height;
    detailBody.style.height = Math.max(240, mainH) + "px";
  }

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
        if (listTag !== "ul") { closeList(); html += '<ul style="margin:4px 0 8px;padding-inline-start:18px;">'; listTag = "ul"; }
        html += "<li style=\"margin:2px 0;\">" + mdInline(line.replace(/^[*-]\s+/, "")) + "</li>";
        continue;
      }
      if (/^\d+[.)]\s+/.test(line)) {
        if (listTag !== "ol") { closeList(); html += '<ol style="margin:4px 0 8px;padding-inline-start:18px;">'; listTag = "ol"; }
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
    activeArticleId = a.id;
    applyActiveRow();
    const title = document.createElement("div");
    title.className = "detail-title";
    title.textContent = a.title || t("noTitle");

    const url = document.createElement("a");
    url.className = "detail-url";
    url.href = a.url;
    url.textContent = a.url;
    url.target = "_blank";

    const metaBaseText = t("listOf") + listName(a.listId) + "  |  " + (a.savedAt ? new Date(a.savedAt).toLocaleString() : "");
    const meta = document.createElement("div");
    meta.className = "status muted";
    meta.textContent = metaBaseText;
    meta.dataset.base = metaBaseText;

    const content = document.createElement("div");
    content.className = "detail-content";
    content.contentEditable = "true";
    content.spellcheck = false;
    content.dataset.placeholder = t("noBody");
    content.textContent = a.content || "";
    content.title = t("editHint");

    const saveContent = async () => {
      const val = content.innerText != null ? content.innerText.replace(/\s+$/, "") : (content.textContent || "");
      if (val === a.content) return;
      try {
        await updateArticle(a.id, { content: val });
        a.content = val;
        articles = await getArticles();
        meta.className = "status success";
        meta.textContent = meta.dataset.base + t("textSaved");
        setTimeout(() => { meta.className = "status muted"; meta.textContent = meta.dataset.base; }, 2500);
      } catch (e) {
        meta.className = "status error";
        meta.textContent = t("textSaveFailed") + e.message;
      }
    };
    content.addEventListener("blur", saveContent);

    detailBody.appendChild(title);
    detailBody.appendChild(url);
    detailBody.appendChild(meta);
    const detailMid = document.createElement("div");
    detailMid.className = "detail-mid";
    detailBody.appendChild(detailMid);
    const summaryBox = document.createElement("div");
    summaryBox.className = "detail-summary";
    const headRow = document.createElement("div");
    headRow.className = "summary-head";
    const sTitle = document.createElement("div");
    sTitle.className = "summary-label";
    sTitle.textContent = t("aiSummary");
    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "btn btn-secondary btn-small";
    regenBtn.textContent = t("regenerate");
    const chatBtn = document.createElement("button");
    chatBtn.type = "button";
    chatBtn.className = "btn btn-secondary btn-small";
    chatBtn.textContent = t("chatButton");
    const summaryActions = document.createElement("div");
    summaryActions.className = "summary-actions";
    summaryActions.appendChild(chatBtn);
    summaryActions.appendChild(regenBtn);
    headRow.appendChild(sTitle);
    headRow.appendChild(summaryActions);
    summaryBox.appendChild(headRow);
    const sText = document.createElement("div");
    sText.className = "summary-text";
    if (a.summary) sText.innerHTML = renderMarkdown(a.summary);
    const sumStatus = document.createElement("div");
    sumStatus.className = "status muted";
    summaryBox.appendChild(sText);
    summaryBox.appendChild(sumStatus);
    detailMid.appendChild(summaryBox);

    regenBtn.addEventListener("click", async () => {
      if (!aiApiKey) {
        sumStatus.className = "status error";
        sumStatus.textContent = t("noApiKey");
        return;
      }
      regenBtn.disabled = true;
      sumStatus.className = "status muted";
      sumStatus.textContent = t("regenerating");
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "GENERATE_SUMMARY",
          apiKey: aiApiKey,
          content: a.content,
          title: a.title,
          model: aiModel,
          lang: window.I18N.lang,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || t("summaryError"));
        a.summary = resp.summary;
        await updateArticle(a.id, { summary: resp.summary });
        articles = await getArticles();
        sText.innerHTML = renderMarkdown(resp.summary);
        sumStatus.className = "status success";
        sumStatus.textContent = t("summaryUpdated");
        setTimeout(() => { sumStatus.textContent = ""; }, 2500);
      } catch (err) {
        sumStatus.className = "status error";
        sumStatus.textContent = t("chatError") + err.message;
      } finally {
        regenBtn.disabled = false;
      }
    });
    const notesBox = document.createElement("div");
    notesBox.className = "notes-box";
    const nTitle = document.createElement("div");
    nTitle.className = "summary-label";
    nTitle.textContent = t("myNotes");
    const notes = document.createElement("div");
    notes.className = "input notes-input rich-text";
    notes.contentEditable = "true";
    notes.innerHTML = sanitizeHtml(a.notes);
    notes.dataset.placeholder = t("notesPlaceholder");
    const toolbar = document.createElement("div");
    toolbar.className = "notes-toolbar";
    const captureRange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && notes.contains(sel.anchorNode)) return sel.getRangeAt(0).cloneRange();
      return null;
    };
    const restoreRange = (rng) => {
      notes.focus();
      if (rng) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(rng);
      }
    };
    const cmds = [
      { label: "ב", cmd: "bold", title: t("bold") },
      { label: "I", cmd: "italic", title: t("italic") },
      { label: "•≡", cmd: "insertUnorderedList", title: t("bulletList") },
      { label: "1≡", cmd: "insertOrderedList", title: t("numList") },
    ];
    for (const c of cmds) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c.label;
      b.title = c.title;
      b.className = "icon-btn notes-tb";
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        notes.focus();
        document.execCommand(c.cmd, false, null);
        notes.focus();
      });
      toolbar.appendChild(b);
    }
    const sizeSel = document.createElement("select");
    sizeSel.className = "notes-tb";
    sizeSel.title = t("textSize");
    [
      { label: t("size"), value: "" },
      { label: t("small"), value: "1" },
      { label: t("normal"), value: "3" },
      { label: t("large"), value: "7" },
    ].forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sizeSel.appendChild(opt);
    });
    let savedRange = null;
    sizeSel.addEventListener("mousedown", () => { savedRange = captureRange(); });
    sizeSel.addEventListener("change", () => {
      const v = sizeSel.value;
      sizeSel.value = "";
      if (!v) return;
      restoreRange(savedRange);
      document.execCommand("fontSize", false, v);
      notes.focus();
    });
    toolbar.appendChild(sizeSel);
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "notes-color";
    colorInput.value = "#1d2433";
    colorInput.title = t("textColor");
    colorInput.addEventListener("mousedown", () => { savedRange = captureRange(); });
    colorInput.addEventListener("input", () => {
      restoreRange(savedRange);
      document.execCommand("foreColor", false, colorInput.value.toUpperCase());
      notes.focus();
    });
    toolbar.appendChild(colorInput);
    const noteStatus = document.createElement("div");
    noteStatus.className = "status muted";
    const saveNotes = async () => {
      try {
        await updateArticle(a.id, { notes: notes.innerHTML });
        articles = await getArticles();
        noteStatus.className = "status success";
        noteStatus.textContent = t("notesSaved");
        setTimeout(() => { noteStatus.textContent = ""; }, 2500);
      } catch (e) {
        noteStatus.className = "status error";
        noteStatus.textContent = t("noteSaveFailed") + e.message;
      }
    };
    notes.addEventListener("blur", saveNotes);
    notesBox.appendChild(nTitle);
    notesBox.appendChild(toolbar);
    notesBox.appendChild(notes);
    notesBox.appendChild(noteStatus);
    detailMid.appendChild(notesBox);

    const chatBox = document.createElement("div");
    chatBox.className = "chat-box";
    chatBtn.addEventListener("click", () => {
      chatBox.scrollIntoView({ behavior: "smooth", block: "start" });
      chatInputRef && chatInputRef.focus();
    });
    let chatInputRef = null;
    const chatTitle = document.createElement("div");
    chatTitle.className = "summary-label";
    chatTitle.textContent = t("chatTitle");
    const chatMessages = document.createElement("div");
    chatMessages.className = "chat-messages";
    const chatStatus = document.createElement("div");
    chatStatus.className = "status muted";
    const chatInput = document.createElement("input");
    chatInput.className = "input";
    chatInput.type = "text";
    chatInput.placeholder = t("chatPlaceholder");
    chatInputRef = chatInput;
    const chatSend = document.createElement("button");
    chatSend.type = "button";
    chatSend.className = "btn btn-primary btn-small";
    chatSend.textContent = t("send");
    const chatRow = document.createElement("div");
    chatRow.className = "chat-input-row";
    chatRow.appendChild(chatInput);
    chatRow.appendChild(chatSend);

    const renderChat = () => {
      chatMessages.innerHTML = "";
      (a.chat || []).forEach((m) => {
        const div = document.createElement("div");
        div.className = "chat-msg " + (m.role === "user" ? "chat-user" : "chat-ai");
        div.textContent = m.text || "";
        chatMessages.appendChild(div);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    renderChat();

    const sendChat = async () => {
      const text = chatInput.value.trim();
      if (!text) return;
      if (!aiApiKey) {
        chatStatus.className = "status error";
        chatStatus.textContent = t("noApiKeyChat");
        return;
      }
      const chat = (a.chat || []).concat([{ role: "user", text }]);
      a.chat = chat;
      await updateArticle(a.id, { chat });
      articles = await getArticles();
      chatInput.value = "";
      renderChat();
      chatSend.disabled = true;
      chatStatus.className = "status muted";
      chatStatus.textContent = t("aiThinking");
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "CHAT_ARTICLE",
          apiKey: aiApiKey,
          model: aiModel,
          title: a.title,
          content: a.content,
          messages: chat,
          lang: window.I18N.lang,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || t("replyError"));
        const reply = { role: "assistant", text: resp.text };
        a.chat = (a.chat || []).concat([reply]);
        await updateArticle(a.id, { chat: a.chat });
        articles = await getArticles();
        chatStatus.className = "status success";
        chatStatus.textContent = t("saved");
        setTimeout(() => { chatStatus.textContent = ""; }, 2000);
      } catch (err) {
        chatStatus.className = "status error";
        chatStatus.textContent = t("chatError") + err.message;
      } finally {
        chatSend.disabled = false;
        renderChat();
      }
    };
    chatSend.addEventListener("click", sendChat);
    chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

    chatBox.appendChild(chatTitle);
    chatBox.appendChild(chatMessages);
    chatBox.appendChild(chatStatus);
    chatBox.appendChild(chatRow);
    detailMid.appendChild(chatBox);
    detailBody.appendChild(content);
    detailView.classList.remove("hidden");
    if (isFull) {
      fitDetailToLists();
    }
    if (!isFull) {
      requestAnimationFrame(() => {
        const box = detailView.querySelector(".detail-summary");
        (box || detailView).scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }

  /* ---------- Events ---------- */

  if (isFull) {
    window.addEventListener("resize", () => {
      if (!detailView.classList.contains("hidden")) fitDetailToLists();
    });
  }

  saveBtn.addEventListener("click", saveCurrentArticle);
  addListBtn.addEventListener("click", onAddList);
  newListName.addEventListener("keydown", (e) => { if (e.key === "Enter") onAddList(); });
  exportBtn.addEventListener("click", exportExcel);
  saveApiBtn.addEventListener("click", saveAiSettings);
  aiSettingsToggle.addEventListener("click", () => aiSettings.classList.toggle("hidden"));
  settingsBtn.addEventListener("click", () => {
    applyI18n();
    applyLangSelect();
    settingsView.classList.remove("hidden");
    mainView.classList.add("hidden");
    detailView.classList.add("hidden");
  });
  settingsBackBtn.addEventListener("click", () => {
    settingsView.classList.add("hidden");
    mainView.classList.remove("hidden");
    applyI18n();
    render();
  });
  expandBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") + "?mode=full" });
  });
  backBtn.addEventListener("click", () => detailView.classList.add("hidden"));

  listSelect.addEventListener("change", async () => {
    activeListId = listSelect.value || null;
    if (activeListId) await setSetting("activeListId", activeListId);
  });

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value;
    renderLists();
  });

  langSelect.addEventListener("change", async () => {
    await window.I18N.set(langSelect.value);
    applyI18n();
    render();
  });

  loadAll().then(() => {
    if (isFull && articles.length) showDetail(articles[0]);
  });

  // refresh when panel becomes visible
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadAll();
  });
})();
