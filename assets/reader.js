// A minimal LeanSlides reader: it opens the deck the host sends, draws the
// first slide's text in place, and reports "rendered" so the host smoke test
// can check the whole path. The full reader replaces this file.
(function () {
  "use strict";

  var bridge = window.chrome && window.chrome.webview;
  var stage = document.getElementById("stage");
  var root = document.documentElement;
  var current = null;

  function post(message) {
    if (bridge) bridge.postMessage(JSON.stringify(message));
  }

  function showMessage(text) {
    stage.textContent = "";
    var paragraph = document.createElement("p");
    paragraph.className = "message";
    paragraph.textContent = text;
    stage.appendChild(paragraph);
  }

  function collectText(node, out) {
    if (!node) return;
    if (node.text && node.text.paragraphs) {
      var lines = node.text.paragraphs.map(function (paragraph) {
        return (paragraph.runs || []).map(function (run) { return run.t || ""; }).join("");
      });
      var first = ((node.text.paragraphs[0] || {}).runs || [{}])[0] || {};
      out.push({ node: node, size: first.size || 18, text: lines.join("\n") });
    }
    (node.children || []).forEach(function (child) { collectText(child, out); });
  }

  function draw(model, index, width, height) {
    var scale = Math.min((stage.clientWidth - 48) / width, (stage.clientHeight - 48) / height);
    var slide = document.createElement("div");
    slide.className = "slide";
    slide.style.width = Math.round(width * scale) + "px";
    slide.style.height = Math.round(height * scale) + "px";
    var items = [];
    (model.shapes || []).forEach(function (shape) { collectText(shape, items); });
    items.forEach(function (item) {
      if (!item.text) return;
      // Positions are EMU; font sizes are points (12700 EMU each).
      var text = document.createElement("p");
      text.className = "shape-text";
      text.style.left = item.node.x * scale + "px";
      text.style.top = item.node.y * scale + "px";
      text.style.width = item.node.w * scale + "px";
      text.style.height = item.node.h * scale + "px";
      text.style.fontSize = Math.max(6, item.size * 12700 * scale) + "px";
      text.textContent = item.text;
      slide.appendChild(text);
    });
    slide.setAttribute("data-rendered-slide", String(index));
    stage.textContent = "";
    stage.appendChild(slide);
  }

  function openDocument(message) {
    var started = performance.now();
    current = message;
    var index = message.index || {};
    root.dataset.renderState = "loading";
    root.dataset.slides = String(index.slideCount || 0);
    if (!index.slideCount) {
      showMessage("This presentation has no slides.");
      root.dataset.renderState = "ready";
      post({ type: "rendered", tab: message.tab, generation: message.generation, slide: 0,
             ms: Math.round(performance.now() - started) });
      return;
    }
    fetch(message.deckUrl + "slide/0.json")
      .then(function (response) {
        if (!response.ok) throw new Error("slide request failed: " + response.status);
        return response.json();
      })
      .then(function (model) {
        if (current !== message) return;
        draw(model, 0, model.w || index.slideWidth, model.h || index.slideHeight);
        root.dataset.renderState = "ready";
        post({ type: "rendered", tab: message.tab, generation: message.generation, slide: 0,
               ms: Math.round(performance.now() - started) });
      })
      .catch(function (error) {
        if (current !== message) return;
        root.dataset.renderState = "failed";
        showMessage("LeanSlides could not draw this slide.");
        post({ type: "renderFailed", tab: message.tab, generation: message.generation,
               message: String(error && error.message || error) });
      });
  }

  function receive(event) {
    var message = event.data;
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "theme":
        root.dataset.theme = message.theme || "system";
        break;
      case "document":
        openDocument(message);
        break;
      case "fallback":
        current = message;
        root.dataset.renderState = "fallback";
        showMessage(((message.report || {}).errorMessage) ||
                    "LeanSlides does not show this kind of file.");
        break;
      case "empty":
        current = null;
        root.dataset.renderState = "empty";
        showMessage("Open a presentation to read it.");
        break;
      default:
        break;
    }
  }

  if (bridge) {
    bridge.addEventListener("message", receive);
    post({ type: "ready" });
  } else {
    showMessage("LeanSlides runs inside its Windows host.");
  }
})();
