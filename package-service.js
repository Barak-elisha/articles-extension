(function () {
  const PACKAGE_SCHEMA_VERSION = 1;
  const PACKAGE_FORMAT = "article-saver";
  const MAX_PACKAGE_SIZE = 50 * 1024 * 1024;
  const MAX_ARTICLES_PER_PACKAGE = 500;
  const APP_IDENTIFIER = "article-saver-extension";
  const LIMITS = Object.freeze({
    title: 2000, content: 5 * 1024 * 1024, url: 20000, notes: 1024 * 1024,
    summary: 1024 * 1024, summaryHtml: 2 * 1024 * 1024, tags: 100,
    authors: 100, chatMessages: 200, chatText: 1024 * 1024,
  });

  const text = (value, max) => typeof value === "string" ? value.slice(0, max) : "";
  const textArray = (value, maxItems, maxLength = 500) => Array.isArray(value)
    ? value.filter((item) => typeof item === "string").slice(0, maxItems).map((item) => item.slice(0, maxLength)) : [];

  function normalizeArticle(article) {
    const summary = text(article.summary, LIMITS.summary);
    const summaryHtml = text(article.summaryHtml, LIMITS.summaryHtml);
    const summaryHtmlSource = text(article.summaryHtmlSource, LIMITS.summary);
    return {
      id: text(article.id, 200),
      title: text(article.title, LIMITS.title),
      content: text(article.content, LIMITS.content),
      contentFormat: article.contentFormat === "html" ? "html" : "text",
      url: text(article.url, LIMITS.url),
      savedAt: Number.isFinite(article.savedAt) ? article.savedAt : Date.now(),
      doi: text(article.doi, 500),
      authors: textArray(article.authors, LIMITS.authors),
      publication: text(article.publication, 2000),
      tags: textArray(article.tags, LIMITS.tags),
      notes: text(article.notes, LIMITS.notes),
      highlights: Array.isArray(article.highlights) ? article.highlights.slice(0, 500).map((highlight) => ({
        text: text(highlight && highlight.text, 10000),
        color: /^#[0-9a-f]{6}$/i.test(highlight && highlight.color) ? highlight.color : "#ffe58a",
      })) : [],
      summary,
      summaryHtml: summaryHtmlSource === summary ? summaryHtml : "",
      summaryHtmlSource: summaryHtmlSource === summary ? summaryHtmlSource : "",
      chat: Array.isArray(article.chat) ? article.chat.slice(0, LIMITS.chatMessages).map((message) => ({
        role: message && message.role === "user" ? "user" : "assistant",
        text: text(message && message.text, LIMITS.chatText),
      })).filter((message) => message.text) : [],
    };
  }

  function generatePackageId() {
    return "pkg_" + crypto.randomUUID();
  }

  function createManifest({ packageType, collectionId, collectionName, articleCount, description }) {
    return {
      format: PACKAGE_FORMAT,
      schemaVersion: PACKAGE_SCHEMA_VERSION,
      packageType,
      packageId: generatePackageId(),
      collectionId,
      collectionName,
      description: description || "",
      articleCount,
      createdAt: new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      sourceApp: APP_IDENTIFIER,
    };
  }

  function createCollectionData(list, articles) {
    return {
      id: list.id,
      collectionId: list.collectionId,
      name: list.name,
      description: list.description || "",
      createdAt: list.createdAt,
      articleIds: articles.map((a) => a.id),
    };
  }

  function createArticleData(article) {
    return normalizeArticle(article || {});
  }

  function buildPackage({ packageType, list, articles, description, includeNotes = true, includeTags = true, includeHighlights = true, includeAISummary = true, includeAIChat = true }) {
    const filteredArticles = articles.map((a) => {
      const data = createArticleData(a);
      if (!includeNotes) {
        data.notes = "";
      }
      if (!includeTags) {
        data.tags = [];
      }
      if (!includeHighlights) {
        data.highlights = [];
      }
      if (!includeAISummary) {
        data.summary = "";
        data.summaryHtml = "";
        data.summaryHtmlSource = "";
      }
      if (!includeAIChat) {
        data.chat = [];
      }
      return data;
    });

    const manifest = createManifest({
      packageType,
      collectionId: list.collectionId,
      collectionName: list.name,
      articleCount: filteredArticles.length,
      description,
    });

    const collection = createCollectionData(list, filteredArticles);

    return {
      manifest,
      collection,
      articles: filteredArticles,
    };
  }

  async function serializePackage(packageData) {
    const json = JSON.stringify(packageData, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    if (blob.size > MAX_PACKAGE_SIZE) {
      throw new Error("Package exceeds maximum size limit");
    }
    return blob;
  }

  function getFileName(collectionName, packageType) {
    const safeName = String(collectionName || "package")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 100);
    const typeSuffix = packageType === "collection" ? "" : "-" + packageType;
    return safeName + typeSuffix + ".articlesaver";
  }

  function validateManifest(manifest) {
    if (!manifest || typeof manifest !== "object") {
      return { valid: false, error: "Missing or invalid manifest" };
    }
    if (manifest.format !== PACKAGE_FORMAT) {
      return { valid: false, error: "Unsupported package format" };
    }
    if (manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
      return { valid: false, error: `Unsupported schema version: ${manifest.schemaVersion}. Current: ${PACKAGE_SCHEMA_VERSION}` };
    }
    if (!["collection", "article", "research-pack"].includes(manifest.packageType)) {
      return { valid: false, error: `Unknown package type: ${manifest.packageType}` };
    }
    if (typeof manifest.collectionId !== "string" || !manifest.collectionId || manifest.collectionId.length > 200) {
      return { valid: false, error: "Missing collectionId in manifest" };
    }
    if (typeof manifest.collectionName !== "string" || !manifest.collectionName || manifest.collectionName.length > 500) {
      return { valid: false, error: "Missing collectionName in manifest" };
    }
    if (typeof manifest.articleCount !== "number" || manifest.articleCount < 0) {
      return { valid: false, error: "Invalid articleCount in manifest" };
    }
    if (manifest.articleCount > MAX_ARTICLES_PER_PACKAGE) {
      return { valid: false, error: `Too many articles: ${manifest.articleCount} (max ${MAX_ARTICLES_PER_PACKAGE})` };
    }
    return { valid: true };
  }

  function validateCollection(collection) {
    if (!collection || typeof collection !== "object") {
      return { valid: false, error: "Missing or invalid collection data" };
    }
    if (typeof collection.collectionId !== "string" || !collection.collectionId || collection.collectionId.length > 200) {
      return { valid: false, error: "Missing collectionId in collection data" };
    }
    if (typeof collection.name !== "string" || !collection.name || collection.name.length > 500) {
      return { valid: false, error: "Missing name in collection data" };
    }
    if (!Array.isArray(collection.articleIds)) {
      return { valid: false, error: "Invalid articleIds in collection data" };
    }
    return { valid: true };
  }

  function validateArticle(article) {
    if (!article || typeof article !== "object") {
      return { valid: false, error: "Invalid article data" };
    }
    if (typeof article.id !== "string" || !article.id || article.id.length > 200) {
      return { valid: false, error: "Missing article id" };
    }
    if (typeof article.title !== "string" || typeof article.content !== "string") return { valid: false, error: "Invalid article text fields" };
    if (article.title.length > LIMITS.title || article.content.length > LIMITS.content) return { valid: false, error: "Article text exceeds size limits" };
    if (article.notes != null && (typeof article.notes !== "string" || article.notes.length > LIMITS.notes)) return { valid: false, error: "Invalid article notes" };
    if (article.summary != null && (typeof article.summary !== "string" || article.summary.length > LIMITS.summary)) return { valid: false, error: "Invalid AI summary" };
    if (article.summaryHtml != null && (typeof article.summaryHtml !== "string" || article.summaryHtml.length > LIMITS.summaryHtml)) return { valid: false, error: "Invalid AI summary formatting" };
    if (article.chat != null && (!Array.isArray(article.chat) || article.chat.length > LIMITS.chatMessages)) return { valid: false, error: "Invalid AI chat" };
    return { valid: true };
  }

  function validatePackage(packageData) {
    const manifestResult = validateManifest(packageData.manifest);
    if (!manifestResult.valid) return manifestResult;

    const collectionResult = validateCollection(packageData.collection);
    if (!collectionResult.valid) return collectionResult;
    if (packageData.collection.collectionId !== packageData.manifest.collectionId) {
      return { valid: false, error: "Collection identity mismatch" };
    }

    if (!Array.isArray(packageData.articles)) {
      return { valid: false, error: "Missing or invalid articles array" };
    }

    if (packageData.articles.length !== packageData.manifest.articleCount) {
      return { valid: false, error: `Article count mismatch: manifest says ${packageData.manifest.articleCount}, found ${packageData.articles.length}` };
    }

    for (const article of packageData.articles) {
      const articleResult = validateArticle(article);
      if (!articleResult.valid) return articleResult;
    }
    const articleIds = packageData.articles.map((article) => article.id);
    if (new Set(articleIds).size !== articleIds.length) {
      return { valid: false, error: "Duplicate article ids" };
    }
    if (packageData.collection.articleIds.length !== articleIds.length ||
        !articleIds.every((id) => packageData.collection.articleIds.includes(id))) {
      return { valid: false, error: "Collection article list mismatch" };
    }

    return { valid: true };
  }

  async function parsePackageBlob(blob) {
    if (blob.size > MAX_PACKAGE_SIZE) {
      throw new Error("Package file exceeds maximum size limit");
    }
    const rawText = await blob.text();
    let packageData;
    try {
      packageData = JSON.parse(rawText);
    } catch (e) {
      throw new Error("Invalid JSON in package file");
    }
    const validation = validatePackage(packageData);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return {
      manifest: {
        format: PACKAGE_FORMAT,
        schemaVersion: PACKAGE_SCHEMA_VERSION,
        packageType: packageData.manifest.packageType,
        packageId: text(packageData.manifest.packageId, 200),
        collectionId: text(packageData.manifest.collectionId, 200),
        collectionName: text(packageData.manifest.collectionName, 500),
        description: text(packageData.manifest.description, 5000),
        articleCount: packageData.articles.length,
        createdAt: text(packageData.manifest.createdAt, 100),
        exportedAt: text(packageData.manifest.exportedAt, 100),
        sourceApp: text(packageData.manifest.sourceApp, 200),
      },
      collection: {
        id: text(packageData.collection.id, 200),
        collectionId: text(packageData.collection.collectionId, 200),
        name: text(packageData.collection.name, 500),
        description: text(packageData.collection.description, 5000),
        createdAt: Number.isFinite(packageData.collection.createdAt) ? packageData.collection.createdAt : Date.now(),
        articleIds: packageData.articles.map((article) => text(article.id, 200)),
      },
      articles: packageData.articles.map(normalizeArticle),
    };
  }

  async function parsePackageFile(file) {
    if (!(file instanceof File) && !(file instanceof Blob)) {
      throw new Error("Invalid file input");
    }
    return parsePackageBlob(file);
  }

  function createImportPreview(packageData, existingList, existingArticles) {
    const manifest = packageData.manifest;
    const articles = packageData.articles;

    let newArticles = 0;
    let existingArticlesCount = 0;
    let newTags = new Set();
    let existingTags = new Set();
    let newNotes = 0;
    let updatedNotes = 0;

    const localArticlesByUrl = new Map();
    const localArticlesByDoi = new Map();
    for (const a of existingArticles) {
      if (a.url) localArticlesByUrl.set(a.url, a);
      if (a.doi) localArticlesByDoi.set(a.doi, a);
    }

    for (const article of articles) {
      let exists = false;
      let matchType = null;

      if (article.url && localArticlesByUrl.has(article.url)) {
        exists = true;
        matchType = "url";
      } else if (article.doi && localArticlesByDoi.has(article.doi)) {
        exists = true;
        matchType = "doi";
      }

      if (exists) {
        existingArticlesCount++;
        const localArticle = matchType === "url" ? localArticlesByUrl.get(article.url) : localArticlesByDoi.get(article.doi);
        if (article.notes && article.notes !== localArticle.notes) {
          updatedNotes++;
        }
        if (article.tags && article.tags.length > 0) {
          for (const tag of article.tags) {
            if (!localArticle.tags || !localArticle.tags.includes(tag)) {
              newTags.add(tag);
            } else {
              existingTags.add(tag);
            }
          }
        }
      } else {
        newArticles++;
        if (article.tags && article.tags.length > 0) {
          for (const tag of article.tags) newTags.add(tag);
        }
        if (article.notes) newNotes++;
      }
    }

    const isNewCollection = !existingList;

    return {
      isNewCollection,
      collectionName: manifest.collectionName,
      collectionId: manifest.collectionId,
      articleCount: articles.length,
      newArticles,
      existingArticles: existingArticlesCount,
      newTags: Array.from(newTags),
      existingTags: Array.from(existingTags),
      newNotes,
      updatedNotes,
      summaries: articles.filter((article) => article.summary).length,
      chats: articles.filter((article) => Array.isArray(article.chat) && article.chat.length).length,
      highlights: articles.reduce((total, article) => total + (Array.isArray(article.highlights) ? article.highlights.length : 0), 0),
      manifest,
    };
  }

  window.PackageService = {
    PACKAGE_SCHEMA_VERSION,
    PACKAGE_FORMAT,
    MAX_PACKAGE_SIZE,
    MAX_ARTICLES_PER_PACKAGE,
    APP_IDENTIFIER,
    buildPackage,
    serializePackage,
    getFileName,
    validatePackage,
    parsePackageFile,
    parsePackageBlob,
    createImportPreview,
    createManifest,
    createCollectionData,
    createArticleData,
    normalizeArticle,
    LIMITS,
  };
})();
