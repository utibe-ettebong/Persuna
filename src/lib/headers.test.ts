import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("security headers", () => {
  it("allow the microphone and screen capture for this site (voice and screen walkthroughs)", async () => {
    const rules = await nextConfig.headers!();
    const policy = rules
      .flatMap((r) => r.headers)
      .find((h) => h.key === "Permissions-Policy")!.value;
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("display-capture=(self)");
    expect(policy).toContain("camera=()");
  });
});
