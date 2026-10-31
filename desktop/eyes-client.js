// Talks to persuna-eyes.exe, which stays running on Windows so a read takes
// milliseconds instead of a new process each time. Pure (it's handed how to
// start the helper), so the web suite pins it. Requests go one at a time, an
// identical one already waiting is shared, and a helper that stops answering
// is killed and started again for the next request.

/**
 * @param {{ start: () => import("node:child_process").ChildProcess, coldMs?: number }} opts
 *   `coldMs` is the first request's allowance after a start: the first read
 *   loads UI Automation, and antivirus may scan the helper.
 */
function createEyesClient({ start, coldMs = 8000 }) {
  let child = null;
  let fresh = false;
  let buffer = "";
  let current = null;
  let timer = null;
  const waiting = [];

  function finish(result) {
    clearTimeout(timer);
    const done = current;
    current = null;
    done?.resolve(result);
    next();
  }

  function gone(which) {
    if (which !== child) return;
    child = null;
    buffer = "";
    if (current) finish({ ok: false, why: "blocked" });
  }

  function launch() {
    const started = start();
    child = started;
    fresh = true;
    buffer = "";
    started.on("error", () => gone(started));
    started.on("exit", () => gone(started));
    started.stdin.on("error", () => gone(started));
    started.stdout.setEncoding("utf8");
    started.stdout.on("data", (chunk) => {
      if (started !== child) return;
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        answer(line);
      }
    });
  }

  function answer(line) {
    if (!current) return;
    try {
      const value = JSON.parse(line);
      const good = value && typeof value === "object" && !value.error;
      finish(good ? { ok: true, value } : { ok: false, why: "unreadable" });
    } catch {
      finish({ ok: false, why: "unreadable" });
    }
  }

  function next() {
    if (current || waiting.length === 0) return;
    current = waiting.shift();
    try {
      if (!child) launch();
    } catch {
      child = null;
      return finish({ ok: false, why: "blocked" });
    }
    const allowance = fresh ? Math.max(coldMs, current.ms) : current.ms;
    fresh = false;
    timer = setTimeout(() => {
      const stuck = child;
      child = null;
      stuck?.kill();
      finish({ ok: false, why: "timeout" });
    }, allowance);
    child.stdin.write(`${current.line}\n`);
  }

  /**
   * One request. Never rejects: `{ ok: true, value }`, or `{ ok: false, why }`
   * with why "blocked" (it wouldn't start or stay up), "timeout" or "unreadable".
   * @param {string} line
   * @param {number} [ms]
   */
  function ask(line, ms = 2500) {
    const same = current?.line === line ? current : waiting.find((w) => w.line === line);
    if (same) return same.promise;
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    waiting.push({ line, ms, promise, resolve });
    next();
    return promise;
  }

  function stop() {
    const running = child;
    child = null;
    running?.kill();
  }

  return { ask, stop };
}

module.exports = { createEyesClient };
