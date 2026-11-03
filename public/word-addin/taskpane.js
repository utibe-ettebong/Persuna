/* Persuna task pane: applies one of your published skills to the open
 * document. Served same-origin from the Persuna app, so no CORS setup. The
 * agent key lives in this browser's local storage only. */
(function () {
  "use strict";

  var KEY_NAME = "persuna.agentKey";
  var statusEl = document.getElementById("status");

  function status(text, kind) {
    statusEl.textContent = text || "";
    statusEl.className = kind || "";
  }

  function api(path, options) {
    var key = window.localStorage.getItem(KEY_NAME) || "";
    if (!key) return Promise.reject(new Error("Add your Persuna agent key first."));
    var init = {
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    };
    if (options) {
      for (var name in options) init[name] = options[name];
    }
    return window.fetch(path, init).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || "Persuna answered " + response.status);
        return body;
      });
    });
  }

  function showMain() {
    document.getElementById("signin").style.display = "none";
    document.getElementById("main").style.display = "block";
    return api("/api/agents/skills").then(function (data) {
      var select = document.getElementById("skill");
      select.innerHTML = "";
      (data.skills || []).forEach(function (skill) {
        var option = document.createElement("option");
        option.value = skill.slug;
        option.textContent = skill.name;
        select.appendChild(option);
      });
      if (!data.skills || !data.skills.length) status("Publish a skill in Persuna first.", "error");
    });
  }

  function readSelection() {
    return window.Word.run(function (context) {
      var selection = context.document.getSelection();
      selection.load("text");
      var body = context.document.body;
      body.load("text");
      return context.sync().then(function () {
        return { selected: selection.text || "", body: body.text || "" };
      });
    });
  }

  function applyEdit(edit, hadSelection) {
    return window.Word.run(function (context) {
      var text = edit.text || "";
      if (edit.op === "append") {
        context.document.body.insertParagraph(text, window.Word.InsertLocation.end);
      } else if (edit.op === "insert_after" && hadSelection) {
        context.document.getSelection().insertParagraph(text, window.Word.InsertLocation.after);
      } else if (hadSelection) {
        context.document.getSelection().insertText(text, window.Word.InsertLocation.replace);
      } else {
        context.document.body.clear();
        context.document.body.insertParagraph(text, window.Word.InsertLocation.start);
      }
      return context.sync();
    });
  }

  document.getElementById("saveKey").addEventListener("click", function () {
    var key = document.getElementById("key").value.trim();
    if (!key) {
      status("Paste a key first.", "error");
      return;
    }
    window.localStorage.setItem(KEY_NAME, key);
    status("");
    showMain().catch(function (err) {
      status(err.message, "error");
    });
  });

  document.getElementById("apply").addEventListener("click", function () {
    var button = document.getElementById("apply");
    button.disabled = true;
    status("Applying…");
    var mode = document.getElementById("mode").value;
    var instruction = document.getElementById("instruction").value;
    readSelection()
      .then(function (doc) {
        var text = doc.selected.trim() ? doc.selected : doc.body;
        if (!text.trim())
          throw new Error("Select some text first, or write the draft in the document.");
        return api("/api/plugins/apply", {
          method: "POST",
          body: JSON.stringify({
            skill: document.getElementById("skill").value,
            text: text,
            instruction: instruction || undefined,
            mode: mode,
            source: "word",
          }),
        }).then(function (data) {
          var hadSelection = Boolean(doc.selected.trim());
          var chain = Promise.resolve();
          (data.edits || []).forEach(function (edit) {
            chain = chain.then(function () {
              return applyEdit(edit, hadSelection);
            });
          });
          return chain.then(function () {
            return (data.edits || []).length;
          });
        });
      })
      .then(function (count) {
        button.disabled = false;
        status("Applied " + count + " edit(s). Undo with Ctrl/Cmd+Z.", "ok");
      })
      .catch(function (err) {
        button.disabled = false;
        status(err.message, "error");
      });
  });

  document.getElementById("forget").addEventListener("click", function () {
    window.localStorage.removeItem(KEY_NAME);
    window.location.reload();
  });

  window.Office.onReady(function () {
    if (window.localStorage.getItem(KEY_NAME)) {
      showMain().catch(function (err) {
        status(err.message, "error");
      });
    }
  });
})();
