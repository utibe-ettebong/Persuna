import { beforeEach, describe, expect, it, vi } from "vitest";
import { audit } from "@/lib/audit";
import { getUser } from "@/lib/auth/session";
import { chatFromVoiceStream, chatStream } from "@/lib/persuna/service";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({
  actorOf: () => ({ type: "user", id: "user-1" }),
  getUser: vi.fn(),
}));
vi.mock("@/lib/models", () => ({ createModelClient: vi.fn(), createTranscriber: vi.fn() }));
vi.mock("@/lib/persuna/service", () => ({ chatFromVoiceStream: vi.fn(), chatStream: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

const form = (fields: Record<string, string | Blob>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries({
    day: "2026-10-30",
    now: "2026-10-30T15:00",
    offset: "60",
    ...fields,
  })) {
    body.append(name, value);
  }
  return new Request("http://test/api/persuna/chat-stream", { method: "POST", body });
};
const scene = { screen: { w: 1440, h: 900 }, items: [], text: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUser).mockResolvedValue({ id: "user-1" } as never);
});

describe("POST /api/persuna/chat-stream", () => {
  it("streams a typed turn, passing on that the client holds the picture", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "sentence", text: "Hello." };
      yield { type: "done", result: { messages: [] } as never };
    });
    const res = await POST(
      form({
        text: " hi there ",
        mode: "look",
        scene: JSON.stringify(scene),
        "picture-held": "1",
      }),
    );
    const body = await res.text();

    expect(body).toContain("event: sentence");
    expect(body).toContain("event: done");
    expect(vi.mocked(chatFromVoiceStream)).not.toHaveBeenCalled();
    expect(vi.mocked(chatStream).mock.calls[0][2]).toMatchObject({
      text: "hi there",
      pictureHeld: true,
      show: false,
      saidFirst: undefined,
    });
  });

  it("marks words the client already heard live", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "done", result: { messages: [] } as never };
    });
    await (await POST(form({ text: "what's next?", "heard-live": "1" }))).text();

    expect(vi.mocked(chatStream).mock.calls[0][2]).toMatchObject({
      text: "what's next?",
      heardLive: true,
    });
  });

  it("carries the client's turn id into the turn, for its first-sound report", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "done", result: { messages: [] } as never };
    });
    await (await POST(form({ text: "hello", "client-turn": "t9" }))).text();

    expect(vi.mocked(chatStream).mock.calls[0][2]).toMatchObject({ clientTurn: "t9" });
  });

  it("passes a look-closer request on to the client", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "look-closer", heard: "What's this?", said: "Let me look." };
    });
    const res = await POST(form({ text: "What's this?" }));

    expect(await res.text()).toContain(
      'event: look-closer\ndata: {"type":"look-closer","heard":"What\'s this?","said":"Let me look."}',
    );
  });

  it("takes the second pass with the picture and what was already said", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "done", result: { messages: [] } as never };
    });
    const image = "data:image/jpeg;base64,AAAA";
    await (
      await POST(
        form({
          text: "What's this?",
          mode: "look",
          "said-first": "Let me look.",
          screen: image,
          scene: JSON.stringify(scene),
        }),
      )
    ).text();

    expect(vi.mocked(chatStream).mock.calls[0][2]).toMatchObject({
      saidFirst: "Let me look.",
      sight: { image },
    });
  });

  it("still takes a recording as a voice turn", async () => {
    vi.mocked(chatFromVoiceStream).mockImplementation(async function* () {
      yield { type: "done", result: { messages: [] } as never };
    });
    const audio = new File([new Uint8Array(2000)], "persuna.wav", { type: "audio/wav" });
    await (await POST(form({ audio }))).text();

    expect(vi.mocked(chatFromVoiceStream)).toHaveBeenCalledOnce();
    expect(vi.mocked(chatStream)).not.toHaveBeenCalled();
  });

  it("refuses a turn with neither words nor a recording", async () => {
    expect((await POST(form({ text: "  " }))).status).toBe(400);
  });

  it("is for signed-in users", async () => {
    vi.mocked(getUser).mockResolvedValue(null as never);
    expect((await POST(form({ text: "hi" }))).status).toBe(401);
  });

  it("refuses a Talk turn carrying a screen read", async () => {
    const res = await POST(form({ text: "hi", mode: "talk", scene: JSON.stringify(scene) }));

    expect(res.status).toBe(400);
    expect(vi.mocked(chatStream)).not.toHaveBeenCalled();
  });

  it("treats a missing or unknown mode as Talk", async () => {
    expect((await POST(form({ text: "hi", scene: JSON.stringify(scene) }))).status).toBe(400);
    expect(
      (await POST(form({ text: "hi", mode: "watching", scene: JSON.stringify(scene) }))).status,
    ).toBe(400);
    expect(vi.mocked(chatStream)).not.toHaveBeenCalled();
  });

  it("takes a Work turn carrying a screen read", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "done", result: { messages: [] } as never };
    });
    const res = await POST(form({ text: "hi", mode: "work", scene: JSON.stringify(scene) }));

    expect(res.status).toBe(200);
    expect(vi.mocked(chatStream)).toHaveBeenCalledOnce();
  });

  it("audits each screen read with its mode", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "done", result: { messages: [] } as never };
    });
    const withApp = { ...scene, app: "Mail" };
    await (await POST(form({ text: "hi", mode: "look", scene: JSON.stringify(withApp) }))).text();

    expect(vi.mocked(audit)).toHaveBeenCalledOnce();
    expect(vi.mocked(audit).mock.calls[0][0]).toMatchObject({
      action: "screen.read",
      entityType: "screen_read",
      details: { mode: "look", app: "Mail" },
    });
  });

  it("audits nothing for a turn without a screen read", async () => {
    vi.mocked(chatStream).mockImplementation(async function* () {
      yield { type: "done", result: { messages: [] } as never };
    });
    await (await POST(form({ text: "hi", mode: "talk" }))).text();

    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});
