// CI's real Windows check: reads a real Notepad through the packaged helper
// and the client the app uses, times it, then acts once (types into the fresh
// Notepad and checks the length back) plus a harmless keypress. A broken read
// or act fails the build.
// Usage: node native/win/smoke.js <path to persuna-eyes.exe>
const { spawn } = require("node:child_process");
const { createEyesClient } = require("../../eyes-client");

const READS = 20;
const SLOWEST_MS = 1000;

async function main() {
  const notepad = spawn("notepad.exe", [], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const client = createEyesClient({
    start: () => spawn(process.argv[2], ["serve"], { windowsHide: true }),
  });
  const first = await client.ask("read 0");
  console.log("first read:", JSON.stringify(first).slice(0, 400));
  if (!first.ok) throw new Error(`the helper didn't read: ${first.why}`);
  if (!/notepad/i.test(first.value.app)) {
    throw new Error(`expected Notepad in front, got "${first.value.app}"`);
  }
  if (first.value.items.length === 0) throw new Error("Notepad had no elements");

  const times = [];
  for (let i = 0; i < READS; i++) {
    const started = Date.now();
    const read = await client.ask("read 0");
    if (!read.ok) throw new Error(`read ${i} failed: ${read.why}`);
    times.push(Date.now() - started);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`${READS} reads: median ${median} ms, slowest ${times.at(-1)} ms`);
  if (median > SLOWEST_MS) throw new Error(`reads are too slow: ${median} ms`);

  // One real action: the fresh Notepad is empty and focused, so typing lands
  // in it. Lengths come back only when the field exposes them; the delta
  // proves the text landed whatever the reader counts around it.
  const text = "Persuna can act on Windows.";
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const before = await client.ask(`type 0 ${b64(" ")}`, 10000);
  const typed = await client.ask(`type 0 ${b64(text)}`, 10000);
  console.log("type probe:", JSON.stringify(before).slice(0, 200));
  console.log("type:", JSON.stringify(typed).slice(0, 200));
  if (!typed.ok || typed.value.done !== true) {
    throw new Error(`the helper didn't type: ${JSON.stringify(typed)}`);
  }
  const was = before.ok && before.value.done === true ? before.value.length : undefined;
  const now = typed.value.length;
  if (typeof was === "number" && typeof now === "number") {
    if (now - was !== text.length) {
      throw new Error(`expected ${text.length} characters to land, got ${now - was}`);
    }
  } else {
    console.log(
      "warning: the helper couldn't read the length back, so this proves the act ran, not that the text landed",
    );
  }

  // And a keypress that is harmless anywhere.
  const key = await client.ask("key 0 - escape", 10000);
  if (!key.ok || key.value.done !== true) {
    throw new Error(`the helper didn't press: ${JSON.stringify(key)}`);
  }

  client.stop();
  notepad.kill();
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
