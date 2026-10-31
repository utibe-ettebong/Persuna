// CI's real Windows check: reads a real Notepad through the packaged helper
// and the client the app uses, and times it. A broken read fails the build.
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
