import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The desktop's eyes client is plain Node (no Electron), pinned from here.
import { createEyesClient } from "../../../desktop/eyes-client.js";

class FakeHelper extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  received: string[] = [];
  killed = false;
  constructor() {
    super();
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => this.received.push(chunk.trim()));
  }
  kill() {
    this.killed = true;
    return true;
  }
  reply(line: string) {
    this.stdout.write(`${line}\n`);
  }
}

/** A client over fake helpers: `helpers` holds each one started, oldest first. */
function client(coldMs = 8000) {
  const helpers: FakeHelper[] = [];
  const eyes = createEyesClient({
    coldMs,
    start: () => {
      const helper = new FakeHelper();
      helpers.push(helper);
      return helper as unknown as ChildProcess;
    },
  });
  return { eyes, helpers };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createEyesClient", () => {
  it("keeps one helper running across requests", async () => {
    const { eyes, helpers } = client();
    const first = eyes.ask("read 1");
    await settle();
    helpers[0].reply('{"app":"Notepad"}');
    expect(await first).toEqual({ ok: true, value: { app: "Notepad" } });

    const second = eyes.ask("read 2");
    await settle();
    helpers[0].reply('{"app":"Word"}');
    expect(await second).toEqual({ ok: true, value: { app: "Word" } });
    expect(helpers).toHaveLength(1);
    expect(helpers[0].received).toEqual(["read 1", "read 2"]);
  });

  it("puts an answer split across chunks back together", async () => {
    const { eyes, helpers } = client();
    const read = eyes.ask("read 1");
    await settle();
    helpers[0].stdout.write('{"app":');
    await settle();
    helpers[0].stdout.write('"Notepad"}\n');
    expect(await read).toEqual({ ok: true, value: { app: "Notepad" } });
  });

  it("shares an identical request instead of asking twice", async () => {
    const { eyes, helpers } = client();
    const one = eyes.ask("read 1");
    const two = eyes.ask("read 1");
    expect(two).toBe(one);
    await settle();
    expect(helpers[0].received).toEqual(["read 1"]);
    helpers[0].reply("{}");
    await one;
  });

  it("gives the first request after a start longer, then kills a stuck helper", async () => {
    const { eyes, helpers } = client(8000);
    const cold = eyes.ask("read 1", 2500);
    await vi.advanceTimersByTimeAsync(7999);
    helpers[0].reply("{}");
    expect((await cold).ok).toBe(true);

    const stuck = eyes.ask("read 2", 2500);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await stuck).toEqual({ ok: false, why: "timeout" });
    expect(helpers[0].killed).toBe(true);

    const again = eyes.ask("read 3", 2500);
    await settle();
    expect(helpers).toHaveLength(2);
    helpers[1].reply("{}");
    expect((await again).ok).toBe(true);
  });

  it("ignores a late answer from a helper it killed", async () => {
    const { eyes, helpers } = client(100);
    const stuck = eyes.ask("read 1", 100);
    await vi.advanceTimersByTimeAsync(100);
    expect((await stuck).ok).toBe(false);

    const next = eyes.ask("read 2");
    await settle();
    helpers[0].reply('{"app":"late"}');
    await settle();
    helpers[1].reply('{"app":"right"}');
    expect(await next).toEqual({ ok: true, value: { app: "right" } });
  });

  it("calls a helper that won't start or dies blocked", async () => {
    const { eyes, helpers } = client();
    const refused = eyes.ask("read 1");
    await settle();
    helpers[0].emit("error", new Error("Access is denied"));
    expect(await refused).toEqual({ ok: false, why: "blocked" });

    const died = eyes.ask("read 2");
    await settle();
    helpers[1].emit("exit", 1);
    expect(await died).toEqual({ ok: false, why: "blocked" });

    const threw = createEyesClient({
      start: () => {
        throw new Error("no such file");
      },
    });
    expect(await threw.ask("read 3")).toEqual({ ok: false, why: "blocked" });
  });

  it("calls nonsense and the helper's own errors unreadable", async () => {
    const { eyes, helpers } = client();
    const nonsense = eyes.ask("read 1");
    await settle();
    helpers[0].reply("not json");
    expect(await nonsense).toEqual({ ok: false, why: "unreadable" });

    const failed = eyes.ask("read 2");
    await settle();
    helpers[0].reply('{"error":"COMException"}');
    expect(await failed).toEqual({ ok: false, why: "unreadable" });
  });
});
