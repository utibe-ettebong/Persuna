import { describe, expect, it } from "vitest";
import { trustedOrigins } from "./policy";

describe("trustedOrigins", () => {
  it("keeps the origin of each configured URL, once", () => {
    expect(
      trustedOrigins([
        "https://persuna.up.railway.app/",
        "https://persuna-production.up.railway.app",
        "https://persuna.up.railway.app/sign-in",
      ]),
    ).toEqual(["https://persuna.up.railway.app", "https://persuna-production.up.railway.app"]);
  });

  it("skips unset and malformed values", () => {
    expect(trustedOrigins([undefined, "", "not a url", "http://localhost:3000"])).toEqual([
      "http://localhost:3000",
    ]);
  });
});
