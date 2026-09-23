(function () {
  const isFull = new URLSearchParams(location.search).get("mode") === "full";
  if (isFull) document.body.classList.add("full");

  let lists = [];
  let articles = [];
  let activeListId = null;
  let activeArticleId = null;
  let aiApiKey = "";
  let aiModel = "gemini-2.5-flash";
  let searchQuery = "";
  let saveFlashTimer = null;

  const t = (k, params) => window.I18N.t(k, params);

  function setIcon(button, name, label, iconOnly = true) {
    button.dataset.icon = name;
    button.textContent = iconOnly ? "" : label;
    if (label) {
      button.title = label;
      button.setAttribute("aria-label", label);
    }
  }

  function emptyState(title, description, icon = "library") {
    const box = document.createElement("div");
    box.className = "empty-state";
    const mark = document.createElement("span");
    mark.className = "empty-mark";
    mark.dataset.icon = icon;
    mark.setAttribute("aria-hidden", "true");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const text = document.createElement("p");
    text.textContent = description;
    box.append(mark, heading, text);
    return box;
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const BLOCK_RE =
    /^(address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)$/i;

  // Collapses 2+ consecutive blank lines into a single blank line and trims
  // trailing whitespace, so the full article text stays tidy. Plain text is
  // handled with line-based regexes; the contentEditable editor stores sanitized
  // HTML, where blank lines are empty block elements (e.g. <div>\t</div>) that the
  // regexes cannot see, so those go through the DOM-based normalizeHtml instead.
  function normalizeBody(s, format) {
    const str = String(s || "");
    if (format !== "text" && /<[a-z][\s\S]*>/i.test(str)) return normalizeHtml(str);
    return str
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+$/, "");
  }

  // Whether a block element has no visible text content (a blank line in the editor).
  // Non-breaking spaces (\u00a0) are also treated as empty — contentEditable
  // browsers often use &nbsp; to render blank/whitespace-only lines.
  function isEmptyBlock(el) {
    return !String(el.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function collectElements(root, out) {
    for (const child of Array.from(root.childNodes)) {
      if (child.nodeType === 1) {
        out.push(child);
        collectElements(child, out);
      }
    }
    return out;
  }

  // DOM-based cleanup for the sanitized HTML of the full-text editor: strips
  // whitespace-only text nodes (e.g. the tabs/newlines inside <div>\t\t\n</div> and
  // between block elements, which otherwise render as visible blank lines under
  // white-space: pre-wrap), collapses runs of 2+ consecutive empty block elements
  // to a single empty block (one blank line, mirroring the plain-text \n{3,} -> \n\n
  // rule), collapses runs of 3+ consecutive <br> to two (one blank line), and drops
  // trailing empty blocks. Whitespace inside <pre>/<code> is preserved.
  function normalizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = doc.body || doc.documentElement;

    const isWsOnly = (s) => !String(s || "").replace(/\u00a0/g, " ").trim();

    const shouldStripWs = (parent, value) => {
      const tag = parent.tagName.toUpperCase();
      if (tag === "PRE" || tag === "CODE") return false;
      if (!BLOCK_RE.test(parent.tagName) && tag !== "BODY" && tag !== "HTML") return false;
      if (isEmptyBlock(parent)) return true;
      if (/[\n\r]/.test(value)) return true;
      return Array.from(parent.children).some((c) => BLOCK_RE.test(c.tagName));
    };

    const prune = (container) => {
      for (const child of Array.from(container.childNodes)) {
        if (child.nodeType === 3) {
          if (isWsOnly(child.nodeValue) && shouldStripWs(container, child.nodeValue)) {
            container.removeChild(child);
          }
          continue;
        }
        if (child.nodeType !== 1) continue;
        prune(child);
      }
    };
    prune(root);

    const blocks = collectElements(root, []).filter((n) => BLOCK_RE.test(n.tagName));

    let run = 0;
    blocks.forEach((b) => {
      if (isEmptyBlock(b)) {
        run++;
        if (run > 1) b.parentNode.removeChild(b);
      } else {
        run = 0;
      }
    });

    run = 0;
    collectElements(root, []).forEach((n) => {
      if (n.tagName === "BR") {
        run++;
        if (run > 2) n.parentNode.removeChild(n);
      } else {
        run = 0;
      }
    });

    let last = root.lastElementChild;
    while (last && BLOCK_RE.test(last.tagName) && isEmptyBlock(last)) {
      const prev = last.previousElementSibling;
      last.parentNode.removeChild(last);
      last = prev;
    }

    return root.innerHTML.trim();
  }

  // Auto-aligns the full text: right-to-left for Hebrew/Arabic, otherwise left.
  function detectDirection(s) {
    return /[\u0590-\u05FF\u0600-\u06FF]/.test(String(s || "")) ? "rtl" : "ltr";
  }

  // Plain text -> sanitized HTML for the contentEditable full-text editor.
  function contentToHtml(s, format) {
    return articleContentToHtml(s, format);
  }

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
  const listSelectBtn = $("#listSelectBtn");
  const listSelectLabel = $("#listSelectLabel");
  const listDropdown = $("#listDropdown");
  const listDropdownMenu = $("#listDropdownMenu");
  const newListBtn = $("#newListBtn");
  const newListInline = $("#newListInline");
  const newListName = $("#newListName");
  const confirmNewListBtn = $("#confirmNewListBtn");
  const cancelNewListBtn = $("#cancelNewListBtn");
  const saveBtn = $("#saveBtn");
  const saveStatus = $("#saveStatus");
  const listsContainer = $("#listsContainer");
  const listsSection = $("#listsSection");
  const searchInput = $("#searchInput");
  const exportBtn = $("#exportBtn");
  const importBtn = $("#importBtn");
  const detailView = $("#detailView");
  const detailBody = $("#detailBody");
  const backBtn = $("#backBtn");
  const apiKeyInput = $("#apiKeyInput");
  const modelSelect = $("#modelSelect");
  const loadModelsBtn = $("#loadModelsBtn");
  const modelStatus = $("#modelStatus");
  const saveApiBtn = $("#saveApiBtn");
  const aiToggle = $("#aiToggle");
  const aiSettingsToggle = $("#aiSettingsToggle");
  const aiSettings = $("#aiSettings");
  const aiSetupGuide = $("#aiSetupGuide");
  const settingsBtn = $("#settingsBtn");
  const settingsView = $("#settingsView");
  const settingsBackBtn = $("#settingsBackBtn");
  const mainView = $("#mainView");
  const expandBtn = $("#expandBtn");
  const langSelect = $("#langSelect");

  const dupModal = $("#dupModal");
  const dupSaveAgainBtn = $("#dupSaveAgainBtn");
  const dupUpdateBtn = $("#dupUpdateBtn");
  const dupCancelBtn = $("#dupCancelBtn");

  const chatCtxMenu = $("#chatContextMenu");
  const chatDelModal = $("#chatDelModal");
  const chatDelConfirmBtn = $("#chatDelConfirmBtn");
  const chatDelCancelBtn = $("#chatDelCancelBtn");
  let chatMenuIdx = null;
  let chatConfirmIdx = null;
  let chatDeleteFn = null;

  const renameModal = $("#renameModal");
  const renameInput = $("#renameInput");
  const renameSaveBtn = $("#renameSaveBtn");
  const renameCancelBtn = $("#renameCancelBtn");
  let renameListId = null;

  const confirmModal = $("#confirmModal");
  const confirmModalTitle = $("#confirmModalTitle");
  const confirmModalBody = $("#confirmModalBody");
  const confirmOkBtn = $("#confirmOkBtn");
  const confirmCancelBtn = $("#confirmCancelBtn");
  let confirmResolve = null;

  let shareCollectionId = null;
  let shareArticleId = null;
  let researchPackArticles = [];
  let articleSelectionMode = false;
  let selectedArticleIds = new Set();
  let importConfirmAction = null;
  let pendingImportPackage = null;
  let pendingImportPreview = null;

  const shareModal = $("#shareModal");
  const shareCollectionName = $("#shareCollectionName");
  const shareCollectionStats = $("#shareCollectionStats");
  const shareCollectionOptionsGrid = $("#shareCollectionOptionsGrid");
  const shareCollectionOptionsSummary = $("#shareCollectionOptionsSummary");
  const shareCollectionNote = $("#shareCollectionNote");
  const shareMessageContent = $("#shareMessageContent");
  let shareCopyBtn = $("#shareCopyBtn");
  const shareNativeBtn = $("#shareNativeBtn");
  const shareCancelBtn = $("#shareCancelBtn");

  const shareArticleModal = $("#shareArticleModal");
  const shareArticleName = $("#shareArticleName");
  const shareArticleStats = $("#shareArticleStats");
  const shareArticleOptionsGrid = $("#shareArticleOptionsGrid");
  const shareArticleMessageContent = $("#shareArticleMessageContent");
  let shareArticleCopyBtn = $("#shareArticleCopyBtn");
  const shareArticleNativeBtn = $("#shareArticleNativeBtn");
  const shareArticleCancelBtn = $("#shareArticleCancelBtn");
  const shareArticleNote = $("#shareArticleNote");

  const shareReadyModal = $("#shareReadyModal");
  const shareReadyTitle = $("#shareReadyTitle");
  const shareReadyFile = $("#shareReadyFile");
  const shareReadyCopyBtn = $("#shareReadyCopyBtn");
  const shareReadyEmailBtn = $("#shareReadyEmailBtn");
  const shareReadyCancelBtn = $("#shareReadyCancelBtn");
  const shareReadyFeedback = $("#shareReadyModal [data-feedback]");
  let shareReadyInstructions = "";
  let shareReadyFileName = "";
  let shareReadyItemName = "";
  let shareReadyFeedbackTimer = null;

  const researchPackModal = $("#researchPackModal");
  const researchPackName = $("#researchPackName");
  const researchPackDescription = $("#researchPackDescription");
  const researchPackOptionsGrid = $("#researchPackOptionsGrid");
  const researchPackMessageContent = $("#researchPackMessageContent");
  let researchPackCopyBtn = $("#researchPackCopyBtn");
  const researchPackArticleCount = $("#researchPackArticleCount");
  const researchPackCreateBtn = $("#researchPackCreateBtn");
  const researchPackCancelBtn = $("#researchPackCancelBtn");

  const exportDropdown = $("#exportDropdown");
  const exportDropdownMenu = $("#exportDropdownMenu");
  const exportExcelBtn = $("#exportExcelBtn");
  const exportPackageBtn = $("#exportPackageBtn");

  const importModal = $("#importModal");
  const importModalBody = $("#importModalBody");
  const importConfirmBtn = $("#importConfirmBtn");
  const importMergeBtn = $("#importMergeBtn");
  const importCancelBtn = $("#importCancelBtn");

  const articleSelectModal = $("#articleSelectModal");
  const articleSelectionList = $("#articleSelectionList");
  const selectAllBtn = $("#selectAllBtn");
  const deselectAllBtn = $("#deselectAllBtn");
  const selectionCount = $("#selectionCount");
  const articleSelectConfirmBtn = $("#articleSelectConfirmBtn");
  const articleSelectCancelBtn = $("#articleSelectCancelBtn");
  const articleSelectSearch = $("#articleSelectSearch");
  const pickerFilterChips = $("#pickerFilterChips");
  const articleSelectSource = $("#articleSelectSource");
  const articleSelectAvailable = $("#articleSelectAvailable");
  const pickerEmptyState = $("#pickerEmptyState");
  const pickerEmptyHint = $("#pickerEmptyHint");
  let pickerArticlePool = [];
  let pickerSearchQuery = "";
  let pickerActiveFilter = "all";

  const whatsNewModal = $("#whatsNewModal");
  const whatsNewCard = $("#whatsNewCard");
  const whatsNewCloseBtn = $("#whatsNewCloseBtn");
  const whatsNewCta = $("#whatsNewCta");
  const whatsNewGotIt = $("#whatsNewGotIt");
  const whatsNewBtn = $("#whatsNewBtn");
  const whatsNewBellDot = whatsNewBtn ? whatsNewBtn.querySelector(".whatsnew-bell-dot") : null;

  const WHATS_NEW_VERSION = "1.2.0";
  let whatsNewOpen = false;
  let whatsNewLastFocused = null;

  const closeChatMenu = () => {
    chatCtxMenu.classList.add("hidden");
    chatCtxMenu.innerHTML = "";
    chatMenuIdx = null;
  };

  const openChatMenu = (e, idx) => {
    closeChatMenu();
    chatMenuIdx = idx;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ctx-menu-item";
    item.textContent = t("chatMenuDelete") || "Delete message";
    item.addEventListener("click", () => {
      chatConfirmIdx = chatMenuIdx;
      closeChatMenu();
      applyI18n();
      chatDelModal.classList.remove("hidden");
    });
    chatCtxMenu.appendChild(item);
    const maxLeft = window.innerWidth - 160;
    const maxTop = window.innerHeight - 50;
    chatCtxMenu.style.left = Math.min(e.clientX, maxLeft) + "px";
    chatCtxMenu.style.top = Math.min(e.clientY, maxTop) + "px";
    chatCtxMenu.classList.remove("hidden");
  };

  const hideChatConfirm = () => {
    chatDelModal.classList.add("hidden");
    chatConfirmIdx = null;
  };

  chatDelConfirmBtn.addEventListener("click", () => {
    const idx = chatConfirmIdx;
    hideChatConfirm();
    if (chatDeleteFn) chatDeleteFn(idx);
  });
  chatDelCancelBtn.addEventListener("click", hideChatConfirm);
  chatDelModal.addEventListener("click", (e) => {
    if (e.target === chatDelModal) hideChatConfirm();
  });
  document.addEventListener("mousedown", (e) => {
    if (!chatCtxMenu.classList.contains("hidden") && !chatCtxMenu.contains(e.target)) {
      closeChatMenu();
    }
  });
  window.addEventListener("blur", closeChatMenu);

  let dupResolve = null;
  function promptDuplicateSave() {
    applyI18n();
    dupModal.classList.remove("hidden");
    return new Promise((resolve) => {
      dupResolve = resolve;
    });
  }
  function closeDuplicateModal(result) {
    dupModal.classList.add("hidden");
    if (dupResolve) {
      const r = dupResolve;
      dupResolve = null;
      r(result);
    }
  }
  dupSaveAgainBtn.addEventListener("click", () => closeDuplicateModal("new"));
  dupUpdateBtn.addEventListener("click", () => closeDuplicateModal("update"));
  dupCancelBtn.addEventListener("click", () => closeDuplicateModal("cancel"));
  dupModal.addEventListener("click", (e) => {
    if (e.target === dupModal) closeDuplicateModal("cancel");
  });

  renameSaveBtn.addEventListener("click", submitRename);
  renameCancelBtn.addEventListener("click", () => {
    renameListId = null;
    renameModal.classList.add("hidden");
  });
  renameModal.addEventListener("click", (e) => {
    if (e.target === renameModal) {
      renameListId = null;
      renameModal.classList.add("hidden");
    }
  });
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitRename(); }
    else if (e.key === "Escape") { renameListId = null; renameModal.classList.add("hidden"); }
  });

  confirmOkBtn.addEventListener("click", () => closeConfirm(true));
  confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) closeConfirm(false);
  });

  /* ===== What's New modal ===== */
  async function maybeShowWhatsNew() {
    if (whatsNewOpen || !whatsNewModal) return;
    let pending = null;
    try {
      const stored = await chrome.storage.local.get("pendingWhatsNewVersion");
      pending = stored && stored.pendingWhatsNewVersion;
    } catch (e) {}
    if (!pending || pending !== WHATS_NEW_VERSION) return;
    openWhatsNew();
  }

  function openWhatsNew() {
    whatsNewOpen = true;
    whatsNewLastFocused = document.activeElement;
    whatsNewModal.classList.remove("closing");
    whatsNewModal.classList.remove("hidden");
    applyI18n();
    requestAnimationFrame(() => {
      (whatsNewCta || whatsNewCloseBtn || whatsNewGotIt).focus();
    });
    document.addEventListener("keydown", whatsNewKeydown);
    markWhatsNewSeen();
  }

  async function markWhatsNewSeen() {
    try {
      await chrome.storage.local.set({ lastSeenWhatsNewVersion: WHATS_NEW_VERSION });
      await chrome.storage.local.remove("pendingWhatsNewVersion");
    } catch (e) {}
    setWhatsNewBellState(false);
  }

  function updateWhatsNewBellLabel(unread) {
    if (!whatsNewBtn) return;
    const label = t(unread ? "whatsNewButtonUnread" : "whatsNewButton");
    whatsNewBtn.title = label;
    whatsNewBtn.setAttribute("aria-label", label);
  }

  function setWhatsNewBellState(unread) {
    if (!whatsNewBtn) return;
    whatsNewBtn.classList.toggle("unread", !!unread);
    if (whatsNewBellDot) whatsNewBellDot.setAttribute("aria-hidden", "true");
    updateWhatsNewBellLabel(unread);
  }

  async function refreshWhatsNewBell() {
    if (!whatsNewBtn) return;
    let seen = null;
    try {
      const stored = await chrome.storage.local.get("lastSeenWhatsNewVersion");
      seen = stored && stored.lastSeenWhatsNewVersion;
    } catch (e) {}
    setWhatsNewBellState(seen !== WHATS_NEW_VERSION);
  }

  function closeWhatsNew() {
    if (!whatsNewOpen) return;
    whatsNewOpen = false;
    document.removeEventListener("keydown", whatsNewKeydown);
    whatsNewModal.classList.add("closing");
    setTimeout(() => {
      whatsNewModal.classList.add("hidden");
      whatsNewModal.classList.remove("closing");
    }, 160);
    if (whatsNewLastFocused && whatsNewLastFocused.focus) whatsNewLastFocused.focus();
  }

  async function acknowledgeWhatsNew() {
    try {
      await chrome.storage.local.set({ lastSeenWhatsNewVersion: WHATS_NEW_VERSION });
      await chrome.storage.local.remove("pendingWhatsNewVersion");
      await refreshWhatsNewBell();
    } catch (e) {}
    closeWhatsNew();
  }

  function whatsNewKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      acknowledgeWhatsNew();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = whatsNewModal.querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === whatsNewModal)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function spotlightShareActions() {
    settingsView.classList.add("hidden");
    detailView.classList.add("hidden");
    mainView.classList.remove("hidden");
    const targets = [];
    if (exportPackageBtn) targets.push(exportPackageBtn, exportBtn);
    if (listsContainer) targets.push(...listsContainer.querySelectorAll(".list-actions .icon-btn, .share-btn"));
    if (!targets.length) return;
    targets.forEach((el) => {
      el.classList.remove("share-spotlight");
      void el.offsetWidth;
      el.classList.add("share-spotlight");
    });
    listsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  if (whatsNewCloseBtn) whatsNewCloseBtn.addEventListener("click", acknowledgeWhatsNew);
  if (whatsNewBtn) whatsNewBtn.addEventListener("click", () => { if (whatsNewModal) openWhatsNew(); });
  if (whatsNewGotIt) whatsNewGotIt.addEventListener("click", acknowledgeWhatsNew);
  if (whatsNewCta) {
    whatsNewCta.addEventListener("click", async () => {
      await acknowledgeWhatsNew();
      spotlightShareActions();
    });
  }
  if (whatsNewModal) {
    whatsNewModal.addEventListener("click", (e) => {
      if (e.target === whatsNewModal) acknowledgeWhatsNew();
    });
  }

  async function loadAll() {
    lists = await getLists();
    articles = await getArticles();
    await window.I18N.load();
    applyI18n();
    const st = await getSetting("activeListId");
    const savedId = st ? st.value : null;
    if (savedId && lists.some((l) => l.id === savedId)) activeListId = savedId;
    else activeListId = null;
    if (activeListId) await setSetting("activeListId", activeListId);
    await loadAiSettings();
    if (activeArticleId && !articles.some(a => a.id === activeArticleId)) {
      activeArticleId = null;
      detailView.classList.add("hidden");
      if (settingsView.classList.contains("hidden")) mainView.classList.remove("hidden");
    }
    render();
    if (whatsNewModal) await maybeShowWhatsNew();
    await refreshWhatsNewBell();
  }

  function applyI18n() {
    window.I18N.apply();
    updateWhatsNewBellLabel(whatsNewBtn ? whatsNewBtn.classList.contains("unread") : false);
  }

  function applyLangSelect() {
    langSelect.value = window.I18N.lang;
  }

  async function loadAiSettings() {
    const key = await getSetting("geminiApiKey");
    aiApiKey = key ? key.value : "";
    const model = await getSetting("geminiModel");
    aiModel = model && model.value && !/^gemini-2\.0-/.test(model.value) ? model.value : "gemini-2.5-flash";
    const autoSummary = await getSetting("autoSummary");
    aiToggle.checked = !!(autoSummary && autoSummary.value);
    apiKeyInput.value = aiApiKey;
    aiSetupGuide.open = !aiApiKey;
    populateModelSelect([aiModel], aiModel);
  }

  async function loadGeminiModels(key) {
    modelStatus.className = "status muted";
    modelStatus.textContent = t("modelStatusLoading");
    if (loadModelsBtn.disabled) return;
    loadModelsBtn.disabled = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const models = [];
      let pageToken = "";
      do {
        const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
        url.searchParams.set("pageSize", "1000");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const resp = await fetch(url.href, { headers: { "x-goog-api-key": key }, signal: controller.signal });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const json = await resp.json();
        models.push(...(json.models || []));
        pageToken = json.nextPageToken || "";
      } while (pageToken);
      const names = [...new Set(models
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map(m => (m.name || "").replace(/^models\//, ""))
        .filter(n => /^gemini-/.test(n) && !/^gemini-2\.0-/.test(n)))].sort();
      populateModelSelect(names);
      modelStatus.className = "status success";
      modelStatus.textContent = t("modelStatusLoaded") + " " + names.length;
      return names;
    } catch (err) {
      modelStatus.className = "status error";
      modelStatus.textContent = t("modelLoadFailed") + (err.message || "");
      throw err;
    } finally {
      clearTimeout(timeout);
      loadModelsBtn.disabled = false;
    }
  }

  function populateModelSelect(names, selected) {
    const prev = selected || modelSelect.value;
    const list = [...new Set((names || []).filter(Boolean))];
    if (prev && !list.includes(prev)) list.unshift(prev);
    modelSelect.innerHTML = "";
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = aiModel || "";
      opt.textContent = aiModel || "";
      modelSelect.appendChild(opt);
      modelSelect.value = opt.value;
      return;
    }
    list.forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      modelSelect.appendChild(opt);
    });
    if (prev && list.includes(prev)) modelSelect.value = prev;
    else if (list.includes("gemini-2.5-flash")) modelSelect.value = "gemini-2.5-flash";
    else modelSelect.value = list[0];
  }

  function render() {
    renderListSelect();
    renderListDropdown();
    renderLists();
    document.querySelector("#libraryCount").textContent = articles.length;
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
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = t("allLists");
    if (!activeListId) allOpt.selected = true;
    listSelect.appendChild(allOpt);
    lists.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.id;
      opt.textContent = l.name;
      if (l.id === activeListId) opt.selected = true;
      listSelect.appendChild(opt);
    });
  }

  function listOptionItems() {
    if (!lists.length) {
      return [{ value: "", name: t("noListsOption"), count: 0, disabled: true }];
    }
    const items = [{ value: "", name: t("allLists"), count: articles.length }];
    lists.forEach((l) => {
      items.push({ value: l.id, name: l.name, count: articles.filter((a) => a.listId === l.id).length });
    });
    return items;
  }

  function renderListDropdown() {
    if (!listDropdownMenu) return;
    const items = listOptionItems();
    const noLists = !lists.length;
    listSelectBtn.disabled = noLists;
    const current =
      activeListId
        ? items.find((it) => it.value === activeListId)
        : items.find((it) => it.value === "");
    listSelectLabel.textContent = current ? current.name : (noLists ? t("noListsOption") : t("allLists"));
    listDropdownMenu.innerHTML = "";
    items.forEach((it, idx) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "list-dropdown-option";
      opt.id = "listDropdownOption" + idx;
      opt.setAttribute("role", "option");
      opt.dataset.value = it.value;
      opt.setAttribute("aria-selected", String(it.value === current.value));
      opt.disabled = !!it.disabled;
      const check = document.createElement("span");
      check.className = "list-dropdown-check";
      check.dataset.icon = "check";
      check.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "list-dropdown-name";
      name.textContent = it.name;
      name.dir = "auto";
      const count = document.createElement("span");
      count.className = "list-dropdown-count";
      count.textContent = String(it.count);
      opt.append(check, name, count);
      opt.addEventListener("click", () => {
        if (it.disabled) return;
        selectListOption(it.value);
      });
      listDropdownMenu.appendChild(opt);
    });
    if (noLists) {
      closeListDropdown();
    }
  }

  function selectListOption(value) {
    listSelect.value = value;
    listSelect.dispatchEvent(new Event("change", { bubbles: true }));
    closeListDropdown();
  }

  function openListDropdown() {
    if (!lists.length) return;
    listSelectBtn.setAttribute("aria-expanded", "true");
    listDropdownMenu.classList.remove("hidden");
    listDropdown.classList.add("open");
    const selected = listDropdownMenu.querySelector('[aria-selected="true"]');
    (selected || listDropdownMenu.firstElementChild)?.focus();
  }

  function closeListDropdown() {
    listSelectBtn.setAttribute("aria-expanded", "false");
    listDropdownMenu.classList.add("hidden");
    listDropdown.classList.remove("open");
  }

  function toggleListDropdown() {
    if (listDropdownMenu.classList.contains("hidden")) openListDropdown();
    else closeListDropdown();
  }

  function listName(id) {
    const l = lists.find((x) => x.id === id);
    return l ? l.name : t("noList");
  }

  function renderLists() {
    listsContainer.innerHTML = "";
    if (!lists.length) {
      listsContainer.appendChild(emptyState(t("emptyTitle"), t("emptyDescription")));
      return;
    }
    const visibleLists = activeListId
      ? lists.filter((l) => l.id === activeListId)
      : lists;

    visibleLists.forEach((list) => {
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

      const shareBtn = document.createElement("button");
      shareBtn.className = "icon-btn";
      setIcon(shareBtn, "send", t("shareCollection"));
      shareBtn.title = t("shareCollection");
      shareBtn.addEventListener("click", () => openShareCollectionModal(list.id));

      const editBtn = document.createElement("button");
      editBtn.className = "icon-btn";
      setIcon(editBtn, "pencil", t("editTitle"));
      editBtn.title = t("editTitle");
      editBtn.addEventListener("click", () => renameList(list.id));

      const delBtn = document.createElement("button");
      delBtn.className = "icon-btn danger";
      setIcon(delBtn, "trash-2", t("deleteListTitle"));
      delBtn.title = t("deleteListTitle");
      delBtn.addEventListener("click", () => removeList(list.id));

      actions.appendChild(shareBtn);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      const folder = document.createElement("span");
      folder.className = "folder-mark";
      folder.dataset.icon = "folder";
      folder.setAttribute("aria-hidden", "true");
      head.appendChild(folder);
      head.appendChild(name);
      head.appendChild(count);
      head.appendChild(actions);
      item.appendChild(head);

      if (!listArticles.length) {
        const hint = document.createElement("p");
        hint.className = "empty-list";
        hint.textContent = t("emptyList");
        item.appendChild(hint);
      }
      listArticles.forEach((a) => {
        item.appendChild(renderArticleRow(a));
      });

      listsContainer.appendChild(item);
    });

    if (searchQuery.trim() && !listsContainer.children.length) {
      listsContainer.appendChild(emptyState(t("noSearchResults"), "", "search"));
    }
    applyActiveRow();
  }

  function renderArticleRow(a) {
    const row = document.createElement("div");
    row.className = "article-item";
    row.dataset.id = a.id;

    const title = document.createElement("button");
    title.className = "article-title";
    title.textContent = a.title || t("noTitle");
    title.title = t("openView");
    title.addEventListener("click", () => showDetail(a));

    const openBtn = document.createElement("button");
    openBtn.className = "icon-btn";
    setIcon(openBtn, "arrow-up-right", t("openSource"));
    openBtn.title = t("openSource");
    openBtn.addEventListener("click", () => {
      if (a.url) chrome.tabs.create({ url: a.url });
    });

    const shareBtn = document.createElement("button");
    shareBtn.className = "icon-btn share-btn";
    setIcon(shareBtn, "send", t("shareArticle"));
    shareBtn.title = t("shareArticle");
    shareBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openShareArticleModal(a.id);
    });

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn danger";
    setIcon(delBtn, "trash-2", t("deleteArticleTitle"));
    delBtn.title = t("deleteArticleTitle");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeArticle(a.id);
    });

    const articleInfo = document.createElement("div");
    articleInfo.className = "article-info";
    articleInfo.appendChild(title);
    const source = document.createElement("div");
    source.className = "article-source";
    let host = "";
    try { host = new URL(a.url).hostname.replace(/^www\./, ""); } catch (_) {}
    const date = a.savedAt ? new Date(a.savedAt).toLocaleDateString(window.I18N.lang, { month: "short", day: "numeric" }) : "";
    source.textContent = [host, date].filter(Boolean).join(" · ");
    articleInfo.appendChild(source);
    row.appendChild(articleInfo);
    row.appendChild(openBtn);
    row.appendChild(shareBtn);
    row.appendChild(delBtn);
    return row;
  }

  /* ---------- Actions ---------- */

  function setSaveButtonState(icon, label) {
    saveBtn.dataset.icon = icon;
    saveBtn.textContent = label;
    saveBtn.title = label;
    saveBtn.setAttribute("aria-label", label);
  }

  function runSaveSuccess() {
    clearTimeout(saveFlashTimer);
    setSaveButtonState("check", t("savedMoment"));
    saveBtn.classList.add("save-success");
    saveFlashTimer = setTimeout(() => {
      if (saveBtn.dataset.icon !== "check") return;
      saveBtn.dataset.icon = "bookmark-plus";
      saveBtn.classList.remove("save-success");
      saveBtn.textContent = t("saveCurrent");
      saveBtn.title = t("saveCurrent");
      saveBtn.setAttribute("aria-label", t("saveCurrent"));
    }, 1500);
  }

  async function saveCurrentArticle() {
    if (saveBtn.disabled) return;
    clearTimeout(saveFlashTimer);
    saveStatus.className = "status";
    saveStatus.textContent = t("extracting");
    if (!activeListId) {
      saveStatus.className = "status error";
      saveStatus.textContent = t("createListFirst");
      return;
    }
    const destinationListId = activeListId;
    const includeSummary = aiToggle.checked;
    saveBtn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "EXTRACT_ARTICLE", lang: window.I18N.lang });
      if (!resp || !resp.ok) {
        const err = new Error((resp && resp.error) || t("extractError"));
        err.code = (resp && resp.code) || "";
        throw err;
      }

      const data = {
        title: resp.data.title,
        content: normalizeBody(resp.data.content, "text"),
        contentFormat: "text",
        url: resp.data.url,
      };

      articles = await getArticles();
      const existing = data.url && articles.find((a) => a.url && a.url === data.url);

      let article;
      if (existing) {
        const choice = await promptDuplicateSave();
        if (choice === "cancel") {
          saveStatus.className = "status";
          saveStatus.textContent = "";
          return;
        }
        if (choice === "update") {
          article = await updateArticle(existing.id, {
            title: data.title,
            content: data.content,
            contentFormat: data.contentFormat,
            url: data.url,
          });
        } else {
          article = await addArticle({ listId: destinationListId, ...data });
        }
      } else {
        article = await addArticle({ listId: destinationListId, ...data });
      }

      if (includeSummary) {
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
              await updateArticle(article.id, { summary: article.summary, summaryHtml: null, summaryHtmlSource: null });
              article.summaryHtml = null;
              article.summaryHtmlSource = null;
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
        runSaveSuccess();
      }
    } catch (err) {
      saveStatus.className = "status error";
      saveStatus.textContent = saveErrorMessage(err);
      console.warn("[Article Saver] save failed:", err && err.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  function saveErrorMessage(err) {
    const msg = (err && err.message) || "";
    if (err && err.code === "UNSUPPORTED_PAGE") return t("cantSaveThisPage");
    if (/(cannot be scripted|doesn't allow|not allowed|cannot access|cannot be accessed|gallery|chrome:\/\/|insecure|internal page)/i.test(msg)) {
      return t("cantSaveThisPage");
    }
    return t("saveGenericError");
  }

  async function onAddList() {
    const name = newListName.value.trim();
    if (!name) return;
    const created = await addList(name);
    await setSetting("activeListId", created.id);
    newListName.value = "";
    await loadAll();
  }

  function renameList(id) {
    const list = lists.find((l) => l.id === id);
    renameListId = id;
    renameInput.value = list ? list.name : "";
    applyI18n();
    renameModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      renameInput.focus();
      renameInput.select();
    });
  }

  async function submitRename() {
    const name = renameInput.value.trim();
    if (!name) { renameInput.focus(); return; }
    const id = renameListId;
    renameListId = null;
    renameModal.classList.add("hidden");
    await updateList(id, name);
    await loadAll();
  }

  function openConfirm({ titleKey, body }) {
    confirmModalTitle.setAttribute("data-i18n", titleKey);
    confirmModalTitle.textContent = t(titleKey);
    confirmModalBody.textContent = body;
    confirmModal.classList.remove("hidden");
    return new Promise((resolve) => { confirmResolve = resolve; });
  }

  function closeConfirm(result) {
    confirmModal.classList.add("hidden");
    if (confirmResolve) {
      const r = confirmResolve;
      confirmResolve = null;
      r(result);
    }
  }

  async function removeList(id) {
    const list = lists.find((l) => l.id === id);
    const ok = await openConfirm({
      titleKey: "deleteListTitle",
      body: t("deleteListConfirm") + (list ? list.name : "") + t("deleteListConfirmSuffix"),
    });
    if (ok) {
      await deleteList(id);
      await loadAll();
    }
  }

  async function removeArticle(id) {
    const ok = await openConfirm({ titleKey: "deleteArticleTitle", body: t("deleteArticleConfirm") });
    if (!ok) return;
    await deleteArticle(id);
    articles = await getArticles();
    if (activeArticleId === id) { activeArticleId = null; detailView.classList.add("hidden"); mainView.classList.remove("hidden"); }
    render();
  }

  async function exportExcel() {
    const exportListId = activeListId;
    const freshLists = await getLists();
    const freshArticles = await getArticles();
    const exportLists = exportListId ? freshLists.filter((list) => list.id === exportListId) : freshLists;
    const exportArticles = exportListId ? freshArticles.filter((article) => article.listId === exportListId) : freshArticles;
    const listFileName = exportListId && exportLists[0]
      ? String(exportLists[0].name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/g, "")
      : "";
    const fileName = listFileName ? listFileName + ".xlsx" : t("excelFileName");
    if (!exportArticles.length) {
      showToast(t("noArticlesExport"), "info");
      return;
    }
    try {
      setButtonBusy(exportExcelBtn, true, t("preparingExport"));
      const blob = await buildExcelBlob(exportArticles, exportLists);
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: "Excel Workbook",
            accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        showToast(t("exportSaved"), "success");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        showToast(t("exportSaved"), "success");
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // user cancelled
      showToast(t("exportError") + e.message, "error");
    } finally {
      setButtonBusy(exportExcelBtn, false);
    }
  }

  async function saveAiSettings() {
    const key = apiKeyInput.value.trim();
    await setSetting("geminiApiKey", key);
    aiApiKey = key;
    const model = modelSelect.value || "gemini-2.5-flash";
    await setSetting("geminiModel", model);
    aiModel = model;
    aiSetupGuide.open = !aiApiKey;
    showToast(t("aiSaved"), "success");
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
  // chat and full text scroll internally when there is not enough room. When
  // the lists are too short to fill the viewport, the detail column (and the
  // AI chat at its end) stretches down to the bottom of the page instead. It
  // is never shorter than the sum of each panel's own minimum height, so the
  // summary, notes and chat each keep their minimum without squeezing others.
  function fitDetailToLists() {
    if (!isFull) return;
    const mainH = mainView.getBoundingClientRect().height;
    const rect = detailBody.getBoundingClientRect();
    const minToBottom = window.innerHeight - rect.top - 16;

    let colMin = 0;
    const mid = detailBody.querySelector(".detail-mid");
    if (mid) {
      mid.querySelectorAll(".detail-summary, .notes-box, .chat-box").forEach((el) => {
        colMin += parseInt(getComputedStyle(el).minHeight, 10) || 0;
      });
      colMin += 24; // two 12px gaps between the three panels
    }
    const beforeMid = detailBody.offsetHeight - (mid ? mid.offsetHeight : 0);

    detailBody.style.height = Math.max(mainH, minToBottom, beforeMid + colMin, 240) + "px";
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
    return sanitizeHtml(html);
  }

  function showDetail(a) {
    detailBody.innerHTML = "";
    activeArticleId = a.id;
    applyActiveRow();
    const titleRow = document.createElement("div");
    titleRow.className = "detail-title-row";
    const title = document.createElement("div");
    title.className = "detail-title";
    title.textContent = a.title || t("noTitle");
    const titleEditBtn = document.createElement("button");
    titleEditBtn.type = "button";
    titleEditBtn.className = "icon-btn title-edit-btn";
    setIcon(titleEditBtn, "pencil", t("editTitleLabel"));
    titleEditBtn.title = t("editTitleLabel");
    titleEditBtn.addEventListener("click", () => {
      const current = titleRow.querySelector(".detail-title");
      if (!current) return;
      const input = document.createElement("input");
      input.className = "input detail-title-input";
      input.value = a.title || "";
      current.replaceWith(input);
      input.focus();
      input.select();

      const commit = async () => {
        const val = input.value.trim();
        const newTitle = val || t("noTitle");
        const div = document.createElement("div");
        div.className = "detail-title";
        if (val !== a.title) {
          a.title = val;
          await updateArticle(a.id, { title: newTitle });
          articles = await getArticles();
        }
        div.textContent = newTitle;
        input.replaceWith(div);
        renderLists();
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { input.value = a.title || ""; input.blur(); }
      });
      input.addEventListener("blur", commit);
    });
    titleRow.appendChild(title);
    titleRow.appendChild(titleEditBtn);

    const shareArticleBtn = document.createElement("button");
    shareArticleBtn.type = "button";
    shareArticleBtn.className = "icon-btn";
    setIcon(shareArticleBtn, "send", t("shareArticle"));
    shareArticleBtn.title = t("shareArticle");
    shareArticleBtn.addEventListener("click", () => openShareArticleModal(a.id));
    titleRow.appendChild(shareArticleBtn);

    const url = document.createElement("a");
    url.className = "detail-url";
    url.href = a.url;
    url.textContent = a.url;
    url.target = "_blank";
    url.rel = "noopener noreferrer";

    const metaBaseText = t("listOf") + listName(a.listId) + "  |  " + (a.savedAt ? new Date(a.savedAt).toLocaleString(window.I18N.lang) : "");
    const meta = document.createElement("div");
    meta.className = "status muted";
    meta.textContent = metaBaseText;
    meta.dataset.base = metaBaseText;

    const content = document.createElement("div");
    content.className = "detail-content";
    content.contentEditable = "true";
    content.spellcheck = false;
    content.dataset.placeholder = t("noBody");
    content.dir = detectDirection(a.content);
    content.innerHTML = normalizeBody(contentToHtml(a.content, a.contentFormat), "html");
    content.title = t("editHint");
    protectRichTextEditor(content);

    const saveContent = async () => {
      const html = sanitizeHtml(content.innerHTML);
      const val = normalizeBody(html);
      if (val === a.content) return;
      try {
        await updateArticle(a.id, { content: val, contentFormat: "html" });
        a.contentFormat = "html";
        a.content = val;
        articles = await getArticles();
        renderLists();
        meta.className = "status success";
        meta.textContent = meta.dataset.base + t("textSaved");
        setTimeout(() => { meta.className = "status muted"; meta.textContent = meta.dataset.base; }, 2500);
      } catch (e) {
        meta.className = "status error";
        meta.textContent = t("textSaveFailed") + e.message;
      }
    };
    let contentSavedRange = null;
    content.addEventListener("blur", saveContent);

    const contentPanel = document.createElement("div");
    contentPanel.className = "content-panel";

    const searchRow = document.createElement("div");
    searchRow.className = "content-search";
    const searchBox = document.createElement("input");
    searchBox.className = "input";
    searchBox.type = "search";
    searchBox.placeholder = t("contentSearchPlaceholder");
    const matchInfo = document.createElement("span");
    matchInfo.className = "match-info";
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "icon-btn";
    setIcon(prevBtn, "chevron-up", t("prevMatch"));
    prevBtn.title = t("prevMatch");
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "icon-btn";
    setIcon(nextBtn, "chevron-down", t("nextMatch"));
    nextBtn.title = t("nextMatch");
    searchRow.appendChild(searchBox);
    searchRow.appendChild(prevBtn);
    searchRow.appendChild(nextBtn);
    searchRow.appendChild(matchInfo);

    let marks = [];
    let currentIndex = -1;

    const clearHighlights = () => {
      marks = [];
      currentIndex = -1;
      matchInfo.textContent = "";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    };

    const updateMatchInfo = () => {
      if (!marks.length) {
        matchInfo.textContent = t("noMatches");
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
      }
      matchInfo.textContent = (currentIndex + 1) + "/" + marks.length;
      prevBtn.disabled = false;
      nextBtn.disabled = false;
    };

    const gotoMatch = (i) => {
      if (!marks.length) return;
      currentIndex = (i + marks.length) % marks.length;
      marks.forEach((m, idx) => m.classList.toggle("current", idx === currentIndex));
      marks[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
      updateMatchInfo();
    };

    const removeMarks = () => {
      const nodes = Array.from(content.querySelectorAll("mark"));
      nodes.forEach((m) => {
        const frag = document.createDocumentFragment();
        while (m.firstChild) frag.appendChild(m.firstChild);
        m.replaceWith(frag);
      });
    };

    const highlightNode = (node, query) => {
      const text = node.nodeValue;
      if (!text) return;
      const lower = text.toLowerCase();
      const ql = query.toLowerCase();
      const frag = document.createDocumentFragment();
      let last = 0;
      let idx;
      while ((idx = lower.indexOf(ql, last)) !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        last = idx + query.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      if (frag.childNodes.length && node.parentNode) node.parentNode.replaceChild(frag, node);
    };

    const applySearch = () => {
      const q = searchBox.value;
      removeMarks();
      if (!q) {
        content.contentEditable = "true";
        clearHighlights();
        return;
      }
      content.contentEditable = "false";
      const query = q.trim();
      if (query) {
        const nodes = [];
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          if (/[^\s]/.test(n.nodeValue)) nodes.push(n);
        }
        nodes.forEach((node) => highlightNode(node, query));
      }
      content.scrollTop = 0;
      marks = Array.from(content.querySelectorAll("mark"));
      currentIndex = -1;
      if (marks.length) gotoMatch(0);
      else clearHighlights();
    };

    searchBox.addEventListener("input", applySearch);
    searchBox.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });
    prevBtn.addEventListener("click", () => gotoMatch(currentIndex - 1));
    nextBtn.addEventListener("click", () => gotoMatch(currentIndex + 1));

    const captureContentRange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && content.contains(sel.anchorNode)) return sel.getRangeAt(0).cloneRange();
      return null;
    };
    const restoreContentRange = (rng) => {
      content.focus();
      if (rng) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(rng);
      }
    };
    const applyHighlight = (color) => {
      restoreContentRange(contentSavedRange);
      document.execCommand("hiliteColor", false, color.toUpperCase());
      content.focus();
    };

    const contentToolbar = document.createElement("div");
    contentToolbar.className = "content-toolbar";
    const markerLabel = document.createElement("span");
    markerLabel.className = "content-toolbar-label";
    markerLabel.textContent = t("highlight");
    contentToolbar.appendChild(markerLabel);
    const presetColors = ["#ffe58a", "#b5f7b0", "#b3e5fc", "#ffd0f0", "#ffcc80", "#d7b8ff"];
    presetColors.forEach((c) => {
      const sw = document.createElement("span");
      sw.className = "content-swatch";
      sw.style.background = c;
      sw.title = t("highlightColor") + " " + c;
      sw.addEventListener("mousedown", (e) => { e.preventDefault(); contentSavedRange = captureContentRange(); });
      sw.addEventListener("click", () => applyHighlight(c));
      contentToolbar.appendChild(sw);
    });
    const customColor = document.createElement("input");
    customColor.type = "color";
    customColor.className = "content-color";
    customColor.value = "#ffff00";
    customColor.title = t("highlightColor");
    customColor.addEventListener("mousedown", () => { contentSavedRange = captureContentRange(); });
    customColor.addEventListener("input", () => applyHighlight(customColor.value));
    contentToolbar.appendChild(customColor);
    const clearMarker = document.createElement("button");
    clearMarker.type = "button";
    clearMarker.className = "icon-btn notes-tb";
    setIcon(clearMarker, "eraser", t("removeHighlight"));
    clearMarker.title = t("removeHighlight");
    clearMarker.addEventListener("mousedown", (e) => { e.preventDefault(); contentSavedRange = captureContentRange(); });
    clearMarker.addEventListener("click", () => {
      restoreContentRange(contentSavedRange);
      document.execCommand("hiliteColor", false, "transparent");
      content.focus();
    });
    contentToolbar.appendChild(clearMarker);

    contentPanel.appendChild(searchRow);
    contentPanel.appendChild(contentToolbar);
    contentPanel.appendChild(content);

    detailBody.appendChild(titleRow);
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
    setIcon(regenBtn, "refresh-cw", t("regenerate"), false);
    const chatBtn = document.createElement("button");
    chatBtn.type = "button";
    chatBtn.className = "btn btn-secondary btn-small";
    setIcon(chatBtn, "messages-square", t("chatButton"), false);
    const summaryActions = document.createElement("div");
    summaryActions.className = "summary-actions";
    summaryActions.appendChild(chatBtn);
    summaryActions.appendChild(regenBtn);
    headRow.appendChild(sTitle);
    headRow.appendChild(summaryActions);
    summaryBox.appendChild(headRow);
    const sText = document.createElement("div");
    sText.className = "summary-text";
    if (a.summary) sText.innerHTML = a.summaryHtml && a.summaryHtmlSource === a.summary
      ? sanitizeHtml(a.summaryHtml) : renderMarkdown(a.summary);
    const sumStatus = document.createElement("div");
    sumStatus.className = "status muted";
    summaryActions.prepend(createHighlighter(sText, {
      label: t("aiSummary"),
      onSave: async () => {
        const html = sanitizeHtml(sText.innerHTML);
        const updated = await updateArticle(a.id, { summaryHtml: html, summaryHtmlSource: a.summary });
        if (!updated) throw new Error(t("highlightFailed"));
        a.summaryHtml = html;
        a.summaryHtmlSource = a.summary;
        articles = await getArticles();
        sumStatus.className = "status success";
        sumStatus.textContent = t("highlightSaved");
      },
      onError: (message) => { sumStatus.className = "status error"; sumStatus.textContent = message; },
    }));
    summaryBox.appendChild(sText);
    summaryBox.appendChild(sumStatus);
    const aiDisclosure = document.createElement("p");
    aiDisclosure.className = "section-description";
    aiDisclosure.textContent = t("aiDisclosure");
    summaryBox.appendChild(aiDisclosure);
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
        await updateArticle(a.id, { summary: resp.summary, summaryHtml: null, summaryHtmlSource: null });
        a.summaryHtml = null;
        a.summaryHtmlSource = null;
        articles = await getArticles();
        renderLists();
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
    protectRichTextEditor(notes);
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
      { icon: "bold", cmd: "bold", title: t("bold") },
      { icon: "italic", cmd: "italic", title: t("italic") },
      { icon: "list", cmd: "insertUnorderedList", title: t("bulletList") },
      { icon: "list-ordered", cmd: "insertOrderedList", title: t("numList") },
    ];
    for (const c of cmds) {
      const b = document.createElement("button");
      b.type = "button";
      setIcon(b, c.icon, c.title);
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
        const safeNotes = sanitizeHtml(notes.innerHTML);
        await updateArticle(a.id, { notes: safeNotes });
        a.notes = safeNotes;
        articles = await getArticles();
        renderLists();
        noteStatus.className = "status success";
        noteStatus.textContent = t("notesSaved");
        setTimeout(() => { noteStatus.textContent = ""; }, 2500);
      } catch (e) {
        noteStatus.className = "status error";
        noteStatus.textContent = t("noteSaveFailed") + e.message;
      }
    };
    notes.addEventListener("blur", saveNotes);
    toolbar.appendChild(createHighlighter(notes, {
      label: t("myNotes"),
      onSave: saveNotes,
      onError: (message) => { noteStatus.className = "status error"; noteStatus.textContent = message; },
    }));
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
    setIcon(chatSend, "send", t("send"), false);
    const chatRow = document.createElement("div");
    chatRow.className = "chat-input-row";
    chatRow.appendChild(chatInput);
    chatRow.appendChild(chatSend);

    const renderChat = () => {
      chatMessages.innerHTML = "";
      const chats = a.chat || [];
      const disclaimer = document.createElement("div");
      disclaimer.className = "chat-disclaimer";
      disclaimer.textContent = t("chatDisclaimer");
      chatMessages.appendChild(disclaimer);
      chats.forEach((m, idx) => {
        const div = document.createElement("div");
        div.className = "chat-msg " + (m.role === "user" ? "chat-user" : "chat-ai");
        div.innerHTML = renderMarkdown(m.text);
        div.title = t("chatDeleteHint");
        div.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openChatMenu(e, idx);
        });
        chatMessages.appendChild(div);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    };
    chatDeleteFn = async (idx) => {
      const arr = (a.chat || []).slice();
      if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return;
      arr.splice(idx, 1);
      a.chat = arr;
      try {
        await updateArticle(a.id, { chat: arr });
        articles = await getArticles();
        renderLists();
      } catch (err) {
        chatStatus.className = "status error";
        chatStatus.textContent = t("chatDeleteFailed") + err.message;
      }
      renderChat();
    };
    renderChat();

    const sendChat = async () => {
      if (chatSend.disabled) return;
      const text = chatInput.value.trim();
      if (!text) return;
      if (!aiApiKey) {
        chatStatus.className = "status error";
        chatStatus.textContent = t("noApiKeyChat");
        return;
      }
      chatSend.disabled = true;
      try {
        const chat = (a.chat || []).concat([{ role: "user", text }]);
        a.chat = chat;
        await updateArticle(a.id, { chat });
        articles = await getArticles();
        chatInput.value = "";
        renderChat();
        chatStatus.className = "status muted";
        chatStatus.textContent = t("aiThinking");
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
        renderLists();
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
    detailBody.appendChild(contentPanel);
    detailView.classList.remove("hidden");
    if (isFull) {
      fitDetailToLists();
    }
    if (!isFull) {
      mainView.classList.add("hidden");
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  /* ---------- Sharing & Import Functions ---------- */

  function getListArticles(listId) {
    return articles.filter((a) => a.listId === listId);
  }

  const SHARE_CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  const SHARE_OPTION_ICONS = {
    scIncludeArticles: "library",
    scIncludeNotes: "sticky-note",
    scIncludeTags: "tag",
    scIncludeAISummary: "sparkles",
    scIncludeAIChat: "messages-square",
    scIncludeHighlights: "highlighter",
    saIncludeNotes: "sticky-note",
    saIncludeHighlights: "highlighter",
    saIncludeAISummary: "sparkles",
    saIncludeAIChat: "messages-square",
    rpIncludeNotes: "sticky-note",
    rpIncludeTags: "tag",
    rpIncludeAISummary: "sparkles",
    rpIncludeAIChat: "messages-square",
    rpIncludeHighlights: "highlighter",
  };

  function renderShareOptionChips(grid, options) {
    grid.innerHTML = options.map(opt => `
      <label class="share-option-chip" data-option="${opt.id}">
        <input type="checkbox" id="${opt.id}" ${opt.checked ? "checked" : ""} ${opt.locked ? "disabled" : ""} />
        <span class="option-icon" data-icon="${SHARE_OPTION_ICONS[opt.id] || "bookmark-plus"}" aria-hidden="true"></span>
        <span class="option-text">
          <span class="option-label">${t(opt.key)}</span>
          <span class="option-count" data-option-count="${opt.id}"></span>
        </span>
        <span class="chip-check" aria-hidden="true">${SHARE_CHECK_SVG}</span>
      </label>
    `).join("");
  }

  function syncOptionCounts(grid, counts) {
    grid.querySelectorAll("[data-option-count]").forEach((el) => {
      const value = counts[el.dataset.optionCount];
      el.textContent = value != null && value > 0 ? String(value) : "";
    });
  }

  function buildCollectionMeta(articles) {
    const lang = window.I18N?.lang || "";
    const en = lang === "en";
    const unit = (count, plural) => {
      const s = t(plural);
      if (count === 1 && en) return s.replace(/s$/, "");
      return s;
    };
    const parts = [];
    parts.push(`${articles.length} ${unit(articles.length, "shareUnitArticles")}`);
    const notes = articles.filter((a) => a.notes).length;
    if (notes) parts.push(`${notes} ${unit(notes, "shareUnitNotes")}`);
    const tags = new Set(articles.flatMap((a) => a.tags || [])).size;
    if (tags) parts.push(`${tags} ${unit(tags, "shareUnitTags")}`);
    return parts.join(" · ");
  }

  function autoGrowNote(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight + 2, 150) + "px";
  }

  function articleNotesCount(a) {
    return Array.isArray(a.notes) ? a.notes.length : (a.notes ? 1 : 0);
  }

  function unitCountLabel(count, singular, plural) {
    return count === 1 ? singular : plural;
  }

  function openShareCollectionModal(listId) {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;
    shareCollectionId = listId;
    const listArticles = getListArticles(listId);

    // Set name and stats
    shareCollectionName.textContent = list.name;
    shareCollectionStats.textContent = buildCollectionMeta(listArticles);

    shareCollectionNote.value = list.description || "";
    shareCollectionNote.classList.remove("share-note-filled");

    // Render options
    const options = [
      { id: "scIncludeArticles", key: "shareOptionsArticles", checked: true, locked: true },
      { id: "scIncludeNotes", key: "shareOptionsNotes", checked: true },
      { id: "scIncludeTags", key: "shareOptionsTags", checked: true },
      { id: "scIncludeAISummary", key: "shareOptionsAISummary", checked: true },
      { id: "scIncludeAIChat", key: "shareOptionsAIChat", checked: true },
      { id: "scIncludeHighlights", key: "shareOptionsHighlights", checked: true },
    ];

    renderShareOptionChips(shareCollectionOptionsGrid, options);
    syncOptionCounts(shareCollectionOptionsGrid, {
      scIncludeArticles: listArticles.length,
      scIncludeNotes: listArticles.filter(a => a.notes).length,
      scIncludeTags: new Set(listArticles.flatMap(a => a.tags || [])).size,
      scIncludeHighlights: listArticles.reduce((sum, a) => sum + (a.highlights?.length || 0), 0),
    });

    // Render message preview
    renderShareMessagePreview("collection", list.name, shareCollectionNote.value);

    // Update summary
    updateShareCollectionSummary(listArticles);

    // Add checkbox listeners
    shareCollectionOptionsGrid.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => updateShareCollectionSummary(listArticles));
    });

    shareModal.classList.remove("hidden");
  }

  function updateShareCollectionSummary(listArticles) {
    syncOptionCounts(shareCollectionOptionsGrid, {
      scIncludeArticles: listArticles.length,
      scIncludeNotes: listArticles.filter(a => a.notes).length,
      scIncludeTags: new Set(listArticles.flatMap(a => a.tags || [])).size,
      scIncludeHighlights: listArticles.reduce((sum, a) => sum + (a.highlights?.length || 0), 0),
    });

    // Re-render message preview with current options
    renderShareMessagePreview("collection", lists.find(l => l.id === shareCollectionId)?.name || "", shareCollectionNote.value);
  }

  function closeShareModal() {
    shareModal.classList.add("hidden");
    shareCollectionId = null;
  }

  async function handleShareCollection() {
    if (!shareCollectionId) return;
    const list = lists.find((l) => l.id === shareCollectionId);
    if (!list) return;
    const listArticles = getListArticles(shareCollectionId);

    const includeNotes = document.getElementById("scIncludeNotes")?.checked ?? true;
    const includeAISummary = document.getElementById("scIncludeAISummary")?.checked ?? true;
    const includeAIChat = document.getElementById("scIncludeAIChat")?.checked ?? true;
    const includeTags = document.getElementById("scIncludeTags")?.checked ?? true;
    const includeHighlights = document.getElementById("scIncludeHighlights")?.checked ?? true;
    const description = shareCollectionNote.value.trim();

    try {
      setButtonBusy(shareNativeBtn, true, t("preparingExport"));
      const packageData = window.PackageService.buildPackage({
        packageType: "collection",
        list,
        articles: listArticles,
        description,
        includeNotes,
        includeTags,
        includeHighlights,
        includeAISummary,
        includeAIChat,
      });

      const blob = await window.PackageService.serializePackage(packageData);
      const fileName = window.PackageService.getFileName(list.name, "collection");

      closeShareModal();

      const result = await window.ShareService.sharePackage(blob, fileName, "collection", list.name, {
        preferNative: true,
        description,
      });

      if (result.success) {
        if (result.method === "download") {
          showShareReadyModal("collection", result.instructions, result.fileName, list.name);
        } else {
          showToast(t("shareComplete"), "success");
        }
      } else if (result.reason !== "user-cancelled") {
        showToast(t("shareFailed"), "error");
      }
    } catch (err) {
      console.error("Collection share failed", err);
      showToast(t("shareFailedFriendly"), "error");
    } finally {
      setButtonBusy(shareNativeBtn, false);
    }
  }

  function openShareArticleModal(articleId) {
    const article = articles.find((a) => a.id === articleId);
    if (!article) return;
    shareArticleId = articleId;

    // Set name and stats
    let articleHost = "";
    try { if (article.url) articleHost = new URL(article.url).hostname; } catch (e) {}
    shareArticleName.textContent = article.title;
    shareArticleStats.textContent = articleHost;

    shareArticleNote.value = "";
    shareArticleNote.classList.remove("share-note-filled");

    // Render options
    const options = [
      { id: "saIncludeNotes", key: "shareOptionsNotes", checked: true },
      { id: "saIncludeHighlights", key: "shareOptionsHighlights", checked: true },
      { id: "saIncludeAISummary", key: "shareOptionsAISummary", checked: true },
      { id: "saIncludeAIChat", key: "shareOptionsAIChat", checked: true },
    ];

    renderShareOptionChips(shareArticleOptionsGrid, options);
    syncOptionCounts(shareArticleOptionsGrid, {
      saIncludeNotes: articleNotesCount(article),
      saIncludeHighlights: article.highlights?.length || 0,
    });

    // Render message preview
    renderShareMessagePreview("article", article.title, shareArticleNote.value);

    // Add checkbox listeners
    shareArticleOptionsGrid.querySelectorAll("input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => updateShareArticleSummary(article));
    });

    shareArticleModal.classList.remove("hidden");
  }

  function updateShareArticleSummary(article) {
    syncOptionCounts(shareArticleOptionsGrid, {
      saIncludeNotes: articleNotesCount(article),
      saIncludeHighlights: article.highlights?.length || 0,
    });

    // Update message preview
    renderShareMessagePreview("article", article.title, shareArticleNote.value);
  }

  function closeShareArticleModal() {
    shareArticleModal.classList.add("hidden");
    shareArticleId = null;
  }

  async function handleShareArticle() {
    if (!shareArticleId) return;
    const article = articles.find((a) => a.id === shareArticleId);
    if (!article) return;

    const includeNotes = document.getElementById("saIncludeNotes")?.checked ?? true;
    const includeHighlights = document.getElementById("saIncludeHighlights")?.checked ?? true;
    const includeAISummary = document.getElementById("saIncludeAISummary")?.checked ?? true;
    const includeAIChat = document.getElementById("saIncludeAIChat")?.checked ?? true;
    const description = shareArticleNote.value.trim();

    try {
      setButtonBusy(shareArticleNativeBtn, true, t("preparingExport"));
      const packageData = window.PackageService.buildPackage({
        packageType: "article",
        list: { id: "temp", name: article.title, collectionId: "temp_" + crypto.randomUUID(), createdAt: Date.now() },
        articles: [article],
        description,
        includeNotes,
        includeHighlights,
        includeTags: false,
        includeAISummary,
        includeAIChat,
      });

      const blob = await window.PackageService.serializePackage(packageData);
      const fileName = window.PackageService.getFileName(article.title, "article");

      closeShareArticleModal();

      const result = await window.ShareService.sharePackage(blob, fileName, "article", article.title, {
        preferNative: true,
        description,
      });

      if (result.success) {
        if (result.method === "download") {
          showShareReadyModal("article", result.instructions, result.fileName, article.title);
        } else {
          showToast(t("shareComplete"), "success");
        }
      } else if (result.reason !== "user-cancelled") {
        showToast(t("shareFailed"), "error");
      }
    } catch (err) {
      console.error("Article share failed", err);
      showToast(t("shareFailedFriendly"), "error");
    } finally {
      setButtonBusy(shareArticleNativeBtn, false);
    }
  }

  function renderShareMessagePreview(packageType, collectionName, description) {
    const instructions = window.ShareService.getShareInstructions(packageType, collectionName, description);
    const targetContentEl = packageType === "article" ? shareArticleMessageContent
      : packageType === "research-pack" ? researchPackMessageContent
      : shareMessageContent;
    const targetCopyBtn = packageType === "article" ? shareArticleCopyBtn
      : packageType === "research-pack" ? researchPackCopyBtn
      : shareCopyBtn;
    const noteLabel = window.I18N.t("shareDescriptionNote");
    const noteText = String(description || "").trim();
    const noteTextarea = packageType === "article" ? shareArticleNote
      : packageType === "research-pack" ? researchPackDescription
      : shareCollectionNote;

    if (!targetContentEl || !targetCopyBtn) return;

    // Reset copy button state
    targetCopyBtn.classList.remove("copied");

    // Mirror the filled/unfilled state of the note field
    noteTextarea?.classList.toggle("share-note-filled", !!noteText);

    // Render the ready message as a recipient preview with clear hierarchy
    const paragraphs = instructions
      .split(/\n{2,}/)
      .map(para => para.trim())
      .filter(Boolean);

    const itemName = String(collectionName || "").trim();

    targetContentEl.innerHTML = paragraphs.map((para, index) => {
      if (noteText && para === noteLabel) {
        return `<p class="share-note-label-p">${escapeHtml(para)}</p>`;
      }
      if (noteText && para === noteText) {
        return `<div class="share-note-box">${escapeHtml(para).replace(/\n/g, "<br>")}</div>`;
      }

      let cls = "share-para";
      if (index === 0) cls = "share-greet";
      else if (index === paragraphs.length - 1) cls = "share-signoff";

      let body = escapeHtml(para).replace(/\n/g, "<br>");

      if (itemName && para.includes(itemName) && cls === "share-para") {
        body = body.split(escapeHtml(itemName)).join(`<strong class="share-em">${escapeHtml(itemName)}</strong>`);
      }

      if (/https?:\/\//.test(para)) {
        cls = "share-install";
        const match = para.match(/https?:\/\/[^\s]+/);
        if (match) {
          const url = match[0];
          body = escapeHtml(para.slice(0, match.index))
            + `<span class="share-url">${escapeHtml(url)}</span>`
            + escapeHtml(para.slice(match.index + url.length));
        }
      }

      return `<p class="${cls}">${body}</p>`;
    }).join("");

    const badgeIcon = packageType === "article" ? "bookmark-plus"
      : packageType === "research-pack" ? "book-open-check"
      : "folder";
    const badgeName = itemName
      || (packageType === "article" ? escapeHtml(t("noTitle"))
        : packageType === "research-pack" ? escapeHtml(t("researchPack"))
        : escapeHtml(t("researchPack")));
    targetContentEl.innerHTML =
      `<div class="share-item-badge">`
      + `<span class="share-item-badge-icon" data-icon="${badgeIcon}" aria-hidden="true"></span>`
      + `<span class="share-item-badge-name" dir="auto">${badgeName}</span>`
      + `</div>` + targetContentEl.innerHTML;

    // Add copy handler
    const newBtn = targetCopyBtn.cloneNode(true);
    targetCopyBtn.parentNode.replaceChild(newBtn, targetCopyBtn);

    if (packageType === "article") {
      shareArticleCopyBtn = newBtn;
    } else if (packageType === "research-pack") {
      researchPackCopyBtn = newBtn;
    } else {
      shareCopyBtn = newBtn;
    }

    newBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(instructions);
        newBtn.classList.add("copied");
        setTimeout(() => newBtn.classList.remove("copied"), 1500);
      } catch (e) {
        showToast(t("copyFailed"), "error");
      }
    });
  }

  function openResearchPackModal(preSelectedArticles = null) {
    const selectedListId = listSelect.value || null;
    researchPackArticles = window.PackageService.resolveResearchPackArticles(preSelectedArticles, articles, selectedListId);
    if (!researchPackArticles.length) {
      showToast(t("noArticlesSelected"), "error");
      return;
    }

    researchPackName.value = "";
    researchPackDescription.value = "";
    researchPackDescription.classList.remove("share-note-filled");

    const options = [
      { id: "rpIncludeNotes", key: "shareOptionsNotes", checked: true },
      { id: "rpIncludeAISummary", key: "shareOptionsAISummary", checked: true },
      { id: "rpIncludeAIChat", key: "shareOptionsAIChat", checked: true },
      { id: "rpIncludeTags", key: "shareOptionsTags", checked: true },
      { id: "rpIncludeHighlights", key: "shareOptionsHighlights", checked: true },
    ];

    if (researchPackOptionsGrid) {
      renderShareOptionChips(researchPackOptionsGrid, options);
      const packArticles = researchPackArticles;
      syncOptionCounts(researchPackOptionsGrid, {
        rpIncludeNotes: packArticles.filter(a => a.notes).length,
        rpIncludeTags: new Set(packArticles.flatMap(a => a.tags || [])).size,
        rpIncludeHighlights: packArticles.reduce((sum, a) => sum + (a.highlights?.length || 0), 0),
      });
    }

    updateResearchPackCount();
    renderResearchPackMessagePreview();

    researchPackModal.classList.remove("hidden");
  }

  function updateResearchPackCount() {
    const count = researchPackArticles.length;
    if (researchPackArticleCount) researchPackArticleCount.textContent = t("articlesSelected", { count });
  }

  function renderResearchPackMessagePreview() {
    renderShareMessagePreview("research-pack", researchPackName.value.trim() || t("researchPack"), researchPackDescription.value.trim());
  }

  function closeResearchPackModal() {
    researchPackModal.classList.add("hidden");
    researchPackArticles = [];
  }

  async function handleCreateResearchPack() {
    const name = researchPackName.value.trim() || t("researchPack");
    const description = researchPackDescription.value.trim();
    const grp = (id) => document.getElementById(id)?.checked ?? true;
    const includeTags = grp("rpIncludeTags");
    const includeNotes = grp("rpIncludeNotes");
    const includeAISummary = grp("rpIncludeAISummary");
    const includeAIChat = grp("rpIncludeAIChat");
    const includeHighlights = grp("rpIncludeHighlights");

    try {
      setButtonBusy(researchPackCreateBtn, true, t("preparingExport"));
      const tempList = {
        id: "temp",
        name,
        collectionId: "pack_" + crypto.randomUUID(),
        createdAt: Date.now(),
        description,
      };

      const packageData = window.PackageService.buildPackage({
        packageType: "research-pack",
        list: tempList,
        articles: researchPackArticles,
        description,
        includeNotes,
        includeTags,
        includeHighlights,
        includeAISummary,
        includeAIChat,
      });

      const blob = await window.PackageService.serializePackage(packageData);
      const fileName = window.PackageService.getFileName(name, "research-pack");

      closeResearchPackModal();

      const result = await window.ShareService.sharePackage(blob, fileName, "research-pack", name, {
        preferNative: true,
        description,
      });

      if (result.success) {
        if (result.method === "download") {
          showShareReadyModal("research-pack", result.instructions, result.fileName, name);
        } else {
          showToast(t("shareComplete"), "success");
        }
      } else if (result.reason !== "user-cancelled") {
        showToast(t("shareFailed"), "error");
      }
    } catch (err) {
      console.error("Research pack share failed", err);
      showToast(t("shareFailedFriendly"), "error");
    } finally {
      setButtonBusy(researchPackCreateBtn, false);
    }
  }

  function openArticleSelectModal() {
    const selectedListId = listSelect.value || null;
    pickerArticlePool = window.PackageService.selectArticlesForList(articles, selectedListId);
    if (!pickerArticlePool.length) {
      showToast(t("noArticlesSelected"), "error");
      return;
    }

    articleSelectionMode = true;
    selectedArticleIds.clear();
    pickerSearchQuery = "";
    pickerActiveFilter = "all";
    if (articleSelectSearch) articleSelectSearch.value = "";
    updateFilterChips();
    renderPickerMetadata();
    renderArticleSelectionList();
    articleSelectModal.classList.remove("hidden");
  }

  function renderPickerMetadata() {
    const listIds = new Set(pickerArticlePool.map((a) => a.listId));
    let sourceName = t("allLists");
    if (listIds.size === 1) {
      const list = lists.find((l) => l.id === pickerArticlePool[0].listId);
      sourceName = list ? list.name : t("noList");
    }
    articleSelectSource.textContent = sourceName;
    articleSelectSource.setAttribute("dir", "auto");
    articleSelectAvailable.textContent = t("pickerArticlesAvailable", { count: pickerArticlePool.length });
  }

  function pickerSearchMatches(a, q) {
    const title = String(a.title || "").toLowerCase();
    let domain = "";
    try { domain = a.url ? new URL(a.url).hostname.toLowerCase() : ""; } catch (_) { /* ignore */ }
    const authors = (a.authors || []).join(" ").toLowerCase();
    const tags = (a.tags || []).join(" ").toLowerCase();
    return title.includes(q) || domain.includes(q) || authors.includes(q) || tags.includes(q);
  }

  function pickerFilterMatches(a, filter) {
    if (filter === "notes") return !!a.notes;
    if (filter === "summary") return !!a.summary;
    if (filter === "tags") return !!(a.tags && a.tags.length);
    return true;
  }

  function filteredPickerArticles() {
    const q = pickerSearchQuery.trim().toLowerCase();
    let out = pickerArticlePool;
    if (pickerActiveFilter !== "all") out = out.filter((a) => pickerFilterMatches(a, pickerActiveFilter));
    if (q) out = out.filter((a) => pickerSearchMatches(a, q));
    return out;
  }

  function renderArticleSelectionList() {
    articleSelectionList.innerHTML = "";
    const items = filteredPickerArticles();

    if (!items.length) {
      articleSelectionList.classList.add("hidden");
      pickerEmptyState.textContent = t("pickerNoResults");
      pickerEmptyState.classList.remove("hidden");
      return;
    }
    pickerEmptyState.classList.add("hidden");
    articleSelectionList.classList.remove("hidden");

    const articlesByList = new Map();
    for (const article of items) {
      const list = lists.find((l) => l.id === article.listId);
      const listName = list ? list.name : t("noList");
      if (!articlesByList.has(listName)) articlesByList.set(listName, []);
      articlesByList.get(listName).push(article);
    }
    const sortedLists = Array.from(articlesByList.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    if (sortedLists.length === 1) {
      sortedLists[0][1].forEach((a) => renderPickerRow(articleSelectionList, a));
    } else {
      for (const [listName, articles] of sortedLists) {
        const group = document.createElement("div");
        group.className = "picker-group";
        const head = document.createElement("div");
        head.className = "picker-group-head";
        const name = document.createElement("span");
        name.className = "picker-group-name";
        name.setAttribute("dir", "auto");
        name.textContent = listName;
        let unit = t("articlesCount");
        const lang = (window.I18N && window.I18N.lang) || "";
        if (articles.length === 1 && lang.startsWith("en") && unit.endsWith("s")) unit = unit.slice(0, -1);
        const count = document.createElement("span");
        count.className = "picker-group-count";
        count.textContent = articles.length + " " + unit;
        head.appendChild(name);
        head.appendChild(count);
        const itemsContainer = document.createElement("div");
        itemsContainer.className = "picker-group-items";
        articles.forEach((a) => renderPickerRow(itemsContainer, a));
        group.appendChild(head);
        group.appendChild(itemsContainer);
        articleSelectionList.appendChild(group);
      }
    }
    refreshSelectedRows();
    updateSelectionCount();
  }

  function renderPickerRow(container, article) {
    const item = document.createElement("label");
    item.className = "picker-item";
    item.dataset.id = article.id;
    const isSelected = selectedArticleIds.has(article.id);
    if (isSelected) item.classList.add("selected");
    const title = article.title || t("noTitle");
    let domain = "";
    try { domain = article.url ? new URL(article.url).hostname : ""; } catch (_) { /* ignore */ }
    const date = article.savedAt
      ? " · " + new Date(article.savedAt).toLocaleDateString(window.I18N.lang, { year: "numeric", month: "numeric", day: "numeric" })
      : "";
    const dateLtr = /[\u0590-\u05FF\u0621-\u064A\u2026]/.test(date) ? "" : " ltr-keep";
    item.innerHTML = `
      <input type="checkbox" class="article-selection-checkbox" data-id="${article.id}" ${isSelected ? "checked" : ""} aria-label="${escapeHtml(title)}" />
      <span class="picker-item-main">
        <span class="picker-item-title" dir="auto" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="picker-item-meta">
          ${domain ? `<span class="picker-item-domain" dir="ltr">${escapeHtml(domain)}</span>` : ""}<span class="picker-item-date${dateLtr}">${escapeHtml(date)}</span>
        </span>
      </span>
    `;
    const checkbox = item.querySelector(".article-selection-checkbox");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedArticleIds.add(article.id);
      else selectedArticleIds.delete(article.id);
      item.classList.toggle("selected", checkbox.checked);
      updateSelectionCount();
    });
    container.appendChild(item);
  }

  function refreshSelectedRows() {
    articleSelectionList.querySelectorAll(".picker-item").forEach((row) => {
      const cb = row.querySelector(".article-selection-checkbox");
      row.classList.toggle("selected", !!(cb && cb.checked));
    });
  }

  function updateFilterChips() {
    if (!pickerFilterChips) return;
    pickerFilterChips.querySelectorAll(".picker-chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.filter === pickerActiveFilter);
    });
  }

  function updateSelectionCount() {
    const n = selectedArticleIds.size;
    selectionCount.textContent = t("pickerSelectedCount", { count: n });
    if (n === 0) {
      selectAllBtn.classList.remove("hidden");
      deselectAllBtn.classList.add("hidden");
    } else {
      selectAllBtn.classList.add("hidden");
      deselectAllBtn.classList.remove("hidden");
    }
    if (pickerEmptyHint) pickerEmptyHint.classList.toggle("picker-empty-hint-visible", n === 0);
    updatePickerCta();
  }

  function updatePickerCta() {
    const n = selectedArticleIds.size;
    if (n === 0) {
      articleSelectConfirmBtn.disabled = true;
      articleSelectConfirmBtn.textContent = t("createResearchPack");
      return;
    }
    articleSelectConfirmBtn.disabled = false;
    let unit = t("articlesCount");
    const lang = (window.I18N && window.I18N.lang) || "";
    if (n === 1 && lang.startsWith("en") && unit.endsWith("s")) unit = unit.slice(0, -1);
    articleSelectConfirmBtn.textContent = t("pickerCreateAction") + " " + n + " " + unit;
  }

  function selectAllArticles() {
    articleSelectionList.querySelectorAll(".article-selection-checkbox").forEach((cb) => {
      cb.checked = true;
      selectedArticleIds.add(cb.dataset.id);
    });
    refreshSelectedRows();
    updateSelectionCount();
  }

  function deselectAllArticles() {
    selectedArticleIds.clear();
    articleSelectionList.querySelectorAll(".article-selection-checkbox").forEach((cb) => {
      cb.checked = false;
    });
    refreshSelectedRows();
    updateSelectionCount();
  }

  function confirmArticleSelection() {
    if (selectedArticleIds.size === 0) {
      showToast(t("atLeastOneArticle"), "error");
      return;
    }
    const selectedArticles = articles.filter((a) => selectedArticleIds.has(a.id));
    closeArticleSelectModal();
    openResearchPackModal(selectedArticles);
  }

  function closeArticleSelectModal() {
    articleSelectModal.classList.add("hidden");
    articleSelectionMode = false;
    selectedArticleIds.clear();
    pickerArticlePool = [];
  }

  function openImportModal() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".articlesaver,application/json";
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await handleImportFile(file);
    });
    input.click();
  }

  function showShareReadyModal(packageType, instructions, fileName, itemName = "") {
    shareReadyInstructions = instructions || "";
    shareReadyFileName = fileName || "";
    shareReadyItemName = itemName || "";
    const titleKey = packageType === "article" ? "shareReadyTitleArticle"
      : packageType === "research-pack" ? "shareReadyTitleResearchPack"
      : "shareReadyTitleCollection";
    shareReadyTitle.textContent = t(titleKey);
    shareReadyFile.textContent = shareReadyFileName
      ? t("shareReadyFile", { fileName: shareReadyFileName })
      : "";
    shareReadyFeedback.classList.remove("visible");
    if (shareReadyCancelBtn) shareReadyCancelBtn.textContent = t("cancelButton");
    shareReadyModal.classList.remove("hidden");
  }

  function closeShareReadyModal() {
    shareReadyModal.classList.add("hidden");
    shareReadyInstructions = "";
    shareReadyFileName = "";
    shareReadyItemName = "";
  }

  function summarizeSharedContent(pkg) {
    const arts = (pkg && pkg.articles) || [];
    const labels = [];
    if (arts.some((a) => a.notes)) labels.push(t("shareOptionsNotes"));
    if (arts.some((a) => Array.isArray(a.tags) && a.tags.length)) labels.push(t("shareOptionsTags"));
    if (arts.some((a) => a.summary)) labels.push(t("shareOptionsAISummary"));
    if (arts.some((a) => Array.isArray(a.chat) && a.chat.length)) labels.push(t("shareOptionsAIChat"));
    return labels;
  }

  function renderSharedChipsHtml() {
    return summarizeSharedContent(pendingImportPackage)
      .map((label) => `<span class="content-chip">${escapeHtml(label)}</span>`)
      .join("");
  }

  function renderTransferMetrics(packageData) {
    const preview = pendingImportPreview || {};
    const articles = packageData.articles || [];
    const metrics = [
      [articles.length, t("shareOptionsArticles")],
      [preview.summaries ?? articles.filter((article) => article.summary).length, t("shareOptionsAISummary")],
      [preview.chats ?? articles.filter((article) => article.chat?.length).length, t("shareOptionsAIChat")],
      [preview.highlights ?? articles.reduce((sum, article) => sum + (article.highlights?.length || 0), 0), t("shareOptionsHighlights")],
    ];
    return `<div class="transfer-metrics">${metrics.map(([value, label]) =>
      `<div class="transfer-metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`
    ).join("")}</div>`;
  }

  async function handleImportFile(file) {
    try {
      setButtonBusy(importBtn, true, t("importingNow"));
      const packageData = await window.PackageService.parsePackageFile(file);
      const existingList = await getListByCollectionId(packageData.manifest.collectionId);
      const allLocalArticles = await getArticles();
      const localArticles = existingList
        ? allLocalArticles.filter((article) => article.listId === existingList.id)
        : [];

      pendingImportPackage = packageData;
      pendingImportPreview = window.PackageService.createImportPreview(packageData, existingList, localArticles);

      // Determine package type
      const isSingleArticle = packageData.manifest.packageType === "article";

      if (isSingleArticle) {
        // Single article - show list selection modal
        await showArticleImportTargetModal(packageData);
      } else {
        // Collection - show import preview with merge/new options
        renderImportPreview(pendingImportPreview);
        importModal.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Shared file import failed", err);
      showToast(t("importFailedFriendly"), "error");
    } finally {
      setButtonBusy(importBtn, false);
    }
  }

  async function showArticleImportTargetModal(packageData) {
    const lists = await getLists();
    const article = packageData.articles[0];

    const listOptions = lists.map(l =>
      `<option value="${l.id}">${escapeHtml(l.name)}</option>`
    ).join("");
    const needsNewList = lists.length === 0;

    importModalBody.innerHTML = `
      <div class="import-preview">
        <div class="transfer-hero">
          <div class="transfer-hero-icon" aria-hidden="true">↓</div>
          <div><div class="transfer-hero-title">${t("importArticleTitle", { title: escapeHtml(article.title) })}</div><div class="transfer-hero-subtitle">${t("sharedWithYou")}</div></div>
        </div>
        ${renderTransferMetrics(packageData)}
        <div class="preview-section">
          <div class="preview-title">${t("importPreviewChangesTitle")}</div>
          <div class="preview-stats">${t("importPreviewStats", { articleCount: 1, notesCount: article.notes ? 1 : 0, tagsCount: (article.tags || []).length })}</div>
        </div>
        ${renderSharedChipsHtml() ? `<div class="preview-section">
          <div class="preview-title">${t("sharedWithYou")}</div>
          <div class="preview-chips">${renderSharedChipsHtml()}</div>
        </div>` : ""}
        <div class="preview-section">
          <label class="label" style="margin-bottom: 8px; display: block;">${t("selectTargetList")}</label>
          <select id="importTargetList" class="select" style="margin-bottom: 12px;">
            ${listOptions}
            <option value="__new__" ${needsNewList ? "selected" : ""}>${t("createNewListOption")}</option>
          </select>
          <div id="newListNameContainer" class="${needsNewList ? "" : "hidden"}">
            <label class="label" for="importNewListName">${t("importListNameLabel")}</label>
            <input id="importNewListName" class="input" type="text" placeholder="${t("newListPlaceholder")}" maxlength="120" />
            <div class="field-help">${t("importListNameHelp")}</div>
          </div>
        </div>
        <div class="preview-section privacy-note">
          <strong>${t("localOnly")}</strong>
          <div>${t("noServerInvolved")}</div>
        </div>
      </div>
    `;
    applyI18n();
    importModal.classList.remove("hidden");

    // Handle new list option
    const targetListSelect = document.getElementById("importTargetList");
    const newListContainer = document.getElementById("newListNameContainer");
    const newListNameInput = document.getElementById("importNewListName");
    if (needsNewList) newListNameInput.value = packageData.collection.name;
    targetListSelect.addEventListener("change", () => {
      newListContainer.classList.toggle("hidden", targetListSelect.value !== "__new__");
      if (targetListSelect.value === "__new__" && !newListNameInput.value.trim()) {
        newListNameInput.value = packageData.collection.name || article.title || "";
      }
    });

    // Route confirm action through the shared handler
    importConfirmAction = async () => {
      const targetListId = targetListSelect.value;
      let finalListId = targetListId;

      if (targetListId === "__new__") {
        const newListName = document.getElementById("importNewListName").value.trim();
        if (!newListName) {
          showToast(t("enterListName"), "error");
          return;
        }
        const newList = await addList(newListName);
        finalListId = newList.id;
      }

      await importSingleArticle(packageData, finalListId);
      closeImportModal();
    };

    importConfirmBtn.classList.remove("hidden");
    importMergeBtn.classList.add("hidden");
    importConfirmBtn.textContent = t("addToMyList");
  }

  async function importSingleArticle(packageData, targetListId) {
    const article = packageData.articles[0];
    const localArticles = await getArticles();

    // Check for duplicates by URL or DOI
    let duplicateArticle = null;
    if (article.url) {
      duplicateArticle = localArticles.find(a => a.url === article.url && a.listId === targetListId);
    }
    if (!duplicateArticle && article.doi) {
      duplicateArticle = localArticles.find(a => a.doi === article.doi && a.listId === targetListId);
    }

    if (duplicateArticle) {
      // Show conflict resolution modal
      const choice = await showArticleConflictModal(duplicateArticle, article);
      if (choice === "cancel") return;
      if (choice === "skip") {
        showToast(t("articleSkipped"), "info");
        return;
      }
      if (choice === "merge") {
        const merged = window.MergeService.createMergedArticle(duplicateArticle, article, {
          preferLocalContent: true,
          preferImportedSummary: true,
        });
        await applyArticleImport(targetListId, [merged], []);
        showToast(t("mergeSuccess"), "success");
        await loadAll();
        return;
      }
      // choice === "duplicate" - proceed with a separate record.
    }

    await addArticle({
      listId: targetListId,
      title: article.title,
      content: article.content,
      contentFormat: article.contentFormat,
      url: article.url,
      doi: article.doi,
      authors: article.authors,
      publication: article.publication,
      tags: article.tags,
      notes: article.notes,
      highlights: article.highlights,
      summary: article.summary,
      summaryHtml: article.summaryHtml,
      summaryHtmlSource: article.summaryHtmlSource,
      chat: article.chat,
      savedAt: article.savedAt,
    });

    showToast(t("importSuccess"), "success");
    await loadAll();
  }

  function showArticleConflictModal(existing, incoming) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal-overlay";
      modal.innerHTML = `
        <div class="modal conflict-modal" role="dialog" aria-modal="true" aria-labelledby="conflictTitle">
          <div class="modal-title" id="conflictTitle">${t("articleAlreadyExists")}</div>
          <div class="modal-body">
            <p>${t("articleExistsInList", { title: escapeHtml(existing.title) })}</p>
            <div class="conflict-version">
              <strong>${t("existingVersion")}</strong><br>
              <small>Saved: ${new Date(existing.savedAt).toLocaleString()}</small><br>
              <small>URL: ${escapeHtml(existing.url || "")}</small>
            </div>
            <div class="conflict-version conflict-version-incoming">
              <strong>${t("incomingVersion")}</strong><br>
              <small>Saved: ${new Date(incoming.savedAt).toLocaleString()}</small><br>
              <small>URL: ${escapeHtml(incoming.url || "")}</small>
            </div>
          </div>
          <div class="modal-actions conflict-actions">
            <button id="conflictSkip" class="btn btn-secondary">${t("skipArticle")}</button>
            <button id="conflictDuplicate" class="btn btn-secondary">${t("createDuplicate")}</button>
            <button id="conflictMerge" class="btn btn-primary">${t("mergeToLatest")}</button>
            <button id="conflictCancel" class="btn btn-quiet">${t("cancelButton")}</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      applyI18n();
      modal.querySelector("#conflictMerge").focus();

      modal.querySelector("#conflictSkip").onclick = () => { modal.remove(); resolve("skip"); };
      modal.querySelector("#conflictDuplicate").onclick = () => { modal.remove(); resolve("duplicate"); };
      modal.querySelector("#conflictMerge").onclick = () => {
        modal.remove();
        // Merge: update existing with incoming data
        resolve("merge");
      };
      modal.querySelector("#conflictCancel").onclick = () => { modal.remove(); resolve("cancel"); };
      modal.onclick = (e) => { if (e.target === modal) { modal.remove(); resolve("cancel"); } };
    });
  }

  function renderImportPreview(preview) {
    const t = (key, params) => window.I18N.t(key, params);
    const isNew = preview.isNewCollection;
    const matchingList = lists.find((list) => list.collectionId === preview.collectionId) || null;
    const selectedTargetId = matchingList?.id || "__new__";
    const listOptions = lists.map((list) =>
      `<option value="${escapeHtml(list.id)}" ${list.id === selectedTargetId ? "selected" : ""}>${escapeHtml(list.name)}</option>`
    ).join("");

    let html = `
      <div class="import-preview">
        <div class="transfer-hero">
          <div class="transfer-hero-icon" aria-hidden="true">↓</div>
          <div><div class="transfer-hero-title">${escapeHtml(preview.collectionName)}</div><div class="transfer-hero-subtitle">${t("importChooseDestination")}</div></div>
        </div>
        ${renderTransferMetrics(pendingImportPackage)}
        <div class="preview-section import-destination-section">
          <label class="label" for="importTargetList">${t("importDestinationLabel")}</label>
          <select id="importTargetList" class="select">
            <option value="__new__" ${selectedTargetId === "__new__" ? "selected" : ""}>${t("createNewListOption")}</option>
            ${listOptions}
          </select>
          <div class="field-help">${t("importDestinationHelp")}</div>
          <div id="importCollectionNameWrap" class="import-new-list-fields ${selectedTargetId === "__new__" ? "" : "hidden"}">
            <label class="label" for="importCollectionName">${t("importListNameLabel")}</label>
            <input id="importCollectionName" class="input" type="text" maxlength="120" />
            <div class="field-help">${t("importListNameHelp")}</div>
          </div>
        </div>
        <div class="preview-section">
          <div class="preview-title">${escapeHtml(isNew ? t("importPreviewNewCollection", { collectionName: preview.collectionName }) : t("importPreviewExistingCollection", { collectionName: preview.collectionName }))}</div>
          <div class="preview-stats">${escapeHtml(t("importPreviewStats", { articleCount: preview.articleCount, notesCount: preview.newNotes + preview.updatedNotes, tagsCount: preview.newTags.length + preview.existingTags.length }))}</div>
        </div>
        ${renderSharedChipsHtml() ? `<div class="preview-section">
          <div class="preview-title">${t("sharedWithYou")}</div>
          <div class="preview-chips">${renderSharedChipsHtml()}</div>
        </div>` : ""}
    `;

    if (!isNew) {
      html += `
        <div class="preview-section">
          <div class="preview-title">${t("importPreviewChangesTitle")}</div>
          <div class="preview-changes">
            ${preview.newArticles > 0 ? `<div class="change-item change-new">${t("importPreviewNewArticles", { count: preview.newArticles })}</div>` : `<div class="change-item change-skipped">${t("noNewArticles")}</div>`}
            ${preview.updatedNotes > 0 ? `<div class="change-item change-updated">${t("importPreviewUpdatedNotes", { count: preview.updatedNotes })}</div>` : ""}
            ${preview.newTags.length > 0 ? `<div class="change-item change-new">${t("importPreviewNewTags", { count: preview.newTags.length })}</div>` : ""}
          </div>
        </div>
      `;
    }

    html += `
        <div class="preview-section privacy-note">
          <strong>${t("localOnly")}</strong>
          <div>${t("noServerInvolved")}</div>
        </div>
      </div>
    `;

    importModalBody.innerHTML = html;
    applyI18n();
    const collectionNameInput = document.getElementById("importCollectionName");
    if (collectionNameInput) collectionNameInput.value = preview.collectionName || "";
    const targetListSelect = document.getElementById("importTargetList");
    const collectionNameWrap = document.getElementById("importCollectionNameWrap");
    const updateImportAction = () => {
      const creatingList = targetListSelect.value === "__new__";
      collectionNameWrap.classList.toggle("hidden", !creatingList);
      importConfirmBtn.textContent = t(creatingList ? "importCreateAndAdd" : "importAddToExisting");
    };
    targetListSelect.addEventListener("change", updateImportAction);
    updateImportAction();

    importConfirmBtn.classList.remove("hidden");
    importMergeBtn.classList.add("hidden");
  }

  async function handleImportConfirm() {
    if (!pendingImportPackage) return;
    const targetListId = document.getElementById("importTargetList")?.value || "__new__";
    const requestedListName = document.getElementById("importCollectionName")?.value.trim() || "";
    if (targetListId === "__new__" && !requestedListName) {
      showToast(t("enterListName"), "error");
      document.getElementById("importCollectionName")?.focus();
      return;
    }
    try {
      setButtonBusy(importConfirmBtn, true, t("importingNow"));
      await performImport(
        pendingImportPackage,
        targetListId !== "__new__",
        requestedListName,
        targetListId === "__new__" ? "" : targetListId
      );
      closeImportModal();
      await loadAll();
      showToast(t(targetListId === "__new__" ? "importSuccess" : "importExistingSuccess"), "success");
    } catch (err) {
      console.error("Collection import failed", err);
      showToast(t("importFailedFriendly"), "error");
    } finally {
      setButtonBusy(importConfirmBtn, false);
    }
  }

  async function handleImportMerge() {
    if (!pendingImportPackage) return;
    try {
      setButtonBusy(importMergeBtn, true, t("importingNow"));
      await performImport(pendingImportPackage, true);
      closeImportModal();
      await loadAll();
      showToast(t("mergeSuccess"), "success");
    } catch (err) {
      console.error("Collection merge failed", err);
      showToast(t("mergeFailedFriendly"), "error");
    } finally {
      setButtonBusy(importMergeBtn, false);
    }
  }

  function closeImportModal() {
    importModal.classList.add("hidden");
    pendingImportPackage = null;
    pendingImportPreview = null;
    importConfirmAction = null;
  }

  async function performImport(packageData, isMerge, requestedListName = "", targetListId = "") {
    const manifest = packageData.manifest;
    const collectionData = packageData.collection;
    const articlesData = packageData.articles;

    const existingList = await getListByCollectionId(manifest.collectionId);
    const selectedList = targetListId
      ? (await getLists()).find((list) => list.id === targetListId) || null
      : null;
    if (targetListId && !selectedList) throw new Error("The destination list no longer exists");
    const mergeTarget = selectedList || (isMerge ? existingList : null);
    const allLocalArticles = await getArticles();
    const localArticles = mergeTarget
      ? allLocalArticles.filter((article) => article.listId === mergeTarget.id)
      : [];

    if (mergeTarget) {
      const result = window.MergeService.mergeCollection(mergeTarget, collectionData, articlesData, localArticles, {
        preferLocalContent: true,
        preferImportedSummary: true,
      });

      const updates = result.articles.filter((article) => localArticles.some((local) => local.id === article.id));
      const additions = result.articles.filter((article) => !localArticles.some((local) => local.id === article.id));
      await applyArticleImport(mergeTarget.id, updates, additions);
    } else {
      const newList = await addList(requestedListName || collectionData.name);
      try {
        const importedCollectionId = existingList
          ? "imported_" + crypto.randomUUID()
          : collectionData.collectionId;
        await updateList(newList.id, { collectionId: importedCollectionId, description: collectionData.description });
        await applyArticleImport(newList.id, [], articlesData);
      } catch (error) {
        await deleteList(newList.id);
        throw error;
      }
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /* ---------- Events ---------- */

  if (isFull) {
    window.addEventListener("resize", () => {
      if (!detailView.classList.contains("hidden")) fitDetailToLists();
    });
  }

  saveBtn.addEventListener("click", saveCurrentArticle);

  // New list inline
  newListBtn.addEventListener("click", () => {
    newListInline.classList.remove("hidden");
    newListBtn.classList.add("hidden");
    newListName.focus();
    newListName.value = "";
  });
  cancelNewListBtn.addEventListener("click", () => {
    newListInline.classList.add("hidden");
    newListBtn.classList.remove("hidden");
  });
  confirmNewListBtn.addEventListener("click", async () => {
    const name = newListName.value.trim();
    if (!name) return;
    const created = await addList(name);
    await setSetting("activeListId", created.id);
    newListName.value = "";
    newListInline.classList.add("hidden");
    newListBtn.classList.remove("hidden");
    await loadAll();
  });
  newListName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmNewListBtn.click();
    } else if (e.key === "Escape") {
      cancelNewListBtn.click();
    }
  });

  // Export dropdown
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = exportDropdownMenu.classList.toggle("show");
    exportBtn.setAttribute("aria-expanded", String(isOpen));
  });
  exportExcelBtn.addEventListener("click", () => {
    exportDropdownMenu.classList.remove("show");
    exportBtn.setAttribute("aria-expanded", "false");
    exportExcel();
  });
  exportPackageBtn.addEventListener("click", () => {
    exportDropdownMenu.classList.remove("show");
    exportBtn.setAttribute("aria-expanded", "false");
    openArticleSelectModal();
  });

  document.addEventListener("click", () => {
    exportDropdownMenu.classList.remove("show");
    exportBtn.setAttribute("aria-expanded", "false");
  });

  saveApiBtn.addEventListener("click", () => saveAiSettings().catch(showStorageError));
  aiToggle.addEventListener("change", () => setSetting("autoSummary", aiToggle.checked).catch(showStorageError));
  loadModelsBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim() || aiApiKey;
    if (!key) {
      modelStatus.className = "status error";
      modelStatus.textContent = t("needApiKey");
      return;
    }
    loadGeminiModels(key).catch(() => {});
  });
  aiSettingsToggle.setAttribute("aria-controls", "aiSettings");
  aiSettingsToggle.setAttribute("aria-expanded", "false");
  aiSettingsToggle.addEventListener("click", () => {
    const hidden = aiSettings.classList.toggle("hidden");
    aiSettingsToggle.setAttribute("aria-expanded", String(!hidden));
  });
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
  backBtn.addEventListener("click", () => {
    detailView.classList.add("hidden");
    mainView.classList.remove("hidden");
  });

  listSelect.addEventListener("change", async () => {
    activeListId = listSelect.value || null;
    if (activeListId) await setSetting("activeListId", activeListId);
    else await setSetting("activeListId", null);
    renderListDropdown();
    renderLists();
  });

  listSelectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleListDropdown();
  });
  listDropdownMenu.addEventListener("click", (e) => e.stopPropagation());
  listDropdownMenu.addEventListener("keydown", (e) => {
    const opts = [...listDropdownMenu.querySelectorAll(".list-dropdown-option:not(:disabled)")];
    if (!opts.length) return;
    const i = opts.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length];
      next.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      opts[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      opts[opts.length - 1].focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!listDropdownMenu.classList.contains("hidden") && !listDropdown.contains(e.target)) {
      closeListDropdown();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !listDropdownMenu.classList.contains("hidden")) {
      e.preventDefault();
      closeListDropdown();
      listSelectBtn.focus();
    }
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

  importBtn.addEventListener("click", openImportModal);

  // Share modal events - ensure elements exist before attaching
  if (shareNativeBtn) shareNativeBtn.addEventListener("click", handleShareCollection);
  if (shareCancelBtn) shareCancelBtn.addEventListener("click", closeShareModal);
  if (shareModal) shareModal.addEventListener("click", (e) => { if (e.target === shareModal) closeShareModal(); });

  if (shareArticleNativeBtn) shareArticleNativeBtn.addEventListener("click", handleShareArticle);
  if (shareArticleCancelBtn) shareArticleCancelBtn.addEventListener("click", closeShareArticleModal);
  if (shareArticleModal) shareArticleModal.addEventListener("click", (e) => { if (e.target === shareArticleModal) closeShareArticleModal(); });
  if (shareReadyCancelBtn) shareReadyCancelBtn.addEventListener("click", closeShareReadyModal);
  if (shareReadyModal) shareReadyModal.addEventListener("click", (e) => { if (e.target === shareReadyModal) closeShareReadyModal(); });

  if (shareCollectionNote) {
    autoGrowNote(shareCollectionNote);
    shareCollectionNote.addEventListener("input", () => {
      autoGrowNote(shareCollectionNote);
      const list = lists.find((l) => l.id === shareCollectionId);
      if (list) renderShareMessagePreview("collection", list.name, shareCollectionNote.value);
    });
  }
  if (shareArticleNote) {
    autoGrowNote(shareArticleNote);
    shareArticleNote.addEventListener("input", () => {
      autoGrowNote(shareArticleNote);
      const article = articles.find((a) => a.id === shareArticleId);
      if (article) renderShareMessagePreview("article", article.title, shareArticleNote.value);
    });
  }
  if (researchPackDescription) {
    autoGrowNote(researchPackDescription);
    researchPackDescription.addEventListener("input", () => {
      autoGrowNote(researchPackDescription);
      renderResearchPackMessagePreview();
    });
  }

  shareReadyCopyBtn.addEventListener("click", async () => {
    if (!shareReadyInstructions) return;
    const copied = await window.ShareService.copyToClipboard(shareReadyInstructions);
    if (copied.success) {
      shareReadyFeedback.classList.add("visible");
      clearTimeout(shareReadyFeedbackTimer);
      shareReadyFeedbackTimer = setTimeout(() => shareReadyFeedback.classList.remove("visible"), 1500);
    } else {
      showToast(t("copyFailed"), "error");
    }
  });
  shareReadyEmailBtn.addEventListener("click", () => {
    const attachNote = t("emailShareAttachNote", { fileName: shareReadyFileName });
    const body = shareReadyFileName
      ? shareReadyInstructions + "\n\n" + attachNote
      : shareReadyInstructions;
    window.ShareService.openEmailFallback(t("emailShareSubject", { name: shareReadyItemName || "Article Saver" }), body);
    closeShareReadyModal();
  });
  if (shareReadyModal) shareReadyModal.addEventListener("click", (e) => { if (e.target === shareReadyModal) closeShareReadyModal(); });

  if (researchPackName) researchPackName.addEventListener("input", renderResearchPackMessagePreview);
  if (researchPackDescription) researchPackDescription.addEventListener("input", renderResearchPackMessagePreview);
  researchPackCreateBtn.addEventListener("click", handleCreateResearchPack);
  researchPackCancelBtn.addEventListener("click", closeResearchPackModal);
  researchPackModal.addEventListener("click", (e) => { if (e.target === researchPackModal) closeResearchPackModal(); });

  importConfirmBtn.addEventListener("click", () => {
    if (importConfirmAction) {
      importConfirmAction();
    } else {
      handleImportConfirm();
    }
  });
  importMergeBtn.addEventListener("click", handleImportMerge);
  importCancelBtn.addEventListener("click", closeImportModal);
  importModal.addEventListener("click", (e) => { if (e.target === importModal) closeImportModal(); });

  selectAllBtn.addEventListener("click", selectAllArticles);
  deselectAllBtn.addEventListener("click", deselectAllArticles);
  articleSelectConfirmBtn.addEventListener("click", confirmArticleSelection);
  articleSelectCancelBtn.addEventListener("click", closeArticleSelectModal);
  articleSelectModal.addEventListener("click", (e) => { if (e.target === articleSelectModal) closeArticleSelectModal(); });

  articleSelectSearch.addEventListener("input", () => {
    pickerSearchQuery = articleSelectSearch.value;
    renderArticleSelectionList();
  });

  pickerFilterChips.addEventListener("click", (e) => {
    const chip = e.target.closest(".picker-chip");
    if (!chip) return;
    pickerActiveFilter = chip.dataset.filter;
    updateFilterChips();
    renderArticleSelectionList();
  });

  /* Toast notification system */
  const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="17" height="17" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="17" height="17" aria-hidden="true"><path d="M12 8v5" /><path d="M12 16.5h.01" /></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="17" height="17" aria-hidden="true"><path d="M12 11v5" /><path d="M12 7.5h.01" /></svg>',
  };

  function setButtonBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (label) button.textContent = label;
    } else {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (button.dataset.idleHtml) {
        button.innerHTML = button.dataset.idleHtml;
        delete button.dataset.idleHtml;
      }
    }
  }

  function showToast(message, type = "info", actionLabel = null, actionCallback = null) {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-container";
      document.body.appendChild(container);
    }
    container.querySelectorAll(".toast").forEach((existingToast) => dismissToast(existingToast));
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;
    const messageEl = document.createElement("span");
    messageEl.className = "toast-message";
    messageEl.textContent = String(message || "");
    toast.append(icon, messageEl);
    if (actionLabel) {
      const action = document.createElement("button");
      action.className = "toast-action";
      action.dataset.toastAction = "";
      action.textContent = String(actionLabel);
      toast.appendChild(action);
    }
    const close = document.createElement("button");
    close.className = "toast-close";
    close.dataset.toastClose = "";
    close.setAttribute("aria-label", t("close"));
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>';
    toast.appendChild(close);
    container.appendChild(toast);
    if (actionLabel && actionCallback) {
      toast.querySelector("[data-toast-action]").addEventListener("click", () => {
        actionCallback();
        dismissToast(toast);
      });
    }
    toast.querySelector("[data-toast-close]").addEventListener("click", () => dismissToast(toast));
    toast._hideTimer = setTimeout(() => dismissToast(toast), type === "error" ? 5500 : 3400);
  }

  function dismissToast(toast) {
    clearTimeout(toast._hideTimer);
    if (toast.classList.contains("toast-leaving")) return;
    toast.classList.add("toast-leaving");
    setTimeout(() => toast.remove(), 250);
  }

  function showStorageError(error) {
    showToast(t("errorPrefix") + error.message, "error");
  }

  loadAll().then(() => {
    if (isFull && articles.length) showDetail(articles[0]);
  }).catch(showStorageError);

  // refresh when panel becomes visible
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadAll().catch(showStorageError);
  });
})();
