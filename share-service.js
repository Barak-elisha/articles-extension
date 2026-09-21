(function () {
  const INSTALL_URL = "https://chromewebstore.google.com/detail/article-saver/";

  function getShareInstructions(packageType, collectionName) {
    const t = (key, params) => window.I18N.t(key, params);
    let templateKey;
    if (packageType === "article") {
      templateKey = "shareInstructionsArticleTemplate";
    } else if (packageType === "research-pack") {
      templateKey = "shareInstructionsResearchPackTemplate";
    } else {
      templateKey = "shareInstructionsCollectionTemplate";
    }

    return t(templateKey, {
      itemName: t(
        packageType === "article" ? "shareArticleItem"
          : packageType === "research-pack" ? "shareResearchPackItem"
          : "shareCollectionItem"
      ),
      collectionName: collectionName || t("sharedResearch"),
      installUrl: INSTALL_URL,
    });
  }

  function formatInstructions(template, params) {
    return template.replace(/\{(\w+)\}/g, (_, key) => params[key] || "{" + key + "}");
  }

  async function shareViaNative(blob, fileName, title, text) {
    if (!navigator.canShare || !navigator.share) {
      return { success: false, reason: "unsupported" };
    }

    const file = new File([blob], fileName, { type: "application/json" });
    const shareData = {
      title: title || "Article Saver",
      text: text || "",
      files: [file],
    };

    if (!navigator.canShare(shareData)) {
      return { success: false, reason: "cannot-share-files" };
    }

    try {
      await navigator.share(shareData);
      return { success: true };
    } catch (err) {
      if (err.name === "AbortError") {
        return { success: false, reason: "user-cancelled" };
      }
      return { success: false, reason: "share-failed", error: err };
    }
  }

  function downloadFile(blob, fileName) {
    return new Promise((resolve, reject) => {
      try {
        if (window.showSaveFilePicker) {
          window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: "Article Saver",
              accept: { "application/json": [".articlesaver"] },
            }],
          }).then(async (handle) => {
            try {
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
              resolve({ success: true, method: "file-picker", fileName: handle.name || fileName });
            } catch (e) {
              if (e.name === "AbortError") {
                resolve({ success: false, reason: "user-cancelled" });
              } else {
                reject(e);
              }
            }
          }).catch((e) => {
            if (e.name === "AbortError") {
              resolve({ success: false, reason: "user-cancelled" });
            } else {
              fallbackDownload(blob, fileName).then(resolve).catch(reject);
            }
          });
        } else {
          fallbackDownload(blob, fileName).then(resolve).catch(reject);
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  function fallbackDownload(blob, fileName) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      resolve({ success: true, method: "legacy-download", fileName });
    });
  }

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text).then(
      () => ({ success: true }),
      (err) => ({ success: false, error: err })
    );
  }

  function openEmailFallback(subject, body) {
    const mailto = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    window.open(mailto, "_blank");
    return { success: true };
  }

  async function sharePackage(packageBlob, fileName, packageType, collectionName, options = {}) {
    const t = (key) => window.I18N.t(key);
    const title = packageType === "article" ? t("shareArticleTitle") : t("shareCollectionTitle");
    const instructions = getShareInstructions(packageType, collectionName);

    const shareText = title + "\n\n" + instructions;

    if (options.preferNative !== false) {
      const nativeResult = await shareViaNative(packageBlob, fileName, title, shareText);
      if (nativeResult.success) {
        return { success: true, method: "native" };
      }
      if (nativeResult.reason === "user-cancelled") {
        return { success: false, reason: "user-cancelled" };
      }
    }

    const downloadResult = await downloadFile(packageBlob, fileName);
    if (!downloadResult.success) {
      return downloadResult;
    }

    const copied = await copyToClipboard(instructions);
    return {
      success: true,
      method: "download",
      downloadMethod: downloadResult.method,
      fileName: downloadResult.fileName || fileName,
      instructionsCopied: copied.success,
      instructions,
    };
  }

  function getInstallUrl() {
    return INSTALL_URL;
  }

  window.ShareService = {
    sharePackage,
    getShareInstructions,
    getInstallUrl,
    copyToClipboard,
    openEmailFallback,
    downloadFile,
  };
})();