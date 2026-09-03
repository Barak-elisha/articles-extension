(function () {
  let nextId = 0;
  window.createHighlighter = function (editor, { label, onSave, onError }) {
    const t = (key) => window.I18N.t(key);
    const control = document.createElement("div");
    control.className = "marker-control";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "icon-btn notes-tb";
    toggle.dataset.icon = "highlighter";
    toggle.title = toggle.ariaLabel = t("highlightColor") + " — " + label;
    toggle.setAttribute("aria-expanded", "false");
    const palette = document.createElement("div");
    palette.className = "marker-palette hidden";
    palette.id = "marker-palette-" + (++nextId);
    palette.setAttribute("role", "group");
    palette.setAttribute("aria-label", t("highlightColor"));
    toggle.setAttribute("aria-controls", palette.id);
    let savedRange = null;
    let saving = false;
    const capture = () => {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range.cloneRange() : null;
    };
    const close = () => {
      palette.classList.add("hidden");
      toggle.setAttribute("aria-expanded", "false");
    };
    toggle.addEventListener("mousedown", (event) => {
      savedRange = capture();
      event.preventDefault();
    });
    toggle.addEventListener("click", () => {
      savedRange = capture() || savedRange;
      const visible = palette.classList.toggle("hidden") === false;
      toggle.setAttribute("aria-expanded", String(visible));
    });
    control.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { close(); toggle.focus(); }
    });
    const apply = async (color) => {
      if (saving) return;
      const range = capture() || savedRange;
      if (!range || range.collapsed || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
        onError(t("selectTextToHighlight"));
        return;
      }
      const editable = editor.getAttribute("contenteditable");
      try {
        // Temporarily enable formatting for the read-only AI summary. Restore
        // it synchronously, before saving, so typing cannot change the summary.
        editor.contentEditable = "true";
        editor.focus({ preventScroll: true });
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        if (!document.execCommand("hiliteColor", false, color)) throw new Error(t("highlightFailed"));
        savedRange = capture();
      } catch (error) {
        onError(error.message);
        return;
      } finally {
        if (editable === null) editor.removeAttribute("contenteditable");
        else editor.setAttribute("contenteditable", editable);
      }
      close();
      saving = true;
      try { await onSave(); }
      catch (error) { onError(t("noteSaveFailed") + error.message); }
      finally { saving = false; }
    };
    const colors = [
      ["#ffe58a", "markerYellow"], ["#b5f7b0", "markerGreen"],
      ["#b3e5fc", "markerBlue"], ["#ffd0f0", "markerPink"],
      ["#ffcc80", "markerOrange"], ["#d7b8ff", "markerPurple"],
    ];
    colors.forEach(([color, key]) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "marker-swatch";
      swatch.style.backgroundColor = color;
      swatch.title = swatch.ariaLabel = t(key);
      swatch.addEventListener("mousedown", (event) => event.preventDefault());
      swatch.addEventListener("click", () => apply(color));
      palette.appendChild(swatch);
    });
    const custom = document.createElement("input");
    custom.type = "color";
    custom.className = "marker-custom";
    custom.value = colors[0][0];
    custom.title = custom.ariaLabel = t("markerCustom");
    custom.addEventListener("change", () => apply(custom.value));
    palette.appendChild(custom);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn notes-tb";
    remove.dataset.icon = "eraser";
    remove.title = remove.ariaLabel = t("removeHighlight");
    remove.addEventListener("mousedown", (event) => event.preventDefault());
    remove.addEventListener("click", () => apply("transparent"));
    palette.appendChild(remove);
    control.append(toggle, palette);
    return control;
  };
})();
