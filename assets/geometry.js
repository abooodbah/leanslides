// LeanSlides geometry: turns a shape's "geom" (a preset name with adjust
// values, or custom paths) into SVG path data for a box of w x h points.
// Preset formulas follow ECMA-376 Part 1, 20.1.9 (presets.json holds the
// standard definitions). Works in the browser (window.LeanSlidesGeometry)
// and in Node (module.exports) so tests can check it without a page.
(function (root) {
  "use strict";

  var DEG = 60000;  // angles are in 60000ths of a degree

  function toRadians(angle) {
    return (angle / DEG) * Math.PI / 180;
  }

  // The built-in guides of 20.1.9.11, for a box of w x h.
  function builtIns(w, h) {
    var ss = Math.min(w, h);
    var ls = Math.max(w, h);
    var values = {
      l: 0, t: 0, r: w, b: h, w: w, h: h, hc: w / 2, vc: h / 2, ls: ls, ss: ss,
      cd2: 10800000, cd4: 5400000, cd8: 2700000, "3cd4": 16200000, "3cd8": 8100000,
      "5cd8": 13500000, "7cd8": 18900000
    };
    [2, 3, 4, 5, 6, 8, 10, 12, 16, 32].forEach(function (n) {
      values["wd" + n] = w / n;
      values["hd" + n] = h / n;
      values["ssd" + n] = ss / n;
    });
    return values;
  }

  function evaluate(formula, values) {
    var parts = formula.trim().split(/\s+/);
    var op = parts[0];
    var arg = function (index) {
      var token = parts[index];
      if (token === undefined) return 0;
      if (Object.prototype.hasOwnProperty.call(values, token)) return values[token];
      var number = Number(token);
      return isFinite(number) ? number : 0;
    };
    var x = arg(1), y = arg(2), z = arg(3);
    switch (op) {
      case "val": return x;
      case "*/": return z === 0 ? 0 : (x * y) / z;
      case "+-": return x + y - z;
      case "+/": return z === 0 ? 0 : (x + y) / z;
      case "?:": return x > 0 ? y : z;
      case "abs": return Math.abs(x);
      case "at2": return (Math.atan2(y, x) * 180 / Math.PI) * DEG;
      case "cat2": return x * Math.cos(Math.atan2(z, y));
      case "cos": return x * Math.cos(toRadians(y));
      case "max": return Math.max(x, y);
      case "min": return Math.min(x, y);
      case "mod": return Math.sqrt(x * x + y * y + z * z);
      case "pin": return y < x ? x : (y > z ? z : y);
      case "sat2": return x * Math.sin(Math.atan2(z, y));
      case "sin": return x * Math.sin(toRadians(y));
      case "sqrt": return Math.sqrt(Math.max(0, x));
      case "tan": return x * Math.tan(toRadians(y));
      default: return 0;
    }
  }

  // Evaluates a preset's adjust values (the shape's own "adj" wins) and
  // guides in order, for a box of w x h.
  function guideValues(preset, w, h, adjust) {
    var values = builtIns(w, h);
    (preset.av || []).forEach(function (entry) {
      var name = entry[0];
      values[name] = adjust && typeof adjust[name] === "number" ? adjust[name] : evaluate(entry[1], values);
    });
    // A file may name a one-value preset's adjust "adj" while the
    // definition calls it "adj1", or the other way round.
    if (adjust) {
      if (typeof adjust.adj === "number" && values.adj1 !== undefined && adjust.adj1 === undefined) values.adj1 = adjust.adj;
      if (typeof adjust.adj1 === "number" && values.adj !== undefined && adjust.adj === undefined) values.adj = adjust.adj1;
    }
    (preset.gd || []).forEach(function (entry) {
      values[entry[0]] = evaluate(entry[1], values);
    });
    return values;
  }

  function number(value) {
    return Math.round(value * 1000) / 1000;
  }

  // Appends an arc from the current point, as 20.1.9.3 arcTo: an ellipse of
  // radii wR, hR, from angle stAng swept by swAng (clockwise positive).
  function arcTo(state, wR, hR, stAng, swAng, out) {
    if (wR === 0 || hR === 0) return;
    var start = toRadians(stAng);
    var sweep = toRadians(swAng);
    // The angles are visual angles on the ellipse; convert to parametric.
    var param = function (angle) {
      return Math.atan2(wR * Math.sin(angle), hR * Math.cos(angle));
    };
    var t0 = param(start);
    var cx = state.x - wR * Math.cos(t0);
    var cy = state.y - hR * Math.sin(t0);
    var drawPiece = function (from, by) {
      var t1 = param(from + by);
      // Keep the parametric sweep on the same side as the visual sweep.
      var tFrom = param(from);
      var delta = t1 - tFrom;
      if (by > 0 && delta < 0) delta += 2 * Math.PI;
      if (by < 0 && delta > 0) delta -= 2 * Math.PI;
      if (Math.abs(by) >= 2 * Math.PI - 1e-9) delta = by;
      var x = cx + wR * Math.cos(tFrom + delta);
      var y = cy + hR * Math.sin(tFrom + delta);
      var large = Math.abs(delta) > Math.PI ? 1 : 0;
      var sweepFlag = delta > 0 ? 1 : 0;
      out.push("A" + number(wR * state.sx) + " " + number(hR * state.sy) + " 0 " + large + " " + sweepFlag + " " +
        number(x * state.sx) + " " + number(y * state.sy));
      state.x = x;
      state.y = y;
    };
    // An SVG arc cannot draw a full turn; split anything past half a turn.
    var pieces = Math.max(1, Math.ceil(Math.abs(sweep) / Math.PI));
    var step = sweep / pieces;
    for (var index = 0; index < pieces; index += 1) {
      drawPiece(start + step * index, step);
    }
  }

  // One path to SVG data. `resolve` maps a coordinate token to a number in
  // path units; sx, sy scale path units to points.
  function pathData(commands, resolve, sx, sy) {
    var out = [];
    var state = { x: 0, y: 0, sx: sx, sy: sy, startX: 0, startY: 0 };
    commands.forEach(function (command) {
      var op = command[0];
      if (op === "M" || op === "L") {
        state.x = resolve(command[1]);
        state.y = resolve(command[2]);
        if (op === "M") { state.startX = state.x; state.startY = state.y; }
        out.push(op + number(state.x * sx) + " " + number(state.y * sy));
      } else if (op === "Q") {
        var qx = resolve(command[1]), qy = resolve(command[2]);
        state.x = resolve(command[3]);
        state.y = resolve(command[4]);
        out.push("Q" + number(qx * sx) + " " + number(qy * sy) + " " + number(state.x * sx) + " " + number(state.y * sy));
      } else if (op === "C") {
        var c = [1, 2, 3, 4, 5, 6].map(function (index) { return resolve(command[index]); });
        state.x = c[4];
        state.y = c[5];
        out.push("C" + number(c[0] * sx) + " " + number(c[1] * sy) + " " + number(c[2] * sx) + " " +
          number(c[3] * sy) + " " + number(c[4] * sx) + " " + number(c[5] * sy));
      } else if (op === "A") {
        arcTo(state, resolve(command[1]), resolve(command[2]), resolve(command[3]), resolve(command[4]), out);
      } else if (op === "Z") {
        out.push("Z");
        state.x = state.startX;
        state.y = state.startY;
      }
    });
    return out.join("");
  }

  // Returns {paths: [{d, fill, stroke}], rect: {l, t, r, b} | null} for a
  // box of w x h points, or null when the preset is unknown.
  function build(geom, w, h, presets) {
    if (!geom) geom = { preset: "rect" };
    if (geom.paths) {
      return {
        rect: null,
        paths: geom.paths.map(function (path) {
          var pw = path.w || w, ph = path.h || h;
          var resolve = function (token) { return Number(token) || 0; };
          return {
            d: pathData(path.d || [], resolve, pw ? w / pw : 1, ph ? h / ph : 1),
            fill: path.fill === false ? "none" : (path.fill === true || path.fill === undefined ? "norm" : path.fill),
            stroke: path.stroke !== false
          };
        })
      };
    }
    var name = geom.preset || "rect";
    if (name === "rect" || !presets || !presets[name]) {
      if (name !== "rect" && (!presets || !presets[name])) return null;
      return { rect: { l: 0, t: 0, r: w, b: h },
               paths: [{ d: "M0 0H" + number(w) + "V" + number(h) + "H0Z", fill: "norm", stroke: true }] };
    }
    var preset = presets[name];
    var values = guideValues(preset, w, h, geom.adj);
    var lookup = function (token) {
      if (Object.prototype.hasOwnProperty.call(values, token)) return values[token];
      var parsed = Number(token);
      return isFinite(parsed) ? parsed : 0;
    };
    var paths = preset.paths.map(function (path) {
      var pw = path.w, ph = path.h;
      var resolve = lookup;
      var sx = 1, sy = 1;
      if (pw || ph) {
        // A path with its own size uses literal coordinates in that space.
        resolve = function (token) {
          if (Object.prototype.hasOwnProperty.call(values, token)) return values[token];
          return Number(token) || 0;
        };
        sx = pw ? w / pw : 1;
        sy = ph ? h / ph : 1;
      }
      return { d: pathData(path.d, resolve, sx, sy), fill: path.fill, stroke: path.stroke };
    });
    var rect = preset.rect ? {
      l: lookup(preset.rect[0]), t: lookup(preset.rect[1]), r: lookup(preset.rect[2]), b: lookup(preset.rect[3])
    } : { l: 0, t: 0, r: w, b: h };
    return { rect: rect, paths: paths };
  }

  var api = { build: build, evaluate: evaluate, guideValues: guideValues };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LeanSlidesGeometry = api;
})(typeof window !== "undefined" ? window : this);
