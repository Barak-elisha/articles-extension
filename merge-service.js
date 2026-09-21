(function () {
  function findBestArticleMatch(importedArticle, localArticles) {
    if (importedArticle.doi) {
      const byDoi = localArticles.find((a) => a.doi && a.doi === importedArticle.doi);
      if (byDoi) return { article: byDoi, matchType: "doi" };
    }
    if (importedArticle.url) {
      const byUrl = localArticles.find((a) => a.url && a.url === importedArticle.url);
      if (byUrl) return { article: byUrl, matchType: "url" };
    }
    return { article: null, matchType: null };
  }

  function mergeTags(existingTags, newTags) {
    const merged = [...(existingTags || [])];
    for (const tag of newTags || []) {
      if (!merged.includes(tag)) merged.push(tag);
    }
    return merged;
  }

  function mergeNotes(existingNotes, importedNotes, preferNewer = true) {
    if (!importedNotes) return existingNotes;
    if (!existingNotes) return importedNotes;
    if (existingNotes === importedNotes) return existingNotes;

    const existingTime = 0;
    const importedTime = 0;
    if (preferNewer && importedTime > existingTime) {
      return importedNotes;
    }
    return existingNotes + "\n\n---\n\n" + importedNotes;
  }

  function mergeHighlights(existingHighlights, importedHighlights) {
    const merged = [...(existingHighlights || [])];
    for (const h of importedHighlights || []) {
      const exists = merged.some((eh) => eh.text === h.text && eh.color === h.color);
      if (!exists) merged.push(h);
    }
    return merged;
  }

  function createMergedArticle(localArticle, importedArticle, options = {}) {
    const merged = { ...localArticle };

    if (importedArticle.title && importedArticle.title !== localArticle.title) {
      merged.title = importedArticle.title;
    }

    if (importedArticle.content && importedArticle.content !== localArticle.content) {
      if (options.preferLocalContent) {
        // Keep local content
      } else if (importedArticle.savedAt > localArticle.savedAt) {
        merged.content = importedArticle.content;
        merged.contentFormat = importedArticle.contentFormat;
      }
    }

    if (importedArticle.doi && !localArticle.doi) {
      merged.doi = importedArticle.doi;
    }
    if (importedArticle.authors && importedArticle.authors.length > 0) {
      merged.authors = mergeTags(localArticle.authors || [], importedArticle.authors);
    }
    if (importedArticle.publication && !localArticle.publication) {
      merged.publication = importedArticle.publication;
    }

    merged.tags = mergeTags(localArticle.tags || [], importedArticle.tags || []);
    merged.notes = mergeNotes(localArticle.notes, importedArticle.notes);
    merged.highlights = mergeHighlights(localArticle.highlights || [], importedArticle.highlights || []);

    if (importedArticle.summary && (!localArticle.summary || options.preferImportedSummary !== false)) {
      merged.summary = importedArticle.summary;
      const matchingHtml = importedArticle.summaryHtml && importedArticle.summaryHtmlSource === importedArticle.summary;
      merged.summaryHtml = matchingHtml ? importedArticle.summaryHtml : "";
      merged.summaryHtmlSource = matchingHtml ? importedArticle.summaryHtmlSource : "";
    }

    if (importedArticle.chat && importedArticle.chat.length > 0) {
      const existingChats = localArticle.chat || [];
      const newChats = importedArticle.chat.filter((ic) =>
        !existingChats.some((ec) => ec.role === ic.role && ec.text === ic.text)
      );
      merged.chat = [...existingChats, ...newChats];
    }

    merged.updatedAt = Date.now();

    return merged;
  }

  function mergeCollection(localList, importedList, importedArticles, localArticles, options = {}) {
    const mergedList = { ...localList };
    const mergedArticles = [];
    const changes = {
      newArticles: [],
      updatedArticles: [],
      skippedArticles: [],
      newTags: new Set(),
      updatedNotes: 0,
    };

    const scopedArticles = localArticles.filter((article) => !article.listId || article.listId === localList.id);
    for (const importedArticle of importedArticles) {
      const { article: localArticle, matchType } = findBestArticleMatch(importedArticle, scopedArticles);

      if (localArticle) {
        const mergedArticle = createMergedArticle(localArticle, importedArticle, options);
        const hasChanges = JSON.stringify(mergedArticle) !== JSON.stringify(localArticle);
        if (hasChanges) {
          changes.updatedArticles.push({ id: mergedArticle.id, title: mergedArticle.title, matchType });
          if (importedArticle.notes && importedArticle.notes !== localArticle.notes) {
            changes.updatedNotes++;
          }
        } else {
          changes.skippedArticles.push({ id: localArticle.id, title: localArticle.title });
        }
        mergedArticles.push(mergedArticle);

        for (const tag of importedArticle.tags || []) {
          if (!localArticle.tags || !localArticle.tags.includes(tag)) {
            changes.newTags.add(tag);
          }
        }
      } else {
        const newArticle = {
          ...importedArticle,
          id: "art_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
          listId: localList.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        changes.newArticles.push({ id: newArticle.id, title: newArticle.title });
        mergedArticles.push(newArticle);
        for (const tag of importedArticle.tags || []) {
          changes.newTags.add(tag);
        }
        if (importedArticle.notes) changes.updatedNotes++;
      }
    }

    return {
      list: mergedList,
      articles: mergedArticles,
      changes: {
        ...changes,
        newTags: Array.from(changes.newTags),
      },
    };
  }

  function createNewCollectionFromPackage(importedList, importedArticles, targetListId) {
    const articles = importedArticles.map((a) => ({
      ...a,
      id: "art_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      listId: targetListId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    return {
      list: {
        ...importedList,
        id: targetListId,
        createdAt: Date.now(),
      },
      articles,
      changes: {
        newArticles: articles.map((a) => ({ id: a.id, title: a.title })),
        updatedArticles: [],
        skippedArticles: [],
        newTags: [],
        updatedNotes: 0,
      },
    };
  }

  window.MergeService = {
    findBestArticleMatch,
    mergeTags,
    mergeNotes,
    mergeHighlights,
    createMergedArticle,
    mergeCollection,
    createNewCollectionFromPackage,
  };
})();
