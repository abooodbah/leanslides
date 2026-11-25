// LeanSlides interface strings, looked up by key. Keys follow the codes the
// core and the host send (feature codes, file kinds, error codes), so no
// English sentence from the host reaches the page. A key missing from a
// language falls back to English.
(function () {
  "use strict";

  var tables = {
    en: {
      "app.name": "LeanSlides",
      "slide.position": "Slide {current} of {total}",
      "slide.failed": "This slide could not be read.",
      "slide.empty": "This presentation has no slides.",
      "notice.notDrawn": "Not drawn: {items}. LeanSlides shows the picture the file stores for each, or a labelled box.",
      "notice.macros": "This file contains macros. LeanSlides never runs them.",
      "notice.linked": "Linked content outside the file is not loaded.",
      "missing.metafile": "Picture in a format LeanSlides does not draw (EMF or WMF)",
      "missing.unsupported-image": "Picture in a format LeanSlides does not draw",
      "missing.linked": "Linked picture, not loaded",
      "missing.absent": "Picture missing from the file",
      "missing.unreadable": "Picture LeanSlides could not read",
      "feature.chart": "Chart",
      "feature.smartart": "SmartArt",
      "feature.ole-object": "Embedded object",
      "feature.video": "Video",
      "feature.audio": "Audio",
      "feature.model-3d": "3D model",
      "feature.ink": "Ink",
      "feature.equation": "Equation",
      "feature.metafile": "EMF or WMF picture",
      "feature.unsupported-image": "Picture in another format",
      "feature.activex": "ActiveX control (not run)",
      "state.emptyTitle": "Read presentations without opening an editor.",
      "state.emptyMessage": "Open a .pptx file to read it here. LeanSlides never runs macros.",
      "state.errorTitle": "This file could not be opened.",
      "state.legacyTitle": "This is a PowerPoint 97-2003 file.",
      "state.legacyMessage": "LeanSlides reads .pptx, .ppsx and .potx files. Open this one in an editor and save it as .pptx.",
      "state.encryptedTitle": "This presentation is password protected.",
      "state.encryptedMessage": "LeanSlides does not open encrypted files. Open it in an editor with the password.",
      "state.odpTitle": "This is an OpenDocument presentation.",
      "state.odpMessage": "LeanSlides 0.1.0 reads PowerPoint files only. Open this one in an editor.",
      "state.notPresentationTitle": "This is not a presentation.",
      "state.notPresentationMessage": "LeanSlides reads .pptx, .ppsx, .potx and .pptm files.",
      "state.drawFailed": "LeanSlides could not draw this presentation.",
      "error.too-large": "This file is larger than LeanSlides opens (512 MiB).",
      "error.not-a-zip": "This file is not a presentation package.",
      "error.corrupt-zip": "This presentation's ZIP structure is damaged.",
      "error.too-many-entries": "This presentation has more parts than LeanSlides opens.",
      "error.part-too-large": "A part of this presentation is larger than LeanSlides opens.",
      "error.compression-ratio": "A part of this presentation expands far more than real files do, so LeanSlides does not open it.",
      "error.unsafe-entry-name": "This presentation contains a part with an unsafe name.",
      "error.duplicate-entry": "This presentation contains the same part twice.",
      "error.encrypted-entry": "This presentation contains an encrypted part.",
      "error.missing-main-part": "This presentation has no slide list.",
      "error.too-many-slides": "This presentation has more slides than LeanSlides opens.",
      "error.xml-doctype": "This presentation contains XML with a document type, which LeanSlides does not read.",
      "error.xml-malformed": "This presentation contains XML that LeanSlides cannot read.",
      "error.xml-too-deep": "This presentation contains XML nested more deeply than LeanSlides reads.",
      "error.read-failed": "LeanSlides could not read this file."
    }
  };

  function format(text, values) {
    return String(text).replace(/\{([a-zA-Z]+)\}/g, function (whole, name) {
      return values && Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole;
    });
  }

  // The text for a key in a language, with {name} filled from values. An
  // unknown key returns itself, so a missing string shows up in tests.
  function translate(language, key, values) {
    var table = tables[language] || tables.en;
    var text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : tables.en[key];
    return format(text === undefined ? key : text, values);
  }

  var api = { tables: tables, translate: translate, has: function (key) { return key in tables.en; } };
  if (typeof module === "object" && module.exports) module.exports = api;
  else window.LeanSlidesStrings = api;
})();
