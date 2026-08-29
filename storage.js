const DB_NAME = "article-saver-db";
const DB_VERSION = 1;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
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

async function addList(name) {
  const db = await openDB();
  const list = { id: "list_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), name, createdAt: Date.now() };
  await tx(db, "lists", "readwrite", (os) => os.add(list));
  return list;
}

async function updateList(id, name) {
  const db = await openDB();
  return tx(db, "lists", "readwrite", (os) => {
    return new Promise((resolve, reject) => {
      const get = os.get(id);
      get.onsuccess = () => {
        const list = get.result;
        if (list) {
          list.name = name;
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
  await tx(db, "lists", "readwrite", (os) => os.delete(id));
  // remove its articles
  const articles = await getArticlesByList(id);
  await tx(db, "articles", "readwrite", (os) => {
    articles.forEach((a) => os.delete(a.id));
  });
  return id;
}

/* ---------------- Articles ---------------- */

async function getArticles() {
  const db = await openDB();
  return tx(db, "articles", "readonly", (os) => reqToPromise(os.getAll()));
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

async function addArticle({ listId, title, content, url }) {
  const db = await openDB();
  const article = {
    id: "art_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    listId,
    title: title || "(ללא כותרת)",
    content: content || "",
    url: url || "",
    savedAt: Date.now(),
  };
  await tx(db, "articles", "readwrite", (os) => os.add(article));
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

/* ---------------- Settings ---------------- */

async function getSetting(key) {
  const db = await openDB();
  return tx(db, "settings", "readonly", (os) => reqToPromise(os.get(key)));
}

async function setSetting(key, value) {
  const db = await openDB();
  return tx(db, "settings", "readwrite", (os) => os.put({ key, value }));
}
