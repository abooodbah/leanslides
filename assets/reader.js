// The LeanSlides reader: takes the deck the host sends, fetches one slide
// model at a time from the host (docs/HOST.md), draws it with render.js,
// fits it to the window, and reports each drawn slide to the host.
(function () {
  "use strict";

  var bridge = window.chrome && window.chrome.webview;
  var Geometry = window.LeanSlidesGeometry;
  var Render = window.LeanSlidesRender;
  var Strings = window.LeanSlidesStrings;
  var root = document.documentElement;
  var elements = {
    stage: document.getElementById("stage"),
    counter: document.getElementById("slideCounter"),
    notice: document.getElementById("notice"),
    noticeText: document.getElementById("noticeText"),
    state: document.getElementById("statePane"),
    stateTitle: document.getElementById("stateTitle"),
    stateMessage: document.getElementById("stateMessage")
  };

  var EMU_PER_POINT = 12700;
  var STAGE_MARGIN = 24;
  // Slide models kept in memory, most recently used last.
  var MODEL_CACHE = 24;
  // Requests to the host at once. The stage slide always goes first.
  var MAX_FETCHES = 2;

  var language = "en";
  var presets = null;
  var presetsReady = fetch("presets.json")
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (value) { presets = value; }, function () { presets = null; });

  // The deck on screen: the host's document message plus what the reader
  // has learned about it. Replaced, never mutated, when a new deck arrives.
  var current = null;
  var queue = [];
  var active = 0;
  var shapeFailures = 0;
  var resizeFrame = 0;

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

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  // ------------------------------------------------------ fetching models

  // Runs queued requests, highest priority (lowest number) first.
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

  function stale() {
    var error = new Error("stale");
    error.stale = true;
    return error;
  }

  function fetchModel(deck, number) {
    return fetch(deck.deckUrl + "slide/" + number + ".json").then(function (response) {
      if (deck !== current) throw stale();
      if (!response.ok) throw new Error("slide request failed: " + response.status);
      return response.json();
    });
  }

  // A model from the cache, or fetched through the queue. A slide the core
  // cannot build comes back as {"error": code}.
  function loadModel(deck, number, priority) {
    var cached = deck.models.get(number);
    if (cached) {
      deck.models.delete(number);
      deck.models.set(number, cached);
      return cached;
    }
    var promise = new Promise(function (resolve, reject) {
      queue.push({
        deck: deck, priority: priority, resolve: resolve, reject: reject,
        run: function () { return fetchModel(deck, number); }
      });
      pump();
    });
    deck.models.set(number, promise);
    promise.catch(function () {
      if (deck.models.get(number) === promise) deck.models.delete(number);
    });
    while (deck.models.size > MODEL_CACHE) {
      deck.models.delete(deck.models.keys().next().value);
    }
    return promise;
  }

  // ------------------------------------------------------------- drawing

  function mediaUrl(id) {
    return current.deckUrl + "media?id=" + encodeURIComponent(id);
  }

  var drawContext = {
    mediaUrl: function (id) { return mediaUrl(id); },
    geometry: function (geom, w, h) { return Geometry.build(geom, w, h, presets); },
    missingLabel: function (kind) { return t("missing." + (kind || "absent")); },
    featureLabel: function (code, label) {
      return Strings.has("feature." + code) ? t("feature." + code) : (label || code || "");
    },
    unknownPreset: function (name) {
      if (current) current.unknownPresets[name || ""] = true;
    },
    shapeFailed: function (shape, error) {
      shapeFailures += 1;
      root.dataset.shapeFailures = String(shapeFailures);
      if (window.console) console.error("LeanSlides could not draw shape " + (shape && shape.id), error);
    }
  };

  function slideSize(deck, model) {
    return {
      w: (model && model.w || deck.index.slideWidth || 12192000) / EMU_PER_POINT,
      h: (model && model.h || deck.index.slideHeight || 6858000) / EMU_PER_POINT
    };
  }

  // Scales the slide frame to fit the stage, keeping its proportions.
  function fit() {
    var frame = elements.stage.firstElementChild;
    if (!frame || !frame.dataset.width) return;
    var w = Number(frame.dataset.width), h = Number(frame.dataset.height);
    var availableW = Math.max(1, elements.stage.clientWidth - 2 * STAGE_MARGIN);
    var availableH = Math.max(1, elements.stage.clientHeight - 2 * STAGE_MARGIN);
    var scale = Math.min(availableW / w, availableH / h);
    frame.style.width = Math.round(w * scale) + "px";
    frame.style.height = Math.round(h * scale) + "px";
    frame.firstElementChild.style.transform = "scale(" + scale + ")";
  }

  function frameFor(deck, model) {
    var size = slideSize(deck, model);
    var frame = document.createElement("div");
    frame.className = "slide-frame";
    frame.dataset.width = String(size.w);
    frame.dataset.height = String(size.h);
    return frame;
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

  function place(frame, slide) {
    frame.appendChild(slide);
    elements.stage.replaceChildren(frame);
    fit();
  }

  function updateCounter(deck) {
    elements.counter.textContent = t("slide.position", { current: deck.slide + 1, total: deck.count });
  }

  // Shows slide `number` of the current deck.
  function showSlide(number) {
    var deck = current;
    if (!deck || number < 0 || number >= deck.count) return;
    deck.slide = number;
    updateCounter(deck);
    var started = now();
    Promise.all([presetsReady, loadModel(deck, number, 0)]).then(function (values) {
      if (deck !== current || deck.slide !== number) return;
      var model = values[1];
      if (!model || model.error) {
        place(frameFor(deck, null), failedSlide(deck, number));
        root.dataset.renderState = "ready";
      } else {
        var slide = Render.drawSlide(model, drawContext);
        slide.setAttribute("data-rendered-slide", String(number));
        place(frameFor(deck, model), slide);
        root.dataset.renderState = "ready";
        post({ type: "rendered", tab: deck.tab, generation: deck.generation, slide: number,
               ms: Math.round(now() - started) });
      }
      prefetch(deck, number);
    }).catch(function (error) {
      if (error && error.stale || deck !== current) return;
      if (deck.slide !== number) return;
      root.dataset.renderState = "failed";
      showState(t("state.drawFailed"), "");
      post({ type: "renderFailed", tab: deck.tab, generation: deck.generation,
             message: String(error && error.message || error) });
    });
  }

  // The neighbours load while the reader looks at this slide.
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

  // ------------------------------------------------------- notice and state

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
    if (notDrawn.length) sentences.push(t("notice.notDrawn", { items: notDrawn.join(", ") }));
    if (macros) sentences.push(t("notice.macros"));
    if (linked) sentences.push(t("notice.linked"));
    elements.noticeText.textContent = sentences.join(" ");
    elements.notice.hidden = !sentences.length;
  }

  function showState(title, message) {
    elements.stage.replaceChildren();
    elements.notice.hidden = true;
    elements.counter.textContent = "";
    elements.stateTitle.textContent = title;
    elements.stateMessage.textContent = message;
    elements.state.hidden = false;
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

  // ------------------------------------------------------- host messages

  function receiveDocument(message) {
    var index = message.index && typeof message.index === "object" ? message.index : {};
    var previous = current;
    current = {
      tab: message.tab,
      generation: message.generation,
      deckUrl: String(message.deckUrl || ""),
      index: index,
      count: Number(index.slideCount) || 0,
      slide: -1,
      models: new Map(),
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
    elements.state.hidden = true;
    showNotice(index);
    if (!current.count) {
      showState(t("slide.empty"), "");
      root.dataset.renderState = "ready";
      post({ type: "rendered", tab: current.tab, generation: current.generation, slide: 0, ms: 0 });
      return;
    }
    // The same file read again (it changed on disk) keeps its place.
    var keep = previous && previous.tab === current.tab && previous.slide >= 0 ? previous.slide : 0;
    showSlide(Math.min(keep, current.count - 1));
  }

  function receive(raw) {
    var message = raw;
    if (typeof raw === "string") {
      try {
        message = JSON.parse(raw);
      } catch (_error) {
        return;
      }
    }
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "theme":
        if (message.theme && message.theme !== "system") root.dataset.theme = message.theme;
        else delete root.dataset.theme;
        break;
      case "document":
        receiveDocument(message);
        break;
      case "fallback": {
        current = null;
        var text = fallbackText(message.report || {});
        showState(text[0], text[1]);
        root.dataset.renderState = "fallback";
        break;
      }
      case "empty":
        current = null;
        showState(t("state.emptyTitle"), t("state.emptyMessage"));
        root.dataset.renderState = "empty";
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- keys

  // Slide keys act only when focus is on the page or the stage, never in a
  // text field, a tab strip, a list of choices, or with a modifier held
  // (Ctrl+Page Down is the next tab).
  function slideKeysApply(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return false;
    var target = event.target;
    if (!target || target === document.body || target === root) return true;
    if (target.closest && target.closest("input, textarea, select, button, [role='tab'], [role='radio'], [contenteditable]")) {
      return false;
    }
    return true;
  }

  document.addEventListener("keydown", function (event) {
    if (!current || !slideKeysApply(event)) return;
    var step = 0;
    switch (event.key) {
      case "ArrowRight": case "ArrowDown": case "PageDown": case " ": step = 1; break;
      case "ArrowLeft": case "ArrowUp": case "PageUp": step = -1; break;
      case "Home": event.preventDefault(); go(0); return;
      case "End": event.preventDefault(); go(current.count - 1); return;
      default: return;
    }
    if (event.shiftKey && event.key === " ") step = -1;
    event.preventDefault();
    go(current.slide + step);
  });

  window.addEventListener("resize", function () {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(fit);
  });

  // Hosts deliver messages through the WebView2 bridge; tests may also use
  // a "leanslides-message" event or LeanSlidesHost.receive(message).
  if (bridge && bridge.addEventListener) {
    bridge.addEventListener("message", function (event) { receive(event.data); });
  }
  window.addEventListener("leanslides-message", function (event) { receive(event.detail); });
  window.LeanSlidesHost = Object.freeze({ receive: receive });

  root.dataset.renderState = "empty";
  post({ type: "ready" });
})();
