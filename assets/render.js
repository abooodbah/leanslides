// LeanSlides slide renderer: draws one slide model (docs/MODEL.md) as DOM.
// One CSS pixel is one point (12700 EMU); the caller scales the slide
// element with a transform. Each shape is its own absolutely positioned
// element, so drawing order is the model's order. Geometry is SVG; text is
// HTML so it can be selected, found and copied.
(function () {
  "use strict";

  var EMU = 12700;
  var SVG = "http://www.w3.org/2000/svg";
  var uid = 0;

  function pt(emu) {
    return (emu || 0) / EMU;
  }

  function px(value) {
    return Math.round(value * 1000) / 1000 + "px";
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    }
    return node;
  }

  function nextId(prefix) {
    uid += 1;
    return prefix + uid;
  }

  // ------------------------------------------------------------- colours

  function cssColor(color, alpha) {
    if (!color) return "transparent";
    if (alpha === undefined || alpha >= 1) return color;
    var r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + Math.max(0, alpha) + ")";
  }

  function mix(a, b, amount) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.slice(i, i + 2), 16); });
    var pb = [1, 3, 5].map(function (i) { return parseInt(b.slice(i, i + 2), 16); });
    return "#" + pa.map(function (value, index) {
      var v = Math.round(value * (1 - amount) + pb[index] * amount);
      return (v < 16 ? "0" : "") + v.toString(16);
    }).join("");
  }

  // ------------------------------------------------------------ patterns

  // 8 x 8 bit masks for the preset patterns (20.1.10.51). Each row is one
  // byte, high bit on the left. Unlisted patterns use the 50% mask.
  var PATTERNS = {
    pct5: [0x80, 0, 0, 0, 0x08, 0, 0, 0], pct10: [0x80, 0, 0x08, 0, 0x80, 0, 0x08, 0],
    pct20: [0x88, 0, 0x22, 0, 0x88, 0, 0x22, 0], pct25: [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22],
    pct30: [0xaa, 0x44, 0xaa, 0x11, 0xaa, 0x44, 0xaa, 0x11], pct40: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x11],
    pct50: [0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55], pct60: [0xee, 0x55, 0xbb, 0x55, 0xee, 0x55, 0xbb, 0x55],
    pct70: [0x77, 0xff, 0xdd, 0xff, 0x77, 0xff, 0xdd, 0xff], pct75: [0x77, 0xff, 0xdd, 0xff, 0x77, 0xff, 0xdd, 0xff],
    pct80: [0xf7, 0xff, 0x7f, 0xff, 0xf7, 0xff, 0x7f, 0xff], pct90: [0xff, 0xf7, 0xff, 0xff, 0xff, 0x7f, 0xff, 0xff],
    horz: [0xff, 0, 0, 0, 0xff, 0, 0, 0], vert: [0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88, 0x88],
    ltHorz: [0xff, 0, 0, 0, 0, 0, 0, 0], ltVert: [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80],
    dkHorz: [0xff, 0xff, 0, 0, 0xff, 0xff, 0, 0], dkVert: [0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc],
    narHorz: [0xff, 0, 0xff, 0, 0xff, 0, 0xff, 0], narVert: [0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa, 0xaa],
    dashHorz: [0xf0, 0, 0, 0, 0x0f, 0, 0, 0], dashVert: [0x80, 0x80, 0x80, 0x80, 0x08, 0x08, 0x08, 0x08],
    cross: [0xff, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80], smGrid: [0xff, 0x88, 0x88, 0x88, 0xff, 0x88, 0x88, 0x88],
    lgGrid: [0xff, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80], dotGrid: [0xaa, 0, 0x80, 0, 0x80, 0, 0x80, 0],
    dnDiag: [0x88, 0x44, 0x22, 0x11, 0x88, 0x44, 0x22, 0x11], upDiag: [0x11, 0x22, 0x44, 0x88, 0x11, 0x22, 0x44, 0x88],
    ltDnDiag: [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01], ltUpDiag: [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
    dkDnDiag: [0xcc, 0x66, 0x33, 0x99, 0xcc, 0x66, 0x33, 0x99], dkUpDiag: [0x33, 0x66, 0xcc, 0x99, 0x33, 0x66, 0xcc, 0x99],
    wdDnDiag: [0xc1, 0xe0, 0x70, 0x38, 0x1c, 0x0e, 0x07, 0x83], wdUpDiag: [0x83, 0x07, 0x0e, 0x1c, 0x38, 0x70, 0xe0, 0xc1],
    diagCross: [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81], smCheck: [0x99, 0x66, 0x66, 0x99, 0x99, 0x66, 0x66, 0x99],
    lgCheck: [0xf0, 0xf0, 0xf0, 0xf0, 0x0f, 0x0f, 0x0f, 0x0f], openDmnd: [0x80, 0x41, 0x22, 0x14, 0x08, 0x14, 0x22, 0x41],
    solidDmnd: [0x08, 0x1c, 0x3e, 0x7f, 0x3e, 0x1c, 0x08, 0x00], horzBrick: [0xff, 0x80, 0x80, 0x80, 0xff, 0x08, 0x08, 0x08],
    diagBrick: [0x80, 0x40, 0x20, 0x10, 0x18, 0x24, 0x42, 0x81], zigZag: [0x81, 0x42, 0x24, 0x18, 0x81, 0x42, 0x24, 0x18],
    wave: [0x00, 0x18, 0xa4, 0x03, 0x00, 0x18, 0xa4, 0x03], plaid: [0xaa, 0x55, 0xaa, 0x55, 0xf0, 0xf0, 0xf0, 0xf0],
    trellis: [0xff, 0x66, 0xff, 0x99, 0xff, 0x66, 0xff, 0x99], weave: [0x88, 0x54, 0x22, 0x45, 0x88, 0x14, 0x22, 0x51],
    divot: [0x00, 0x08, 0x04, 0x08, 0x00, 0x80, 0x40, 0x80], shingle: [0x03, 0x84, 0x48, 0x30, 0x0c, 0x02, 0x01, 0x01],
    sphere: [0x77, 0x98, 0xf8, 0xf8, 0x77, 0x89, 0x8f, 0x8f]
  };

  function patternDefs(defs, fill, scale) {
    var id = nextId("pat");
    var size = 8 / (scale || 1);
    var pattern = svgEl("pattern", { id: id, width: size, height: size, patternUnits: "userSpaceOnUse" });
    pattern.appendChild(svgEl("rect", { width: size, height: size, fill: fill.background || "#ffffff" }));
    var mask = PATTERNS[fill.pattern] || PATTERNS.pct50;
    var cell = size / 8;
    var d = "";
    mask.forEach(function (row, y) {
      for (var x = 0; x < 8; x += 1) {
        if (row & (0x80 >> x)) d += "M" + x * cell + " " + y * cell + "h" + cell + "v" + cell + "h-" + cell + "Z";
      }
    });
    if (d) pattern.appendChild(svgEl("path", { d: d, fill: fill.color || "#000000" }));
    defs.appendChild(pattern);
    return "url(#" + id + ")";
  }

  function gradientDefs(defs, fill) {
    var id = nextId("grad");
    var gradient;
    if (fill.path && fill.path !== "linear") {
      gradient = svgEl("radialGradient", { id: id, cx: "50%", cy: "50%", r: fill.path === "rect" ? "71%" : "50%" });
    } else {
      var angle = ((fill.angle || 0) % 360) * Math.PI / 180;
      var dx = Math.cos(angle) / 2, dy = Math.sin(angle) / 2;
      gradient = svgEl("linearGradient", {
        id: id, x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy
      });
    }
    var stops = (fill.stops || []).slice().sort(function (a, b) { return a.pos - b.pos; });
    // A radial gradient in DrawingML runs from the centre outwards with the
    // first stop at the edge for "circle" fills saved by PowerPoint's
    // presets; SVG runs centre-first as well, so stops keep their order.
    stops.forEach(function (stop) {
      gradient.appendChild(svgEl("stop", {
        offset: Math.max(0, Math.min(1, stop.pos)),
        "stop-color": stop.color,
        "stop-opacity": stop.alpha === undefined ? 1 : stop.alpha
      }));
    });
    defs.appendChild(gradient);
    return "url(#" + id + ")";
  }

  // The SVG paint for a fill, adding defs as needed. Picture fills are drawn
  // separately (they need clipping), so they return "none" here.
  function paintFor(defs, fill, scale) {
    if (!fill || fill.type === "none" || fill.type === "picture") return { paint: "none" };
    if (fill.type === "solid") return { paint: fill.color, opacity: fill.alpha };
    if (fill.type === "gradient") return { paint: gradientDefs(defs, fill) };
    if (fill.type === "pattern") return { paint: patternDefs(defs, fill, scale) };
    return { paint: "none" };
  }

  function cssBackground(fill, mediaUrl) {
    if (!fill || fill.type === "none") return "";
    if (fill.type === "solid") return cssColor(fill.color, fill.alpha);
    if (fill.type === "gradient") {
      var stops = (fill.stops || []).slice().sort(function (a, b) { return a.pos - b.pos; }).map(function (stop) {
        return cssColor(stop.color, stop.alpha) + " " + Math.round(stop.pos * 1000) / 10 + "%";
      }).join(", ");
      if (!stops) return "";
      if (fill.path && fill.path !== "linear") return "radial-gradient(" + stops + ")";
      return "linear-gradient(" + (((fill.angle || 0) + 90) % 360) + "deg, " + stops + ")";
    }
    if (fill.type === "pattern") return mix(fill.background || "#ffffff", fill.color || "#000000", 0.5);
    if (fill.type === "picture" && fill.media) return "url(\"" + mediaUrl(fill.media) + "\") center / 100% 100% no-repeat";
    return "";
  }

  // --------------------------------------------------------------- lines

  var DASHES = {
    dash: [4, 3], dot: [1, 1], sysDot: [1, 1], sysDash: [3, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
    lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1],
    sysDashDotDot: [3, 1, 1, 1, 1, 1]
  };

  var ARROW_SIZE = { sm: 2, med: 3, lg: 5 };

  // Arrow ends scale with the line, but a thin line keeps ends of a
  // readable size: the base is at least 2 points (LibreOffice uses 0.7 mm).
  var ARROW_MIN_BASE = 2;

  function markerDefs(defs, end, color, isStart, lineWidth) {
    if (!end || !end.type || end.type === "none") return null;
    var id = nextId("arrow");
    var base = Math.max(lineWidth || 0, ARROW_MIN_BASE);
    var w = (ARROW_SIZE[end.w] || 3) * base, len = (ARROW_SIZE[end.len] || 3) * base;
    var marker = svgEl("marker", {
      id: id, markerUnits: "userSpaceOnUse", markerWidth: len, markerHeight: w,
      viewBox: "0 0 10 10", preserveAspectRatio: "none",
      refX: isStart ? 0 : 10, refY: 5, orient: "auto-start-reverse", overflow: "visible"
    });
    var shape;
    switch (end.type) {
      case "oval":
        shape = svgEl("ellipse", { cx: 5, cy: 5, rx: 5, ry: 5, fill: color });
        marker.setAttribute("refX", 5);
        break;
      case "diamond":
        shape = svgEl("path", { d: "M0 5L5 0L10 5L5 10Z", fill: color });
        marker.setAttribute("refX", 5);
        break;
      case "stealth":
        shape = svgEl("path", { d: "M0 0L10 5L0 10L3 5Z", fill: color });
        break;
      case "arrow":
        shape = svgEl("path", { d: "M0 0L10 5L0 10", fill: "none", stroke: color, "stroke-width": 1.5 });
        break;
      default:
        shape = svgEl("path", { d: "M0 0L10 5L0 10Z", fill: color });
    }
    marker.appendChild(shape);
    defs.appendChild(marker);
    return "url(#" + id + ")";
  }

  function applyLine(path, line, defs) {
    if (!line) {
      path.setAttribute("stroke", "none");
      return;
    }
    var width = Math.max(pt(line.w || 9525), 0.5);
    path.setAttribute("stroke", line.color ? line.color : "none");
    if (line.alpha !== undefined && line.alpha < 1) path.setAttribute("stroke-opacity", line.alpha);
    path.setAttribute("stroke-width", width);
    path.setAttribute("stroke-linecap", line.cap === "rnd" ? "round" : (line.cap === "sq" ? "square" : "butt"));
    path.setAttribute("stroke-linejoin", line.join === "bevel" ? "bevel" : (line.join === "miter" ? "miter" : "round"));
    var dash = DASHES[line.dash];
    if (dash) path.setAttribute("stroke-dasharray", dash.map(function (v) { return v * width; }).join(" "));
    if (line.head) {
      var head = markerDefs(defs, line.head, line.color, true, width);
      if (head) path.setAttribute("marker-start", head);
    }
    if (line.tail) {
      var tail = markerDefs(defs, line.tail, line.color, false, width);
      if (tail) path.setAttribute("marker-end", tail);
    }
  }

  // ---------------------------------------------------------------- text

  function fontStack(run) {
    var names = [];
    [run.font, run.ea, run.cs].forEach(function (name) {
      if (name && names.indexOf(name) < 0) names.push(name);
    });
    return names.map(function (name) { return "\"" + name.replace(/"/g, "") + "\""; })
      .concat(["\"Segoe UI\"", "\"Yu Gothic UI\"", "\"Microsoft YaHei UI\"", "sans-serif"]).join(", ");
  }

  function lineHeight(paragraph, size, body) {
    var spacing = paragraph.lineSpacing;
    var reduction = body.lineReduction || 0;
    if (spacing && spacing.pt) return px(spacing.pt * (1 - reduction));
    var pct = spacing && spacing.pct !== undefined ? spacing.pct : 1;
    // PowerPoint's single spacing is about 1.2 times the font size.
    return px(Math.max(0, pct - reduction) * 1.2 * size);
  }

  function spacing(value, size) {
    if (!value) return 0;
    if (value.pt !== undefined) return value.pt;
    if (value.pct !== undefined) return value.pct * 1.2 * size;
    return 0;
  }

  function runElement(run, scale, ctx) {
    var size = (run.size || 18) * scale;
    if (run.br) {
      return el("br");
    }
    var span = el(run.link ? "a" : "span", run.link ? "slide-link" : "");
    if (run.link) {
      span.setAttribute("data-href", run.link);
      span.setAttribute("tabindex", "0");
      span.setAttribute("role", "link");
      span.title = run.link;
    }
    var text = run.t || "";
    if (run.caps === "all") text = text.toUpperCase();
    span.textContent = text;
    var style = span.style;
    style.fontFamily = fontStack(run);
    style.fontSize = px(run.baseline ? size * 2 / 3 : size);
    if (run.color) style.color = cssColor(run.color, run.alpha);
    if (run.b) style.fontWeight = "700";
    if (run.i) style.fontStyle = "italic";
    var decorations = [];
    if (run.u && run.u !== "none") decorations.push("underline");
    if (run.strike) decorations.push("line-through");
    if (decorations.length) style.textDecorationLine = decorations.join(" ");
    if (run.u === "dbl") style.textDecorationStyle = "double";
    if (run.u && /dash/i.test(run.u)) style.textDecorationStyle = "dashed";
    if (run.u && /dot/i.test(run.u)) style.textDecorationStyle = "dotted";
    if (run.u && /wavy/i.test(run.u)) style.textDecorationStyle = "wavy";
    if (run.baseline) style.verticalAlign = (run.baseline > 0 ? "" : "-") + Math.abs(run.baseline) / 100 * size + "px";
    if (run.caps === "small") style.fontVariant = "small-caps";
    if (run.spacing) style.letterSpacing = px(run.spacing);
    if (run.highlight) style.backgroundColor = run.highlight;
    if (ctx && ctx.onText) ctx.onText(text);
    return span;
  }

  function bulletElement(paragraph, firstSize, ctx) {
    var bullet = paragraph.bullet;
    if (!bullet) return null;
    var span = el("span", "bullet");
    var size = firstSize * (bullet.size || 1);
    if (bullet.media) {
      var image = el("img");
      image.alt = "";
      image.src = ctx.mediaUrl(bullet.media);
      image.style.height = px(size);
      span.appendChild(image);
    } else {
      span.textContent = bullet.char || bullet.text || "";
      span.style.fontFamily = bullet.font ? "\"" + bullet.font + "\", \"Segoe UI Symbol\", sans-serif" : "inherit";
      if (bullet.color) span.style.color = bullet.color;
      span.style.fontSize = px(size);
    }
    var indent = -pt(paragraph.indent || 0);
    span.style.minWidth = px(Math.max(indent, 0));
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function textBody(body, box, ctx) {
    var wrap = el("div", "text-body");
    var insets = body.insets || [91440, 45720, 91440, 45720];
    var style = wrap.style;
    style.left = px(box.x);
    style.top = px(box.y);
    style.width = px(box.w);
    style.height = px(box.h);
    style.padding = [insets[1], insets[2], insets[3], insets[0]].map(function (v) { return px(pt(v)); }).join(" ");
    style.justifyContent = body.anchor === "ctr" ? "center" : (body.anchor === "b" ? "flex-end" : "flex-start");
    if (body.anchorCenter) style.alignItems = "center";
    if (body.wrap === false) style.whiteSpace = "pre";
    if (body.vert && body.vert !== "horz") {
      style.writingMode = "vertical-rl";
      if (body.vert === "vert270") style.transform = "rotate(180deg)";
    }
    if (body.columns > 1) {
      style.columnCount = body.columns;
      style.display = "block";
    }
    var scale = body.fontScale || 1;
    (body.paragraphs || []).forEach(function (paragraph) {
      var p = el("p", "para");
      var runs = paragraph.runs || [];
      var firstRun = runs.find(function (run) { return !run.br; }) || {};
      var size = (firstRun.size || paragraph.endSize || 18) * scale;
      var ps = p.style;
      ps.textAlign = { ctr: "center", r: "right", just: "justify", dist: "justify", l: "left" }[paragraph.align] || "left";
      if (paragraph.rtl) p.dir = "rtl";
      ps.marginLeft = px(pt(paragraph.marL || 0));
      ps.textIndent = px(pt(paragraph.indent || 0));
      ps.lineHeight = lineHeight(paragraph, size, body);
      ps.marginTop = px(spacing(paragraph.spaceBefore, size) * (scale < 1 ? scale : 1));
      ps.marginBottom = px(spacing(paragraph.spaceAfter, size) * (scale < 1 ? scale : 1));
      ps.fontSize = px(size);
      var hasText = runs.some(function (run) { return run.t; });
      if (hasText) {
        var bullet = bulletElement(paragraph, size, ctx);
        if (bullet) p.appendChild(bullet);
      }
      runs.forEach(function (run) { p.appendChild(runElement(run, scale, ctx)); });
      if (!hasText) {
        // An empty paragraph still takes one line at its end size.
        var spacer = el("span");
        spacer.textContent = "​";
        spacer.style.fontSize = px((paragraph.endSize || 18) * scale);
        p.appendChild(spacer);
      }
      if (ctx && ctx.onText) ctx.onText("\n");
      wrap.appendChild(p);
    });
    return wrap;
  }

  // ------------------------------------------------------------- shapes

  function boxOf(shape) {
    return { x: pt(shape.x), y: pt(shape.y), w: pt(shape.w), h: pt(shape.h) };
  }

  function transformFor(shape, flipText) {
    var parts = [];
    if (shape.rot) parts.push("rotate(" + shape.rot + "deg)");
    if (!flipText) {
      if (shape.flipH || shape.flipV) parts.push("scale(" + (shape.flipH ? -1 : 1) + "," + (shape.flipV ? -1 : 1) + ")");
    } else if (shape.flipV) {
      // Text in a vertically flipped shape turns upside down; a horizontal
      // flip leaves text as it is.
      parts.push("rotate(180deg)");
    }
    return parts.join(" ");
  }

  function placeholderLabel(box, label, kind) {
    var node = el("div", "missing");
    node.style.left = px(box.x);
    node.style.top = px(box.y);
    node.style.width = px(box.w);
    node.style.height = px(box.h);
    node.setAttribute("data-missing", kind || "");
    var text = el("span");
    text.textContent = label;
    node.appendChild(text);
    return node;
  }

  function pictureElement(shape, box, geometry, ctx, frame) {
    var crop = shape.crop || [0, 0, 0, 0];
    var visibleW = 1 - crop[0] - crop[2], visibleH = 1 - crop[1] - crop[3];
    if (visibleW <= 0 || visibleH <= 0) return;
    var holder = el("div", "picture");
    holder.style.left = px(box.x);
    holder.style.top = px(box.y);
    holder.style.width = px(box.w);
    holder.style.height = px(box.h);
    if (geometry && geometry.paths[0] && shape.geom && shape.geom.preset !== "rect") {
      holder.style.clipPath = "path('" + geometry.paths[0].d + "')";
    }
    var transform = transformFor(shape, false);
    if (transform) holder.style.transform = transform;
    var image = el("img");
    image.alt = shape.descr || "";
    image.decoding = "async";
    image.draggable = false;
    var fullW = box.w / visibleW, fullH = box.h / visibleH;
    image.style.width = px(fullW);
    image.style.height = px(fullH);
    image.style.left = px(-crop[0] * fullW);
    image.style.top = px(-crop[1] * fullH);
    if (shape.alpha !== undefined && shape.alpha < 1) image.style.opacity = shape.alpha;
    // A picture whose bytes cannot be read (a damaged part) becomes a
    // labelled box instead of a broken image.
    image.addEventListener("error", function () {
      if (holder.parentNode) holder.replaceWith(placeholderLabel(box, ctx.missingLabel("unreadable"), "unreadable"));
    });
    image.src = ctx.mediaUrl(shape.media);
    holder.appendChild(image);
    frame.appendChild(holder);
  }

  function drawGeometry(shape, box, geometry, frame) {
    var svg = svgEl("svg", {
      class: "geom", width: box.w || 1, height: box.h || 1,
      viewBox: "0 0 " + (box.w || 1) + " " + (box.h || 1), overflow: "visible", "aria-hidden": "true"
    });
    svg.style.left = px(box.x);
    svg.style.top = px(box.y);
    var transform = transformFor(shape, false);
    if (transform) svg.style.transform = transform;
    var defs = svgEl("defs");
    svg.appendChild(defs);
    var paint = paintFor(defs, shape.fill, 1);
    geometry.paths.forEach(function (geomPath) {
      if (!geomPath.d) return;
      var hasFill = geomPath.fill !== "none" && paint.paint !== "none";
      if (hasFill) {
        var filled = svgEl("path", { d: geomPath.d, fill: paint.paint, stroke: "none" });
        if (paint.opacity !== undefined && paint.opacity < 1) filled.setAttribute("fill-opacity", paint.opacity);
        svg.appendChild(filled);
        var shade = { darken: ["#000", 0.4], darkenLess: ["#000", 0.2], lighten: ["#fff", 0.4], lightenLess: ["#fff", 0.2] }[geomPath.fill];
        if (shade) svg.appendChild(svgEl("path", { d: geomPath.d, fill: shade[0], "fill-opacity": shade[1], stroke: "none" }));
      }
      if (geomPath.stroke && shape.line) {
        var stroke = svgEl("path", { d: geomPath.d, fill: "none" });
        applyLine(stroke, shape.line, defs);
        svg.appendChild(stroke);
      }
    });
    frame.appendChild(svg);
  }

  function drawShape(shape, frame, ctx) {
    var box = boxOf(shape);
    var geometry = ctx.geometry(shape.geom, box.w, box.h);
    if (!geometry) {
      // A preset LeanSlides does not know is drawn as its box.
      geometry = ctx.geometry({ preset: "rect" }, box.w, box.h);
      ctx.unknownPreset(shape.geom && shape.geom.preset);
    }
    if (shape.fill && shape.fill.type === "picture" && shape.fill.media) {
      pictureElement({ media: shape.fill.media, crop: shape.fill.crop, geom: shape.geom, rot: shape.rot,
                       flipH: shape.flipH, flipV: shape.flipV }, box, geometry, ctx, frame);
    }
    drawGeometry(shape, box, geometry, frame);
    if (shape.text && shape.text.paragraphs && shape.text.paragraphs.length) {
      var rect = geometry.rect || { l: 0, t: 0, r: box.w, b: box.h };
      var textBox = { x: box.x + rect.l, y: box.y + rect.t, w: Math.max(0, rect.r - rect.l), h: Math.max(0, rect.b - rect.t) };
      var text = textBody(shape.text, textBox, ctx);
      // The text turns with the shape about the shape's centre.
      var transform = transformFor(shape, true);
      if (transform) {
        text.style.transformOrigin = px(box.x + box.w / 2 - textBox.x) + " " + px(box.y + box.h / 2 - textBox.y);
        text.style.transform = transform + (text.style.transform ? " " + text.style.transform : "");
      }
      frame.appendChild(text);
    }
  }

  function drawPicture(shape, frame, ctx) {
    var box = boxOf(shape);
    if (!shape.media) {
      frame.appendChild(placeholderLabel(box, ctx.missingLabel(shape.missing), shape.missing));
      return;
    }
    var geometry = ctx.geometry(shape.geom || { preset: "rect" }, box.w, box.h) ||
      ctx.geometry({ preset: "rect" }, box.w, box.h);
    pictureElement(shape, box, geometry, ctx, frame);
    if (shape.line) {
      drawGeometry({ fill: null, line: shape.line, rot: shape.rot, flipH: shape.flipH, flipV: shape.flipV },
        box, geometry, frame);
    }
  }

  function drawObject(shape, frame, ctx) {
    var box = boxOf(shape);
    if (shape.media) {
      drawPicture({ media: shape.media, crop: shape.crop, x: shape.x, y: shape.y, w: shape.w, h: shape.h,
                    rot: shape.rot, flipH: shape.flipH, flipV: shape.flipV }, frame, ctx);
      return;
    }
    frame.appendChild(placeholderLabel(box, ctx.featureLabel(shape.feature, shape.label), shape.feature));
  }

  function borderCss(line) {
    if (!line || !line.color) return "none";
    var width = Math.max(pt(line.w || 12700), 0.5);
    var style = line.dash && line.dash !== "solid" ? (/dot/i.test(line.dash) && !/dash/i.test(line.dash) ? "dotted" : "dashed") : "solid";
    return px(width) + " " + style + " " + cssColor(line.color, line.alpha);
  }

  function drawTable(shape, frame, ctx) {
    var box = boxOf(shape);
    var holder = el("div", "table-frame");
    holder.style.left = px(box.x);
    holder.style.top = px(box.y);
    holder.style.width = px(box.w);
    var table = el("table", "slide-table");
    var colgroup = el("colgroup");
    (shape.cols || []).forEach(function (width) {
      var col = el("col");
      col.style.width = px(pt(width));
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
    var tbody = el("tbody");
    (shape.rows || []).forEach(function (row) {
      var tr = el("tr");
      tr.style.height = px(pt(row.h));
      (row.cells || []).forEach(function (cell) {
        if (cell.merged) return;
        var td = el("td");
        if (cell.span > 1) td.colSpan = cell.span;
        if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
        var background = cssBackground(cell.fill, ctx.mediaUrl);
        if (background) td.style.background = background;
        var borders = cell.borders || {};
        td.style.borderLeft = borderCss(borders.l);
        td.style.borderRight = borderCss(borders.r);
        td.style.borderTop = borderCss(borders.t);
        td.style.borderBottom = borderCss(borders.b);
        var margins = cell.margins || [91440, 45720, 91440, 45720];
        td.style.padding = [margins[1], margins[2], margins[3], margins[0]].map(function (v) { return px(pt(v)); }).join(" ");
        td.style.verticalAlign = cell.anchor === "ctr" ? "middle" : (cell.anchor === "b" ? "bottom" : "top");
        if (cell.text) {
          var body = textBody(Object.assign({}, cell.text, { insets: [0, 0, 0, 0] }), { x: 0, y: 0, w: 0, h: 0 }, ctx);
          body.className = "cell-body";
          body.removeAttribute("style");
          td.appendChild(body);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    holder.appendChild(table);
    frame.appendChild(holder);
  }

  function drawGroup(shape, frame, ctx) {
    var box = boxOf(shape);
    var group = el("div", "group");
    var transform = transformFor(shape, false);
    if (transform) {
      group.style.transformOrigin = px(box.x + box.w / 2) + " " + px(box.y + box.h / 2);
      group.style.transform = transform;
    }
    (shape.children || []).forEach(function (child) { drawNode(child, group, ctx); });
    frame.appendChild(group);
  }

  function drawNode(shape, frame, ctx) {
    try {
      switch (shape.kind) {
        case "shape": drawShape(shape, frame, ctx); break;
        case "picture": drawPicture(shape, frame, ctx); break;
        case "table": drawTable(shape, frame, ctx); break;
        case "group": drawGroup(shape, frame, ctx); break;
        case "object": drawObject(shape, frame, ctx); break;
        default: break;
      }
    } catch (error) {
      ctx.shapeFailed(shape, error);
    }
  }

  // Draws a slide model into a new element of w x h points.
  //   ctx.mediaUrl(id), ctx.geometry(geom, w, h), ctx.missingLabel(kind),
  //   ctx.featureLabel(code, label), ctx.unknownPreset(name),
  //   ctx.shapeFailed(shape, error), ctx.onText(text) (optional)
  function drawSlide(model, ctx) {
    var slide = el("div", "slide");
    var w = pt(model.w), h = pt(model.h);
    slide.style.width = px(w);
    slide.style.height = px(h);
    var background = cssBackground(model.background, ctx.mediaUrl);
    slide.style.background = background || "#ffffff";
    (model.shapes || []).forEach(function (shape) { drawNode(shape, slide, ctx); });
    return slide;
  }

  window.LeanSlidesRender = { drawSlide: drawSlide, cssColor: cssColor };
})();
