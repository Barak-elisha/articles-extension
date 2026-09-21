const DB_NAME = "article-saver-db";
const DB_VERSION = 2;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion;

      if (!db.objectStoreNames.contains("lists")) {
        const lists = db.createObjectStore("lists", { keyPath: "id" });
        lists.createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains("articles")) {
        const articles = db.createObjectStore("articles", { keyPath: "id" });
        articles.createIndex("listId", "listId", { unique: false });
        articles.createIndex("savedAt", "savedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }

      if (oldVersion < 2) {
        const transaction = e.target.transaction;
        const listsStore = transaction.objectStore("lists");
        const cursorRequest = listsStore.openCursor();
        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const list = cursor.value;
            if (!list.collectionId) {
              list.collectionId = generateCollectionId();
              cursor.update(list);
            }
            cursor.continue();
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function generateCollectionId() {
  return "col_" + crypto.randomUUID();
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    const out = fn(os);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqToPromise(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/* ---------------- Lists ---------------- */

async function getLists() {
  const db = await openDB();
  return tx(db, "lists", "readonly", (os) => reqToPromise(os.getAll()));
}

async function getListByCollectionId(collectionId) {
  const db = await openDB();
  return tx(db, "lists", "readonly", (os) => {
    return new Promise((resolve, reject) => {
      const request = os.getAll();
      request.onsuccess = () => {
        const lists = request.result;
        const found = lists.find((l) => l.collectionId === collectionId);
        resolve(found || null);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

async function addList(name) {
  const db = await openDB();
  const list = { id: "list_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), name, createdAt: Date.now(), collectionId: generateCollectionId() };
  await tx(db, "lists", "readwrite", (os) => os.add(list));
  return list;
}

async function updateList(id, nameOrPatch) {
  const db = await openDB();
  return tx(db, "lists", "readwrite", (os) => {
    return new Promise((resolve, reject) => {
      const get = os.get(id);
      get.onsuccess = () => {
        const list = get.result;
        if (list) {
          if (typeof nameOrPatch === "string") {
            list.name = nameOrPatch;
          } else if (nameOrPatch && typeof nameOrPatch === "object") {
            Object.assign(list, nameOrPatch);
          }
          os.put(list);
        }
        resolve(list);
      };
      get.onerror = () => reject(get.error);
    });
  });
}

async function deleteList(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["lists", "articles"], "readwrite");
    transaction.objectStore("lists").delete(id);
    const request = transaction.objectStore("articles").index("listId").openCursor(IDBKeyRange.only(id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error("List deletion aborted"));
    transaction.onerror = () => reject(transaction.error);
  });
  return id;
}

/* ---------------- Articles ---------------- */

async function getArticles() {
  const db = await openDB();
  return tx(db, "articles", "readonly", (os) => reqToPromise(os.getAll()));
}

async function getArticleByUrl(url) {
  const db = await openDB();
  return tx(db, "articles", "readonly", (os) => {
    return new Promise((resolve, reject) => {
      const request = os.getAll();
      request.onsuccess = () => {
        const articles = request.result;
        const found = articles.find((a) => a.url && a.url === url);
        resolve(found || null);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

async function getArticleByDoi(doi) {
  const db = await openDB();
  return tx(db, "articles", "readonly", (os) => {
    return new Promise((resolve, reject) => {
      const request = os.getAll();
      request.onsuccess = () => {
        const articles = request.result;
        const found = articles.find((a) => a.doi && a.doi === doi);
        resolve(found || null);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

async function getArticlesByList(listId) {
  const db = await openDB();
  return tx(db, "articles", "readonly", (os) => {
    return new Promise((resolve, reject) => {
      const idx = os.index("listId");
      const r = idx.getAll(listId);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  });
}

async function addArticle({ listId, title, content, url, contentFormat = "text", doi, authors, publication, tags, notes, highlights, summary, summaryHtml, summaryHtmlSource, chat, savedAt }) {
  const db = await openDB();
  const article = {
    id: "art_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    listId,
    title: title || (window.I18N ? window.I18N.t("noTitle") : "(no title)"),
    content: content || "",
    contentFormat,
    url: url || "",
    savedAt: savedAt || Date.now(),
    doi: doi || "",
    authors: authors || [],
    publication: publication || "",
    tags: tags || [],
    notes: notes || "",
    highlights: highlights || [],
    summary: summary || "",
    summaryHtml: summaryHtml || "",
    summaryHtmlSource: summaryHtmlSource || "",
    chat: chat || [],
  };
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(["lists", "articles"], "readwrite");
    let missingList = false;
    const request = transaction.objectStore("lists").get(listId);
    request.onsuccess = () => {
      if (!request.result) { missingList = true; transaction.abort(); return; }
      transaction.objectStore("articles").add(article);
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(new Error(missingList ? "The destination list no longer exists" : "Article save aborted"));
    transaction.onerror = () => reject(transaction.error);
  });
  return article;
}

async function deleteArticle(id) {
  const db = await openDB();
  await tx(db, "articles", "readwrite", (os) => os.delete(id));
  return id;
}

async function updateArticle(id, patch) {
  const db = await openDB();
  return tx(db, "articles", "readwrite", (os) => {
    return new Promise((resolve, reject) => {
      const get = os.get(id);
      get.onsuccess = () => {
        const art = get.result;
        if (!art) { resolve(null); return; }
        Object.assign(art, patch);
        os.put(art);
        resolve(art);
      };
      get.onerror = () => reject(get.error);
    });
  });
}

// Apply a package import in one IndexedDB transaction so a malformed record or
// storage failure cannot leave half of a collection imported.
async function applyArticleImport(listId, updates, additions) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["lists", "articles"], "readwrite");
    const listsStore = transaction.objectStore("lists");
    const articlesStore = transaction.objectStore("articles");
    let failure = null;
    const listRequest = listsStore.get(listId);
    listRequest.onsuccess = () => {
      if (!listRequest.result) {
        failure = new Error("The destination list no longer exists");
        transaction.abort();
        return;
      }
      for (const article of updates || []) articlesStore.put({ ...article, listId });
      for (const input of additions || []) {
        const article = {
          ...input,
          id: "art_" + Date.now() + "_" + crypto.randomUUID(),
          listId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        articlesStore.add(article);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(failure || transaction.error || new Error("Import aborted"));
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ---------------- Settings ---------------- */

async function getSetting(key) {
  const db = await openDB();
  return tx(db, "settings", "readonly", (os) => reqToPromise(os.get(key)));
}

async function setSetting(key, value) {
  const db = await openDB();
  return tx(db, "settings", "readwrite", (os) => os.put({ key, value }));
}
