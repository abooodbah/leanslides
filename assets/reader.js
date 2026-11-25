// The LeanSlides reader: the window's interface (toolbar, tabs, thumbnails,
// notes, find, settings) around the slide stage. The host sends the deck;
// the reader fetches one slide model at a time (docs/HOST.md), draws it with
// render.js, and reports each drawn slide to the host.
(function () {
  "use strict";

  var bridge = window.chrome && window.chrome.webview;
  var Geometry = window.LeanSlidesGeometry;
  var Render = window.LeanSlidesRender;
  var Strings = window.LeanSlidesStrings;
  var systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  var root = document.documentElement;
  function byId(id) { return document.getElementById(id); }
  var elements = {
    chrome: byId("chrome"),
    clearRecent: byId("clearRecent"),
    editorButton: byId("editorButton"),
    fileMeta: byId("fileMeta"),
    fileName: byId("fileName"),
    findCount: byId("findCount"),
    findInput: byId("findInput"),
    linkCancel: byId("linkCancel"),
    linkDialog: byId("linkDialog"),
    linkOpen: byId("linkOpen"),
    linkTarget: byId("linkTarget"),
    liveStatus: byId("liveStatus"),
    notesButton: byId("notesButton"),
    notesPanel: byId("notesPanel"),
    notesText: byId("notesText"),
    notice: byId("notice"),
    noticeClose: byId("noticeClose"),
    noticeText: byId("noticeText"),
    openButton: byId("openButton"),
    readerPane: byId("readerPane"),
    recentList: byId("recentList"),
    recentSection: byId("recentSection"),
    settingsButton: byId("settingsButton"),
    settingsClose: byId("settingsClose"),
    settingsPanel: byId("settingsPanel"),
    shortcutList: byId("shortcutList"),
    slideCounter: byId("slideCounter"),
    stage: byId("stage"),
    stateEditorButton: byId("stateEditorButton"),
    stateEyebrow: byId("stateEyebrow"),
    stateMessage: byId("stateMessage"),
    stateOpenButton: byId("stateOpenButton"),
    statePane: byId("statePane"),
    stateTitle: byId("stateTitle"),
    status: byId("statusToast"),
    tabStrip: byId("tabStrip"),
    themeButton: byId("themeButton"),
    themeLabel: byId("themeLabel"),
    themeSwatch: byId("themeSwatch"),
    thumbList: byId("thumbList"),
    thumbs: byId("thumbs"),
    zoomIn: byId("zoomIn"),
    zoomOut: byId("zoomOut"),
    zoomValue: byId("zoomValue")
  };

  var EMU_PER_POINT = 12700;
  var PX_PER_POINT = 96 / 72;
  var STAGE_MARGIN = 24;
  var THUMB_WIDTH = 168;
  var MODEL_CACHE = 24;
  var MAX_FETCHES = 2;
  var ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];
  var SEARCH_PAUSE_MS = 120;
  var THEMES = ["system", "light", "dark", "dim", "dusk"];

  var language = "en";
  var host = { platform: "", version: "", editorKind: "", editorLabel: "", tabs: false };
  var isMac = /Mac/.test(navigator.platform || "");
  var currentTheme = "system";
  var tabs = [];
  var activeTabId = null;
  var focusTabAfterRender = false;
  var presets = null;
  var presetsReady = fetch("presets.json")
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (value) { presets = value; }, function () { presets = null; });

  var current = null;
  var queue = [];
  var active = 0;
  var shapeFailures = 0;
  var zoomMode = "fit";
  var zoomFactor = 1;
  var notesOpen = false;
  var search = { query: "", matches: [], index: -1 };
  var searchTimer = 0;
  var toastTimer = 0;
  var resizeFrame = 0;
  var settingsReturnFocus = null;
  var linkReturnFocus = null;
  var pendingLink = "";
  var collapsedNotices = new Set();
  var thumbObserver = null;
  var thumbReleaser = null;

  // ------------------------------------------------------------- helpers

  function t(key, values) {
    return Strings.translate(language, key, values);
  }

  function post(message) {
    try {
      if (bridge) bridge.postMessage(JSON.stringify(message));
    } catch (_error) {
      // A host that has gone away cannot be told anything.
    }
  }

  function idKey(id) {
    return id === null || id === undefined ? "" : String(id);
  }

  function sameId(left, right) {
    return idKey(left) !== "" && idKey(left) === idKey(right);
  }

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function modifier(event) {
    return isMac ? event.metaKey : event.ctrlKey;
  }

  function shortcut(text) {
    return isMac ? text.replace(/Ctrl\+/g, "Cmd+") : text;
  }

  function announce(message) {
    elements.liveStatus.textContent = "";
    window.setTimeout(function () { elements.liveStatus.textContent = message; }, 30);
  }

  function showStatus(message, tone) {
    window.clearTimeout(toastTimer);
    elements.status.textContent = message;
    elements.status.dataset.tone = tone === "warning" || tone === "error" ? tone : "info";
    elements.status.hidden = !message;
    toastTimer = window.setTimeout(function () { elements.status.hidden = true; },
      tone === "warning" || tone === "error" ? 8000 : 5000);
  }

  // Fills every element that names a string key.
  function applyStrings() {
    root.lang = language;
    document.querySelectorAll("[data-i18n]").forEach(function (node) {
      node.textContent = t(node.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-label]").forEach(function (node) {
      node.setAttribute("aria-label", t(node.dataset.i18nLabel));
    });
    elements.findInput.placeholder = t("find.placeholder");
    elements.zoomIn.setAttribute("aria-label", t("zoom.in"));
    elements.zoomIn.title = shortcut(t("zoom.in") + " (Ctrl++)");
    elements.zoomOut.setAttribute("aria-label", t("zoom.out"));
    elements.zoomOut.title = shortcut(t("zoom.out") + " (Ctrl+-)");
    elements.zoomValue.title = shortcut(t("zoom.fitTitle"));
    elements.notesButton.textContent = t("notes.button");
    elements.notesButton.title = shortcut(t("notes.title"));
    elements.openButton.textContent = t("open.button");
    elements.openButton.title = shortcut(t("open.presentation") + " (Ctrl+O)");
    elements.settingsButton.setAttribute("aria-label", t("settings.buttonLabel"));
    elements.settingsButton.title = shortcut(t("settings.buttonTitle"));
    elements.settingsClose.setAttribute("aria-label", t("settings.close"));
    elements.settingsClose.title = t("close.escTitle");
    elements.noticeClose.setAttribute("aria-label", t("notice.close"));
    elements.noticeClose.title = t("notice.close");
    elements.findInput.title = shortcut(t("find.label") + " (Ctrl+F, F3)");
    applyTheme(currentTheme);
    updateEditorButtons();
    updateZoomLabel();
    renderTabs();
    if (current) {
      updateCounter();
      renderThumbLabels();
    }
  }

  // --------------------------------------------------------------- theme

  function themeDisplayName(theme) {
    return theme === "system"
      ? t("theme.systemShown", { theme: t(systemTheme.matches ? "theme.dark" : "theme.light") })
      : t("theme." + theme);
  }

  function applyTheme(theme) {
    currentTheme = THEMES.indexOf(theme) > 0 ? theme : "system";
    if (currentTheme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", currentTheme);
    elements.themeLabel.textContent = t("theme." + currentTheme);
    elements.themeSwatch.dataset.swatch = currentTheme;
    var name = themeDisplayName(currentTheme);
    elements.themeButton.setAttribute("aria-label", t("theme.buttonLabel", { theme: name }));
    elements.themeButton.title = shortcut(t("theme.buttonTitle", { theme: name }));
    updateSettingsPanel();
  }

  function cycleTheme() {
    var next = THEMES[(THEMES.indexOf(currentTheme) + 1) % THEMES.length];
    applyTheme(next);
    post({ type: "setTheme", theme: next });
  }

  // ------------------------------------------------------ host and editor

  // The host names the editor in English (src/windows/EditorChoice.h); the
  // reader words it in the interface language. Only the default app carries
  // a name of its own.
  function editorLabel() {
    if (host.editorKind === "default") {
      var name = /^Open in (.+)$/.exec(host.editorLabel);
      return name ? t("editor.defaultNamed", { name: name[1] }) : t("editor.default");
    }
    return host.editorKind && Strings.has("editor." + host.editorKind) ? t("editor." + host.editorKind) : "";
  }

  function updateEditorButtons() {
    var label = editorLabel();
    elements.editorButton.textContent = label;
    elements.stateEditorButton.textContent = label;
    elements.editorButton.hidden = !label;
    elements.editorButton.title = label ? shortcut(label + " (Ctrl+Shift+E)") : "";
    var fallback = elements.statePane.dataset.state === "fallback";
    elements.stateEditorButton.hidden = !label || !fallback;
    elements.stateOpenButton.className = "button " + (fallback && label ? "button-secondary" : "button-primary");
    elements.stateOpenButton.textContent = t(fallback ? "open.another" : "open.presentation");
  }

  function receiveHost(data) {
    host.platform = String(data.platform || "");
    host.version = String(data.version || "");
    var editor = data.editor && typeof data.editor === "object" ? data.editor : {};
    host.editorKind = String(editor.kind || "");
    host.editorLabel = String(editor.label || "");
    host.tabs = data.tabs === true;
    isMac = host.platform === "macos" || (!host.platform && isMac);
    root.dataset.platform = host.platform;
    applyStrings();
  }

  function openInEditor() {
    var tab = current ? current.tab : activeTabId;
    post({ type: "openInEditor", tab: tab === undefined ? null : tab });
  }

  // ------------------------------------------------------- fetching models

  function stale() {
    var error = new Error("stale");
    error.stale = true;
    return error;
  }

  function pump() {
    while (active < MAX_FETCHES && queue.length) {
      queue.sort(function (a, b) { return a.priority - b.priority; });
      var job = queue.shift();
      if (job.deck !== current) {
        job.reject(stale());
        continue;
      }
      active += 1;
      job.run().then(job.resolve, job.reject).then(function () {
        active -= 1;
        pump();
      });
    }
  }

  function enqueue(deck, priority, run) {
    return new Promise(function (resolve, reject) {
      queue.push({ deck: deck, priority: priority, run: run, resolve: resolve, reject: reject });
      pump();
    });
  }

  function fetchJson(deck, address) {
    return fetch(deck.deckUrl + address).then(function (response) {
      if (deck !== current) throw stale();
      if (!response.ok) throw new Error(address + " request failed: " + response.status);
      return response.json();
    });
  }

  // A model from the cache, or fetched through the queue: 0 for the stage,
  // 1 for its neighbours, 2 for thumbnails.
  function loadModel(deck, number, priority) {
    var cached = deck.models.get(number);
    if (cached) {
      deck.models.delete(number);
      deck.models.set(number, cached);
      return cached;
    }
    var promise = enqueue(deck, priority, function () { return fetchJson(deck, "slide/" + number + ".json"); });
    deck.models.set(number, promise);
    promise.catch(function () {
      if (deck.models.get(number) === promise) deck.models.delete(number);
    });
    while (deck.models.size > MODEL_CACHE) {
      deck.models.delete(deck.models.keys().next().value);
    }
    return promise;
  }

  // Every slide's text and notes, read once after the first slide is drawn.
  function loadDetails(deck) {
    if (!deck.details) {
      deck.details = enqueue(deck, 3, function () { return fetchJson(deck, "details.json"); });
      deck.details.then(function (details) {
        if (deck !== current) return;
        deck.detailText = Array.isArray(details.slides) ? details.slides : [];
        showNotes();
        if (search.query) runSearch(false);
      }, function () {});
    }
    return deck.details;
  }

  // ------------------------------------------------------------- drawing

  function drawContext(deck) {
    return {
      mediaUrl: function (id) { return deck.deckUrl + "media?id=" + encodeURIComponent(id); },
      geometry: function (geom, w, h) { return Geometry.build(geom, w, h, presets); },
      missingLabel: function (kind) { return t("missing." + (kind || "absent")); },
      featureLabel: function (code, label) {
        return Strings.has("feature." + code) ? t("feature." + code) : (label || code || "");
      },
      unknownPreset: function (name) { deck.unknownPresets[name || ""] = true; },
      shapeFailed: function (shape, error) {
        shapeFailures += 1;
        root.dataset.shapeFailures = String(shapeFailures);
        if (window.console) console.error("LeanSlides could not draw shape " + (shape && shape.id), error);
      }
    };
  }

  function slideSize(deck, model) {
    return {
      w: (model && model.w || deck.index.slideWidth || 12192000) / EMU_PER_POINT,
      h: (model && model.h || deck.index.slideHeight || 6858000) / EMU_PER_POINT
    };
  }

  function failedSlide(deck, number) {
    var size = slideSize(deck, null);
    var node = document.createElement("div");
    node.className = "slide slide-failed";
    node.style.width = size.w + "px";
    node.style.height = size.h + "px";
    node.setAttribute("data-failed-slide", String(number));
    var text = document.createElement("p");
    text.textContent = t("slide.failed");
    node.appendChild(text);
    return node;
  }

  function fitScale() {
    var frame = elements.stage.firstElementChild;
    if (!frame || !frame.dataset.width) return 1;
    var availableW = Math.max(1, elements.stage.clientWidth - 2 * STAGE_MARGIN);
    var availableH = Math.max(1, elements.stage.clientHeight - 2 * STAGE_MARGIN);
    return Math.min(availableW / Number(frame.dataset.width), availableH / Number(frame.dataset.height));
  }

  // The scale from points to CSS pixels on the stage.
  function stageScale() {
    return zoomMode === "fit" ? fitScale() : zoomFactor * PX_PER_POINT;
  }

  function layoutStage() {
    var frame = elements.stage.firstElementChild;
    if (!frame || !frame.dataset.width) return;
    var scale = stageScale();
    frame.style.width = Math.round(Number(frame.dataset.width) * scale) + "px";
    frame.style.height = Math.round(Number(frame.dataset.height) * scale) + "px";
    frame.firstElementChild.style.transform = "scale(" + scale + ")";
    elements.stage.dataset.zoom = zoomMode;
    updateZoomLabel();
  }

  function placeOnStage(slide, size) {
    var frame = document.createElement("div");
    frame.className = "slide-frame";
    frame.dataset.width = String(size.w);
    frame.dataset.height = String(size.h);
    frame.appendChild(slide);
    elements.stage.replaceChildren(frame);
    layoutStage();
  }

  function updateCounter() {
    if (!current || !current.count) {
      elements.slideCounter.textContent = "";
      return;
    }
    elements.slideCounter.textContent = t("slide.position", { current: current.slide + 1, total: current.count });
  }

  function showSlide(number) {
    var deck = current;
    if (!deck || number < 0 || number >= deck.count) return;
    deck.slide = number;
    updateCounter();
    markCurrentThumb();
    showNotes();
    var started = now();
    Promise.all([presetsReady, loadModel(deck, number, 0)]).then(function (values) {
      if (deck !== current || deck.slide !== number) return;
      var model = values[1];
      if (!model || model.error) {
        placeOnStage(failedSlide(deck, number), slideSize(deck, null));
      } else {
        var slide = Render.drawSlide(model, drawContext(deck));
        slide.setAttribute("data-rendered-slide", String(number));
        placeOnStage(slide, slideSize(deck, model));
        post({ type: "rendered", tab: deck.tab, generation: deck.generation, slide: number,
               ms: Math.round(now() - started) });
      }
      root.dataset.renderState = "ready";
      highlightStage();
      prefetch(deck, number);
      loadDetails(deck);
    }).catch(function (error) {
      if (error && error.stale || deck !== current || deck.slide !== number) return;
      root.dataset.renderState = "failed";
      showState("fallback", t("state.errorTitle"), deck.fileName, t("state.drawFailed"));
      post({ type: "renderFailed", tab: deck.tab, generation: deck.generation,
             message: String(error && error.message || error) });
    });
  }

  function prefetch(deck, number) {
    [number + 1, number - 1].forEach(function (neighbour) {
      if (neighbour >= 0 && neighbour < deck.count && !deck.models.has(neighbour)) {
        loadModel(deck, neighbour, 1).catch(function () {});
      }
    });
  }

  function go(number) {
    if (!current) return;
    var target = Math.max(0, Math.min(current.count - 1, number));
    if (target !== current.slide) showSlide(target);
  }

  // ---------------------------------------------------------- thumbnails

  // Each slide has a list item; its picture is drawn when it comes near the
  // visible part of the strip and dropped when it is far away again, so a
  // long deck keeps only a few drawn thumbnails.
  function buildThumbs(deck) {
    if (thumbObserver) thumbObserver.disconnect();
    if (thumbReleaser) thumbReleaser.disconnect();
    var size = slideSize(deck, null);
    var height = Math.round(THUMB_WIDTH * size.h / size.w);
    var fragment = document.createDocumentFragment();
    for (var number = 0; number < deck.count; number += 1) {
      var item = document.createElement("li");
      item.className = "thumb";
      item.dataset.slide = String(number);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "thumb-button";
      button.tabIndex = -1;
      var label = document.createElement("span");
      label.className = "thumb-number";
      label.textContent = String(number + 1);
      var frame = document.createElement("span");
      frame.className = "thumb-frame";
      frame.style.width = THUMB_WIDTH + "px";
      frame.style.height = height + "px";
      button.append(label, frame);
      item.appendChild(button);
      fragment.appendChild(item);
    }
    elements.thumbList.replaceChildren(fragment);
    renderThumbLabels();
    thumbObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) drawThumb(deck, entry.target);
      });
    }, { root: elements.thumbs, rootMargin: "400px 0px" });
    thumbReleaser = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) releaseThumb(entry.target);
      });
    }, { root: elements.thumbs, rootMargin: "2400px 0px" });
    Array.prototype.forEach.call(elements.thumbList.children, function (item) {
      thumbObserver.observe(item);
      thumbReleaser.observe(item);
    });
  }

  function renderThumbLabels() {
    Array.prototype.forEach.call(elements.thumbList.children, function (item) {
      var number = Number(item.dataset.slide);
      var detail = current && current.detailText ? current.detailText[number] : null;
      item.firstElementChild.setAttribute("aria-label",
        t(detail && detail.hidden ? "thumbs.hidden" : "thumbs.slide", { number: number + 1 }));
    });
  }

  function drawThumb(deck, item) {
    if (item.dataset.drawn || deck !== current) return;
    item.dataset.drawn = "pending";
    var number = Number(item.dataset.slide);
    Promise.all([presetsReady, loadModel(deck, number, 2)]).then(function (values) {
      if (deck !== current || item.dataset.drawn !== "pending") return;
      var model = values[1];
      var frame = item.querySelector(".thumb-frame");
      var size = slideSize(deck, model && !model.error ? model : null);
      var slide = !model || model.error ? failedSlide(deck, number) : Render.drawSlide(model, drawContext(deck));
      slide.removeAttribute("data-failed-slide");
      slide.setAttribute("aria-hidden", "true");
      slide.inert = true;
      slide.style.transform = "scale(" + (THUMB_WIDTH / size.w) + ")";
      frame.replaceChildren(slide);
      item.dataset.drawn = "yes";
    }).catch(function () {
      if (item.dataset.drawn === "pending") delete item.dataset.drawn;
    });
  }

  function releaseThumb(item) {
    if (!item.dataset.drawn) return;
    delete item.dataset.drawn;
    item.querySelector(".thumb-frame").replaceChildren();
  }

  function markCurrentThumb() {
    var previous = elements.thumbList.querySelector("[aria-current='true']");
    if (previous) {
      previous.removeAttribute("aria-current");
      previous.firstElementChild.tabIndex = -1;
    }
    var item = elements.thumbList.children[current.slide];
    if (item) {
      item.setAttribute("aria-current", "true");
      item.firstElementChild.tabIndex = 0;
      item.scrollIntoView({ block: "nearest" });
    }
  }

  // --------------------------------------------------------------- notes

  function showNotes() {
    elements.notesPanel.hidden = !notesOpen || !current;
    elements.notesButton.setAttribute("aria-pressed", notesOpen ? "true" : "false");
    root.toggleAttribute("data-notes-open", notesOpen && !!current);
    if (!notesOpen || !current) return;
    var detail = current.detailText ? current.detailText[current.slide] : null;
    var text = !current.detailText ? t("notes.loading") : (detail && detail.notes ? detail.notes : t("notes.empty"));
    elements.notesText.textContent = text;
    elements.notesText.classList.toggle("notes-placeholder", !(detail && detail.notes));
    highlightNotes();
    layoutStage();
  }

  function toggleNotes() {
    if (!current) return;
    notesOpen = !notesOpen;
    showNotes();
    layoutStage();
  }

  // ---------------------------------------------------------------- find

  function lowered(text) {
    return String(text || "").toLocaleLowerCase();
  }

  // Matches are occurrences in each slide's text, then its notes, in slide
  // order. Find reads details.json, so it covers slides not yet drawn.
  function collectMatches(query) {
    var matches = [];
    if (!query || !current || !current.detailText) return matches;
    current.detailText.forEach(function (slide, number) {
      [["text", slide.text], ["notes", slide.notes]].forEach(function (part) {
        var haystack = lowered(part[1]);
        var at = haystack.indexOf(query);
        var nth = 0;
        while (at >= 0 && matches.length < 5000) {
          matches.push({ slide: number, where: part[0], nth: nth });
          nth += 1;
          at = haystack.indexOf(query, at + Math.max(1, query.length));
        }
      });
    });
    return matches;
  }

  function runSearch(resetIndex) {
    window.clearTimeout(searchTimer);
    searchTimer = 0;
    var query = lowered(elements.findInput.value.trim());
    search.query = query;
    search.matches = collectMatches(query);
    if (resetIndex || search.index >= search.matches.length) {
      search.index = -1;
      if (current) {
        // Start from the first match on or after the slide being read.
        for (var i = 0; i < search.matches.length; i += 1) {
          if (search.matches[i].slide >= current.slide) {
            search.index = i;
            break;
          }
        }
        if (search.index < 0 && search.matches.length) search.index = 0;
      }
    }
    selectMatch(search.index);
  }

  function scheduleSearch() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () { runSearch(true); }, SEARCH_PAUSE_MS);
  }

  function updateFindCount() {
    if (!search.query) {
      elements.findCount.textContent = "";
    } else if (!search.matches.length) {
      elements.findCount.textContent = current && current.detailText ? t("find.none") : "";
    } else {
      elements.findCount.textContent = t("find.count", { current: search.index + 1, total: search.matches.length });
    }
  }

  function selectMatch(index) {
    search.index = index;
    updateFindCount();
    var match = search.matches[index];
    if (match && current) {
      if (match.where === "notes" && !notesOpen) {
        notesOpen = true;
        showNotes();
      }
      if (match.slide !== current.slide) {
        showSlide(match.slide);
        return;
      }
    }
    highlightStage();
    highlightNotes();
  }

  function moveSearch(direction) {
    if (searchTimer) runSearch(true);
    if (!search.matches.length) return;
    selectMatch((search.index + direction + search.matches.length) % search.matches.length);
  }

  function clearSearch() {
    window.clearTimeout(searchTimer);
    searchTimer = 0;
    search = { query: "", matches: [], index: -1 };
    updateFindCount();
    highlightStage();
    highlightNotes();
  }

  // Ranges of the query in a container's text, in document order.
  function rangesIn(container, query) {
    var ranges = [];
    if (!container || !query) return ranges;
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return node.parentElement.closest(".bullet, .missing") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      var node = walker.currentNode;
      var text = lowered(node.data);
      var at = text.indexOf(query);
      while (at >= 0) {
        var range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + query.length);
        ranges.push(range);
        at = text.indexOf(query, at + Math.max(1, query.length));
      }
    }
    return ranges;
  }

  var highlightsAvailable = !!(window.CSS && CSS.highlights && window.Highlight);
  var highlightSets = { stage: [], notes: [] };

  function paintHighlights() {
    if (!highlightsAvailable) return;
    var all = [], currentRanges = [];
    ["stage", "notes"].forEach(function (key) {
      highlightSets[key].forEach(function (entry) {
        all.push(entry.range);
        if (entry.current) currentRanges.push(entry.range);
      });
    });
    CSS.highlights.set("leanslides-find", new Highlight(...all));
    CSS.highlights.set("leanslides-find-current", new Highlight(...currentRanges));
  }

  function currentMatchOn(where) {
    var match = search.matches[search.index];
    return match && current && match.slide === current.slide && match.where === where ? match.nth : -1;
  }

  // A slide's text is matched in the drawn slide; a run split across shapes
  // may number its matches differently from details.json, so the current
  // match falls back to the first one on the slide.
  function highlightStage() {
    var slide = elements.stage.querySelector("[data-rendered-slide]");
    var ranges = rangesIn(slide, search.query);
    var nth = currentMatchOn("text");
    highlightSets.stage = ranges.map(function (range, index) {
      return { range: range, current: index === (nth >= ranges.length ? 0 : nth) };
    });
    paintHighlights();
  }

  function highlightNotes() {
    var ranges = notesOpen ? rangesIn(elements.notesText, search.query) : [];
    var nth = currentMatchOn("notes");
    highlightSets.notes = ranges.map(function (range, index) {
      return { range: range, current: index === nth };
    });
    paintHighlights();
    var target = highlightSets.notes.find(function (entry) { return entry.current; });
    if (target) {
      var box = target.range.getBoundingClientRect();
      var panel = elements.notesPanel.getBoundingClientRect();
      if (box.top < panel.top || box.bottom > panel.bottom) {
        elements.notesPanel.scrollTop += box.top - panel.top - panel.height / 3;
      }
    }
  }

  // ---------------------------------------------------------------- copy

  function copyWithCommand(text) {
    var copied = false;
    function fill(event) {
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      copied = true;
    }
    document.addEventListener("copy", fill);
    try {
      document.execCommand("copy");
    } finally {
      document.removeEventListener("copy", fill);
    }
    return copied ? Promise.resolve() : Promise.reject(new Error("Copy failed."));
  }

  function writeClipboardText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return copyWithCommand(text); });
    }
    return copyWithCommand(text);
  }

  // The slide's text as details.json has it (paragraphs on their own lines),
  // or the drawn text before details arrive.
  function slideText() {
    if (!current) return "";
    var detail = current.detailText ? current.detailText[current.slide] : null;
    if (detail) return String(detail.text || "");
    var slide = elements.stage.querySelector("[data-rendered-slide]");
    return slide ? slide.innerText.trim() : "";
  }

  function copySlide() {
    if (!current) return;
    writeClipboardText(slideText()).then(function () {
      announce(t("copy.slide"));
      showStatus(t("copy.slide"), "info");
    }, function () {
      showStatus(t("copy.failed"), "error");
    });
  }

  // --------------------------------------------------------------- links

  // A link in a slide opens only after the reader confirms it; the host
  // checks it again (src/core/Links.h) before Windows opens it.
  function askToOpenLink(href) {
    if (!/^(https?:|mailto:)/i.test(href)) {
      showStatus(t("link.refused"), "warning");
      return;
    }
    pendingLink = href;
    linkReturnFocus = document.activeElement;
    elements.linkTarget.textContent = href;
    elements.linkDialog.hidden = false;
    root.setAttribute("data-dialog-open", "");
    elements.linkCancel.focus();
  }

  function closeLinkDialog(open) {
    if (elements.linkDialog.hidden) return;
    elements.linkDialog.hidden = true;
    root.removeAttribute("data-dialog-open");
    if (open && pendingLink) post({ type: "link", href: pendingLink });
    pendingLink = "";
    if (linkReturnFocus && linkReturnFocus.isConnected) linkReturnFocus.focus({ preventScroll: true });
    linkReturnFocus = null;
  }

  // ---------------------------------------------------------------- zoom

  function updateZoomLabel() {
    var label = zoomMode === "fit" ? t("zoom.fit") : Math.round(zoomFactor * 100) + "%";
    elements.zoomValue.textContent = label;
    elements.zoomValue.setAttribute("aria-label", t("zoom.level", { level: label }));
  }

  // Steps from the zoom on screen: from Fit, the step nearest the fitted size.
  function stepZoom(direction) {
    if (!current) return;
    var shown = stageScale() / PX_PER_POINT;
    var next = direction > 0
      ? ZOOM_STEPS.find(function (step) { return step > shown + 0.001; })
      : ZOOM_STEPS.slice().reverse().find(function (step) { return step < shown - 0.001; });
    if (next === undefined) return;
    zoomMode = "fixed";
    zoomFactor = next;
    layoutStage();
  }

  function fitToWindow() {
    zoomMode = "fit";
    layoutStage();
  }

  // ------------------------------------------------------ notice and state

  function noticeKey() {
    return current ? idKey(current.tab) + "/" + current.fileName : "";
  }

  function showNotice(index) {
    var notDrawn = [];
    var macros = false;
    var linked = false;
    (index.features || []).forEach(function (feature) {
      if (feature.code === "macros" || feature.code === "activex") macros = true;
      if (feature.code === "linked-media") linked = true;
      if (feature.notDrawn) {
        var name = Strings.has("feature." + feature.code) ? t("feature." + feature.code) : feature.singular;
        notDrawn.push(feature.count > 1 ? name + " (" + feature.count + ")" : name);
      }
    });
    var sentences = [];
    if (notDrawn.length) sentences.push(t("notice.notDrawn", { items: notDrawn.join(t("list.separator")) }));
    if (macros) sentences.push(t("notice.macros"));
    if (linked) sentences.push(t("notice.linked"));
    elements.noticeText.textContent = sentences.join(" ");
    elements.notice.hidden = !sentences.length || collapsedNotices.has(noticeKey());
  }

  function setControlsEnabled(enabled) {
    elements.findInput.disabled = !enabled;
    [elements.zoomIn, elements.zoomOut, elements.zoomValue, elements.notesButton].forEach(function (button) {
      button.disabled = !enabled;
    });
  }

  function showState(kind, eyebrow, title, message) {
    elements.readerPane.hidden = true;
    elements.statePane.hidden = false;
    elements.statePane.dataset.state = kind;
    elements.stateEyebrow.textContent = eyebrow;
    elements.stateTitle.textContent = title;
    elements.stateMessage.textContent = message;
    elements.notice.hidden = true;
    root.removeAttribute("data-has-document");
    elements.recentSection.hidden = kind !== "empty" || !elements.recentList.childElementCount;
    setControlsEnabled(false);
    updateEditorButtons();
  }

  function setIdentity(name, meta, path) {
    elements.fileName.textContent = name || t("app.name");
    elements.fileName.title = path || "";
    elements.fileMeta.textContent = meta;
    document.title = name ? name + " · LeanSlides" : "LeanSlides";
  }

  function renderRecent(recent) {
    var fragment = document.createDocumentFragment();
    (Array.isArray(recent) ? recent : []).slice(0, 10).forEach(function (entry) {
      var path = entry && typeof entry.path === "string" ? entry.path : "";
      if (!path) return;
      var name = entry.name ? String(entry.name) : path.split(/[\\/]/).pop();
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "recent-item";
      button.dataset.path = path;
      button.setAttribute("aria-label", t("state.openRecent", { name: name, path: path }));
      var nameNode = document.createElement("span");
      nameNode.className = "recent-name";
      nameNode.textContent = name;
      var pathNode = document.createElement("span");
      pathNode.className = "recent-path";
      pathNode.textContent = path;
      button.append(nameNode, pathNode);
      item.appendChild(button);
      fragment.appendChild(item);
    });
    elements.recentList.replaceChildren(fragment);
  }

  function fallbackText(report) {
    switch (report.kind) {
      case "legacy-ppt": return [t("state.legacyTitle"), t("state.legacyMessage")];
      case "encrypted-ooxml": return [t("state.encryptedTitle"), t("state.encryptedMessage")];
      case "odp": return [t("state.odpTitle"), t("state.odpMessage")];
      default: break;
    }
    if (report.errorCode && Strings.has("error." + report.errorCode)) {
      return [t("state.errorTitle"), t("error." + report.errorCode)];
    }
    return [t("state.notPresentationTitle"), t("state.notPresentationMessage")];
  }

  function leaveDeck() {
    current = null;
    queue.forEach(function (job) { job.reject(stale()); });
    queue = [];
    if (thumbObserver) thumbObserver.disconnect();
    if (thumbReleaser) thumbReleaser.disconnect();
    elements.thumbList.replaceChildren();
    elements.stage.replaceChildren();
    clearSearch();
    showNotes();
  }

  function receiveEmpty(data) {
    leaveDeck();
    renderRecent(data.recent);
    setIdentity("", t("app.tagline"), "");
    showState("empty", t("app.name"), t("state.emptyTitle"), t("state.emptyMessage"));
    root.dataset.renderState = "empty";
  }

  function receiveFallback(data) {
    leaveDeck();
    var text = fallbackText(data.report && typeof data.report === "object" ? data.report : {});
    var name = String(data.fileName || "");
    setIdentity(name, t("state.notShown"), String(data.displayPath || ""));
    showState("fallback", text[0], name, text[1]);
    root.dataset.renderState = "fallback";
  }

  function receiveDocument(message) {
    var index = message.index && typeof message.index === "object" ? message.index : {};
    var previous = current;
    current = {
      tab: message.tab,
      generation: message.generation,
      fileName: String(message.fileName || ""),
      displayPath: String(message.displayPath || ""),
      deckUrl: String(message.deckUrl || ""),
      index: index,
      count: Number(index.slideCount) || 0,
      slide: -1,
      models: new Map(),
      details: null,
      detailText: null,
      unknownPresets: {}
    };
    queue = queue.filter(function (job) {
      if (job.deck === current) return true;
      job.reject(stale());
      return false;
    });
    shapeFailures = 0;
    delete root.dataset.shapeFailures;
    root.dataset.slides = String(current.count);
    root.dataset.renderState = "loading";
    setIdentity(current.fileName, t("slide.count", { count: current.count }), current.displayPath);
    elements.statePane.hidden = true;
    elements.readerPane.hidden = false;
    root.setAttribute("data-has-document", "");
    setControlsEnabled(true);
    showNotice(index);
    if (search.query) {
      search.matches = [];
      search.index = -1;
      updateFindCount();
    }
    if (!current.count) {
      elements.thumbList.replaceChildren();
      elements.stage.replaceChildren();
      showState("empty", t("app.name"), current.fileName, t("slide.empty"));
      root.setAttribute("data-has-document", "");
      root.dataset.renderState = "ready";
      post({ type: "rendered", tab: current.tab, generation: current.generation, slide: 0, ms: 0 });
      return;
    }
    buildThumbs(current);
    // The same tab read again (the file changed on disk) keeps its place.
    var keep = previous && sameId(previous.tab, current.tab) && previous.slide >= 0 ? previous.slide : 0;
    showSlide(Math.min(keep, current.count - 1));
  }

  // ---------------------------------------------------------------- tabs

  function tabLabel(tab, duplicateNames) {
    if (!duplicateNames.has(tab.name.toLocaleLowerCase())) return tab.name;
    var parts = tab.path.split(/[\\/]/).filter(Boolean);
    return parts.length > 1 ? tab.name + " · " + parts[parts.length - 2] : tab.name;
  }

  function renderTabs() {
    var visible = tabs.length > 1;
    elements.tabStrip.hidden = !visible;
    elements.tabStrip.setAttribute("aria-label", t("tabs.label"));
    var seen = new Set();
    var duplicates = new Set();
    tabs.forEach(function (tab) {
      var key = tab.name.toLocaleLowerCase();
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    });
    var fragment = document.createDocumentFragment();
    tabs.forEach(function (tab) {
      var selected = sameId(tab.id, activeTabId);
      var item = document.createElement("div");
      item.className = "tab";
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", selected ? "true" : "false");
      item.setAttribute("aria-controls", "readerPane");
      item.tabIndex = selected ? 0 : -1;
      item.dataset.tabKey = idKey(tab.id);
      item.title = tab.path;
      var label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tabLabel(tab, duplicates);
      var close = document.createElement("span");
      close.className = "tab-close";
      // A tab may not contain a control (ARIA), so the close mark is for the
      // pointer only; the keyboard closes a tab with Delete or Ctrl+W.
      close.title = shortcut(t("tabs.close"));
      close.setAttribute("aria-hidden", "true");
      item.setAttribute("aria-keyshortcuts", isMac ? "Delete Meta+W" : "Delete Control+W");
      item.append(label, close);
      fragment.appendChild(item);
    });
    elements.tabStrip.replaceChildren(fragment);
    var selectedTab = elements.tabStrip.querySelector('[aria-selected="true"]');
    if (visible && selectedTab) {
      selectedTab.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (focusTabAfterRender) selectedTab.focus();
    }
    focusTabAfterRender = false;
  }

  function receiveTabs(data) {
    tabs = (Array.isArray(data.tabs) ? data.tabs.slice(0, 1000) : [])
      .filter(function (tab) { return tab && idKey(tab.id) !== ""; })
      .map(function (tab) {
        return { id: tab.id, name: String(tab.name || ""), path: String(tab.path || "") };
      });
    activeTabId = data.active === undefined ? null : data.active;
    renderTabs();
  }

  function tabFrom(target) {
    var node = target && target.closest ? target.closest(".tab") : null;
    if (!node) return null;
    for (var index = 0; index < tabs.length; index += 1) {
      if (idKey(tabs[index].id) === node.dataset.tabKey) return tabs[index];
    }
    return null;
  }

  function tabIndex(id) {
    for (var index = 0; index < tabs.length; index += 1) {
      if (sameId(tabs[index].id, id)) return index;
    }
    return -1;
  }

  function selectTab(id, moveFocus) {
    if (idKey(id) === "" || sameId(id, activeTabId)) return;
    focusTabAfterRender = !!moveFocus;
    post({ type: "selectTab", id: id });
  }

  function closeTab(id) {
    if (idKey(id) !== "") post({ type: "closeTab", id: id });
  }

  function cycleTab(direction) {
    if (tabs.length < 2) return;
    var index = Math.max(0, tabIndex(activeTabId));
    selectTab(tabs[(index + direction + tabs.length) % tabs.length].id, false);
  }

  // ------------------------------------------------------- host messages

  function receive(raw) {
    var data = raw;
    if (typeof raw === "string") {
      try {
        data = JSON.parse(raw);
      } catch (_error) {
        return;
      }
    }
    if (!data || typeof data !== "object") return;
    switch (data.type) {
      case "host": receiveHost(data); break;
      case "theme": applyTheme(data.theme); break;
      case "tabs": receiveTabs(data); break;
      case "document": receiveDocument(data); break;
      case "fallback": receiveFallback(data); break;
      case "empty": receiveEmpty(data); break;
      case "status": showStatus(String(data.message || ""), data.tone); break;
      default: break;
    }
  }

  // ----------------------------------------------------------- shortcuts

  function keyName(event) {
    return typeof event.key === "string" ? event.key.toLowerCase() : "";
  }

  function plainModifier(letter) {
    return function (event) {
      return modifier(event) && !event.altKey && !event.shiftKey && keyName(event) === letter;
    };
  }

  function shiftModifier(letter) {
    return function (event) {
      return modifier(event) && event.shiftKey && !event.altKey && keyName(event) === letter;
    };
  }

  function tabsAvailable() { return host.tabs; }
  function enoughTabs() { return tabs.length > 1; }

  // Slide keys act on the page, the stage and the thumbnails, never in a
  // text field, the tab strip, the settings, or a dialog.
  function onSlides(event) {
    if (!current || event.ctrlKey || event.altKey || event.metaKey) return false;
    if (!elements.linkDialog.hidden) return false;
    var target = event.target;
    if (!target || target === document.body || target === root) return true;
    if (target.closest && target.closest("input, textarea, select, [role='tab'], .settings-panel, .link-dialog, .tab-strip")) {
      return false;
    }
    return true;
  }

  function slideKey(keys) {
    return function (event) {
      return onSlides(event) && keys.indexOf(event.key) >= 0 && !(event.key === " " && event.target.closest &&
        event.target.closest("button"));
    };
  }

  var readerShortcuts = [
    { group: "group.reader", keys: "Ctrl+O", label: "shortcut.open",
      match: plainModifier("o"), run: function () { post({ type: "open" }); } },
    { group: "group.reader", keys: "Ctrl+F", label: "shortcut.find", match: plainModifier("f"),
      run: function () {
        if (!elements.findInput.disabled) {
          elements.findInput.focus();
          elements.findInput.select();
        }
      } },
    { group: "group.reader", keys: "F3", label: "shortcut.nextMatch",
      match: function (event) { return event.key === "F3" && !event.shiftKey; }, run: function () { moveSearch(1); } },
    { group: "group.reader", keys: "Shift+F3", label: "shortcut.previousMatch",
      match: function (event) { return event.key === "F3" && event.shiftKey; }, run: function () { moveSearch(-1); } },
    { group: "group.reader", keys: "Ctrl+R", label: "shortcut.reload",
      match: plainModifier("r"), run: function () { post({ type: "reload" }); } },
    { group: "group.reader", keys: "Ctrl+Shift+N", label: "shortcut.notes",
      match: shiftModifier("n"), run: toggleNotes },
    { group: "group.reader", keys: "Ctrl+Shift+T", label: "shortcut.theme",
      match: shiftModifier("t"), run: cycleTheme },
    { group: "group.reader", keys: "Ctrl+Shift+E", label: "shortcut.editor",
      match: shiftModifier("e"), run: openInEditor },
    { group: "group.reader", keys: "Ctrl+Shift+C", label: "shortcut.copy",
      match: shiftModifier("c"), run: copySlide },
    { group: "group.reader", keys: "Ctrl++", label: "shortcut.zoomIn",
      match: function (event) { return modifier(event) && !event.altKey && (event.key === "+" || event.key === "="); },
      run: function () { stepZoom(1); } },
    { group: "group.reader", keys: "Ctrl+-", label: "shortcut.zoomOut",
      match: function (event) { return modifier(event) && !event.altKey && (event.key === "-" || event.key === "_"); },
      run: function () { stepZoom(-1); } },
    { group: "group.reader", keys: "Ctrl+0", label: "shortcut.fit",
      match: function (event) { return modifier(event) && !event.altKey && event.key === "0"; },
      run: fitToWindow },
    { group: "group.reader", keys: "Ctrl+/", label: "shortcut.settings",
      match: function (event) { return modifier(event) && !event.altKey && event.key === "/"; },
      run: function () { openSettings(false); } },
    { group: "group.reader", keys: "F1", label: "shortcut.settings",
      match: function (event) { return event.key === "F1" && !modifier(event) && !event.altKey; },
      run: function () { openSettings(false); } },
    { group: "group.reader", keys: "Esc", label: "shortcut.closeSettings",
      match: function (event) { return event.key === "Escape" && !elements.settingsPanel.hidden; },
      run: function () { closeSettings(true); } },
    { group: "group.slides", keys: "key.arrowsNext", label: "shortcut.nextSlide",
      match: slideKey(["ArrowRight", "ArrowDown", "PageDown", " "]), run: function () { go(current.slide + 1); } },
    { group: "group.slides", keys: "key.arrowsPrevious", label: "shortcut.previousSlide",
      match: slideKey(["ArrowLeft", "ArrowUp", "PageUp"]), run: function () { go(current.slide - 1); } },
    { group: "group.slides", keys: "Home", label: "shortcut.firstSlide",
      match: slideKey(["Home"]), run: function () { go(0); } },
    { group: "group.slides", keys: "End", label: "shortcut.lastSlide",
      match: slideKey(["End"]), run: function () { go(current.count - 1); } },
    { group: "group.tabs", keys: "Ctrl+Tab", label: "shortcut.nextTab", available: tabsAvailable,
      match: function (event) { return event.ctrlKey && !event.shiftKey && event.key === "Tab" && enoughTabs(); },
      run: function () { cycleTab(1); } },
    { group: "group.tabs", keys: "Ctrl+Shift+Tab", label: "shortcut.previousTab", available: tabsAvailable,
      match: function (event) { return event.ctrlKey && event.shiftKey && event.key === "Tab" && enoughTabs(); },
      run: function () { cycleTab(-1); } },
    { group: "group.tabs", keys: "Ctrl+Page Down", label: "shortcut.nextTab", available: tabsAvailable,
      match: function (event) { return event.ctrlKey && event.key === "PageDown" && enoughTabs(); },
      run: function () { cycleTab(1); } },
    { group: "group.tabs", keys: "Ctrl+Page Up", label: "shortcut.previousTab", available: tabsAvailable,
      match: function (event) { return event.ctrlKey && event.key === "PageUp" && enoughTabs(); },
      run: function () { cycleTab(-1); } },
    { group: "group.tabs", keys: "Ctrl+W", label: "shortcut.closeTab", available: tabsAvailable,
      match: function (event) { return plainModifier("w")(event) && host.tabs && idKey(activeTabId) !== ""; },
      run: function () { closeTab(activeTabId); } },
    { group: "group.tabs", keys: "key.tabNumbers", label: "shortcut.tabByPosition", available: tabsAvailable,
      match: function (event) {
        return modifier(event) && !event.shiftKey && !event.altKey && /^[1-8]$/.test(event.key) && enoughTabs();
      },
      run: function (event) {
        var target = tabs[Number(event.key) - 1];
        if (target) selectTab(target.id, false);
      } },
    { group: "group.tabs", keys: "Ctrl+9", label: "shortcut.lastTab", available: tabsAvailable,
      match: function (event) {
        return modifier(event) && !event.shiftKey && !event.altKey && event.key === "9" && enoughTabs();
      },
      run: function () { selectTab(tabs[tabs.length - 1].id, false); } }
  ];

  var findShortcuts = [
    { group: "group.find", keys: "Enter", label: "shortcut.nextMatch",
      match: function (event) { return event.key === "Enter" && !event.shiftKey; }, run: function () { moveSearch(1); } },
    { group: "group.find", keys: "Shift+Enter", label: "shortcut.previousMatch",
      match: function (event) { return event.key === "Enter" && event.shiftKey; }, run: function () { moveSearch(-1); } },
    { group: "group.find", keys: "Esc", label: "shortcut.clearSearch",
      match: function (event) { return event.key === "Escape"; },
      run: function () {
        elements.findInput.value = "";
        clearSearch();
        elements.stage.focus();
      } }
  ];

  var tabStripShortcuts = [
    { match: function (event) { return event.key === "ArrowRight"; },
      run: function (_event, _id, index) { selectTab(tabs[(index + 1) % tabs.length].id, true); } },
    { match: function (event) { return event.key === "ArrowLeft"; },
      run: function (_event, _id, index) { selectTab(tabs[(index - 1 + tabs.length) % tabs.length].id, true); } },
    { match: function (event) { return event.key === "Home"; },
      run: function () { selectTab(tabs[0].id, true); } },
    { match: function (event) { return event.key === "End"; },
      run: function () { selectTab(tabs[tabs.length - 1].id, true); } },
    { match: function (event) { return event.key === "Delete"; },
      run: function (_event, id) { closeTab(id); } }
  ];

  function findShortcut(table, event) {
    for (var index = 0; index < table.length; index += 1) {
      if (table[index].match(event)) return table[index];
    }
    return null;
  }

  function keyLabel(keys) {
    return shortcut(Strings.has(keys) ? t(keys) : keys);
  }

  function renderShortcutList() {
    var fragment = document.createDocumentFragment();
    var currentGroup = "";
    var list = null;
    readerShortcuts.concat(findShortcuts).forEach(function (entry) {
      if (entry.available && !entry.available()) return;
      if (entry.group !== currentGroup) {
        currentGroup = entry.group;
        var heading = document.createElement("h4");
        heading.textContent = t(entry.group);
        list = document.createElement("dl");
        fragment.append(heading, list);
      }
      var row = document.createElement("div");
      row.className = "shortcut-row";
      var keys = document.createElement("dt");
      var kbd = document.createElement("kbd");
      kbd.textContent = keyLabel(entry.keys);
      keys.appendChild(kbd);
      var label = document.createElement("dd");
      label.textContent = t(entry.label);
      row.append(keys, label);
      list.appendChild(row);
    });
    elements.shortcutList.replaceChildren(fragment);
  }

  // --------------------------------------------------------------- settings

  function updateSettingsPanel() {
    elements.settingsPanel.querySelectorAll('input[name="settings-theme"]').forEach(function (input) {
      input.checked = input.value === currentTheme;
    });
  }

  function placeSettingsPanel() {
    root.style.setProperty("--chrome-bottom", Math.round(elements.chrome.getBoundingClientRect().bottom) + "px");
  }

  function openSettings(fromButton) {
    if (elements.settingsPanel.hidden) {
      settingsReturnFocus = fromButton ? elements.settingsButton : document.activeElement;
      renderShortcutList();
      updateSettingsPanel();
      placeSettingsPanel();
      elements.settingsPanel.hidden = false;
      root.setAttribute("data-settings-open", "");
      elements.settingsButton.setAttribute("aria-expanded", "true");
      layoutStage();
    }
    var checked = elements.settingsPanel.querySelector('input[name="settings-theme"]:checked');
    (checked || elements.settingsClose).focus({ preventScroll: true });
  }

  function closeSettings(restoreFocus) {
    if (elements.settingsPanel.hidden) return;
    elements.settingsPanel.hidden = true;
    root.removeAttribute("data-settings-open");
    elements.settingsButton.setAttribute("aria-expanded", "false");
    layoutStage();
    var target = settingsReturnFocus && settingsReturnFocus.isConnected &&
      settingsReturnFocus !== document.body && settingsReturnFocus !== root
      ? settingsReturnFocus : elements.settingsButton;
    settingsReturnFocus = null;
    if (restoreFocus) target.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- events

  elements.openButton.addEventListener("click", function () { post({ type: "open" }); });
  elements.stateOpenButton.addEventListener("click", function () { post({ type: "open" }); });
  [elements.editorButton, elements.stateEditorButton].forEach(function (button) {
    button.addEventListener("click", openInEditor);
  });
  elements.themeButton.addEventListener("click", cycleTheme);
  elements.notesButton.addEventListener("click", toggleNotes);
  elements.zoomIn.addEventListener("click", function () { stepZoom(1); });
  elements.zoomOut.addEventListener("click", function () { stepZoom(-1); });
  elements.zoomValue.addEventListener("click", function () {
    if (zoomMode === "fit") {
      zoomMode = "fixed";
      zoomFactor = 1;
      layoutStage();
    } else {
      fitToWindow();
    }
  });
  elements.noticeClose.addEventListener("click", function () {
    collapsedNotices.add(noticeKey());
    elements.notice.hidden = true;
    layoutStage();
  });
  elements.recentList.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest(".recent-item") : null;
    if (button) post({ type: "openRecent", path: button.dataset.path });
  });
  elements.clearRecent.addEventListener("click", function () {
    post({ type: "clearRecent" });
    elements.recentList.replaceChildren();
    elements.recentSection.hidden = true;
  });
  elements.thumbList.addEventListener("click", function (event) {
    var item = event.target.closest ? event.target.closest(".thumb") : null;
    if (item) go(Number(item.dataset.slide));
  });
  elements.stage.addEventListener("click", function (event) {
    var link = event.target.closest ? event.target.closest(".slide-link") : null;
    if (link) {
      event.preventDefault();
      askToOpenLink(link.dataset.href || "");
    }
  });
  elements.stage.addEventListener("keydown", function (event) {
    var link = event.target.closest ? event.target.closest(".slide-link") : null;
    if (link && event.key === "Enter") {
      event.preventDefault();
      askToOpenLink(link.dataset.href || "");
    }
  });
  elements.stage.addEventListener("dragstart", function (event) {
    if (event.target.closest && event.target.closest("a, img")) event.preventDefault();
  });
  elements.stage.addEventListener("wheel", function (event) {
    if (!(event.ctrlKey || (isMac && event.metaKey)) || !current) return;
    event.preventDefault();
    stepZoom(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  elements.linkCancel.addEventListener("click", function () { closeLinkDialog(false); });
  elements.linkOpen.addEventListener("click", function () { closeLinkDialog(true); });
  elements.linkDialog.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeLinkDialog(false);
    } else if (event.key === "Tab") {
      // The two buttons keep the focus while the dialog is open.
      event.preventDefault();
      (document.activeElement === elements.linkCancel ? elements.linkOpen : elements.linkCancel).focus();
    }
  });

  elements.tabStrip.addEventListener("click", function (event) {
    var tab = tabFrom(event.target);
    if (!tab) return;
    if (event.target.closest(".tab-close")) closeTab(tab.id);
    else selectTab(tab.id, false);
  });
  elements.tabStrip.addEventListener("auxclick", function (event) {
    var tab = event.button === 1 ? tabFrom(event.target) : null;
    if (tab) {
      event.preventDefault();
      closeTab(tab.id);
    }
  });
  elements.tabStrip.addEventListener("keydown", function (event) {
    var tab = tabFrom(event.target);
    var index = tab ? tabIndex(tab.id) : -1;
    if (index < 0) return;
    var entry = findShortcut(tabStripShortcuts, event);
    if (entry) {
      event.preventDefault();
      entry.run(event, tab.id, index);
    }
  });

  elements.findInput.addEventListener("input", scheduleSearch);
  elements.findInput.addEventListener("keydown", function (event) {
    var entry = findShortcut(findShortcuts, event);
    if (entry) {
      event.preventDefault();
      entry.run(event);
    }
  });

  elements.settingsButton.addEventListener("click", function () {
    if (elements.settingsPanel.hidden) openSettings(true);
    else closeSettings(true);
  });
  elements.settingsClose.addEventListener("click", function () { closeSettings(true); });
  elements.settingsPanel.addEventListener("change", function (event) {
    if (event.target.name === "settings-theme") {
      applyTheme(event.target.value);
      post({ type: "setTheme", theme: currentTheme });
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented || !elements.linkDialog.hidden) return;
    var entry = findShortcut(readerShortcuts, event);
    if (entry) {
      event.preventDefault();
      entry.run(event);
    }
  });

  window.addEventListener("resize", function () {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(function () {
      if (!elements.settingsPanel.hidden) placeSettingsPanel();
      layoutStage();
    });
  });
  if (systemTheme.addEventListener) {
    systemTheme.addEventListener("change", function () { applyTheme(currentTheme); });
  }

  // Hosts deliver messages through the WebView2 bridge; tests may also use
  // a "leanslides-message" event or LeanSlidesHost.receive(message).
  if (bridge && bridge.addEventListener) {
    bridge.addEventListener("message", function (event) { receive(event.data); });
  }
  window.addEventListener("leanslides-message", function (event) { receive(event.detail); });
  window.LeanSlidesHost = Object.freeze({ receive: receive });

  applyStrings();
  setControlsEnabled(false);
  root.dataset.renderState = "empty";
  post({ type: "ready" });
})();
