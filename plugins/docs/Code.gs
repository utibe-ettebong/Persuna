/**
 * Persuna for Google Docs (private editor add-on).
 *
 * Setup: replace PERSUNA_URL below and in appsscript.json with your Persuna
 * origin (e.g. https://persuna.example.com), deploy as an editor add-on, and
 * install it privately. Each user pastes one Persuna agent key (Skills →
 * Import → agent keys); the key is stored in their own user properties and
 * the document text is sent to Persuna only for the apply request.
 */

var PERSUNA_URL = "https://PERSUNA_URL";
var KEY_PROPERTY = "persuna.agentKey";

function onOpen() {
  DocumentApp.getUi().createAddonMenu().addItem("Apply a skill", "showSidebar").addToUi();
}

function onInstall() {
  onOpen();
}

function showSidebar() {
  var ui = HtmlService.createHtmlOutputFromFile("Sidebar").setTitle("Persuna").setWidth(300);
  DocumentApp.getUi().showSidebar(ui);
}

/** The stored agent key, or "" when the user has not signed in yet. */
function getAgentKey() {
  return PropertiesService.getUserProperties().getProperty(KEY_PROPERTY) || "";
}

function hasAgentKey() {
  return getAgentKey() !== "";
}

function saveAgentKey(key) {
  PropertiesService.getUserProperties().setProperty(KEY_PROPERTY, String(key || "").trim());
  return hasAgentKey();
}

function forgetAgentKey() {
  PropertiesService.getUserProperties().deleteProperty(KEY_PROPERTY);
  return true;
}

function persunaFetch(path, options) {
  var key = getAgentKey();
  if (!key) throw new Error("Add your Persuna agent key first.");
  var request = {
    contentType: "application/json",
    headers: { Authorization: "Bearer " + key },
    muteHttpExceptions: true,
  };
  if (options) {
    for (var name in options) request[name] = options[name];
  }
  var response = UrlFetchApp.fetch(PERSUNA_URL + path, request);
  var body = response.getContentText();
  var parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    parsed = null;
  }
  if (response.getResponseCode() >= 400) {
    throw new Error(
      (parsed && (parsed.error || parsed.errors)) ||
        "Persuna answered " + response.getResponseCode(),
    );
  }
  return parsed;
}

/** The user's published skills: [{ slug, name }]. */
function listSkills() {
  var data = persunaFetch("/api/agents/skills", { method: "get" });
  return (data.skills || []).map(function (skill) {
    return { slug: skill.slug, name: skill.name };
  });
}

/**
 * Runs a skill over the current selection (or the whole document when nothing
 * is selected) and applies the returned edits. Undo with Ctrl/Cmd+Z.
 */
function applySkill(slug, mode, instruction) {
  var doc = DocumentApp.getActiveDocument();
  var selection = doc.getSelection();
  var text = selectedText(selection);
  var wholeDoc = false;
  if (!text) {
    text = doc.getBody().getText();
    wholeDoc = true;
  }
  if (!text.trim()) throw new Error("Select some text first, or write the draft in the document.");

  var data = persunaFetch("/api/plugins/apply", {
    method: "post",
    payload: JSON.stringify({
      skill: slug,
      text: text,
      instruction: instruction || undefined,
      mode: wholeDoc && mode === "replace_selection" ? "replace_selection" : mode,
      source: "docs",
    }),
  });
  (data.edits || []).forEach(function (edit) {
    applyEdit(doc, selection, wholeDoc, edit);
  });
  return { edits: (data.edits || []).length };
}

function selectedText(selection) {
  if (!selection) return "";
  var parts = [];
  selection.getRangeElements().forEach(function (range) {
    var element = range.getElement();
    if (element.editAsText) {
      var text = element.editAsText().getText();
      var start = range.isPartial() ? range.getStartOffset() : 0;
      var end = range.isPartial() ? range.getEndOffsetInclusive() : text.length - 1;
      parts.push(text.substring(start, end + 1));
    }
  });
  return parts.join("\n");
}

function applyEdit(doc, selection, wholeDoc, edit) {
  var body = doc.getBody();
  if (edit.op === "append") {
    body.appendParagraph(edit.text || "");
    return;
  }
  if (edit.op === "insert_after") {
    var anchor = selection ? selection.getRangeElements()[0].getElement() : null;
    var parent = anchor ? anchor.getParent() : null;
    var index = parent && parent.getChildIndex ? parent.getChildIndex(anchor) : -1;
    if (parent && index >= 0 && parent.insertParagraph) {
      parent.insertParagraph(index + 1, edit.text || "");
    } else {
      body.appendParagraph(edit.text || "");
    }
    return;
  }
  // replace_selection
  if (wholeDoc || !selection) {
    body.clear();
    body.appendParagraph(edit.text || "");
    return;
  }
  var replaced = false;
  selection.getRangeElements().forEach(function (range) {
    var element = range.getElement();
    if (!element.editAsText) return;
    var editable = element.editAsText();
    if (!replaced && range.isPartial()) {
      editable.deleteText(range.getStartOffset(), range.getEndOffsetInclusive());
      editable.insertText(range.getStartOffset(), edit.text || "");
      replaced = true;
    } else if (!replaced) {
      editable.setText(edit.text || "");
      replaced = true;
    } else if (range.isPartial()) {
      editable.deleteText(range.getStartOffset(), range.getEndOffsetInclusive());
    } else {
      editable.setText("");
    }
  });
}
