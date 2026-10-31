import { describe, expect, it } from "vitest";
// The desktop's permission-health module is plain Node (no Electron), pinned from here.
import { keyboardStatus, micStatus, screenStatus } from "../../../desktop/health.js";

describe("micStatus", () => {
  it("reports what the OS says, on Mac and Windows alike", () => {
    expect(micStatus(true, "granted")).toBe("granted");
    expect(micStatus(false, "denied")).toBe("denied");
    expect(micStatus(false, "not-determined")).toBe("not-determined");
  });
});

describe("keyboardStatus", () => {
  it("is granted only while the talk-key hook is actually listening", () => {
    expect(keyboardStatus({ mac: false, listening: true, error: null })).toBe("granted");
    // Allowed on paper, broken in reality: the hook failed to start.
    expect(keyboardStatus({ mac: false, listening: false, error: "start failed" })).toBe("denied");
    expect(keyboardStatus({ mac: false, listening: false, error: null })).toBe("not-determined");
    expect(keyboardStatus({ mac: true, allowed: false, listening: false, error: null })).toBe(
      "denied",
    );
    expect(keyboardStatus({ mac: true, allowed: true, listening: true, error: null })).toBe(
      "granted",
    );
  });
});

describe("screenStatus", () => {
  it("is granted on Windows only when the eyes probe sees the screen", () => {
    expect(screenStatus({ mac: false, eyes: true })).toBe("granted");
    expect(screenStatus({ mac: false, eyes: false })).toBe("denied");
    expect(screenStatus({ mac: false, eyes: null })).toBe("unknown");
    expect(screenStatus({ mac: true, os: "granted" })).toBe("granted");
    expect(screenStatus({ mac: true, os: "denied" })).toBe("denied");
  });
});
