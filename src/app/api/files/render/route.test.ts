import { describe, expect, it, vi } from "vitest";
import { getUser } from "@/lib/auth/session";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn() }));

const USER = { id: "user-1", name: "Ada", email: "ada@example.com", isAdmin: false };

const call = (body: unknown, signedIn = true) => {
  vi.mocked(getUser).mockResolvedValue(signedIn ? USER : null);
  return POST(
    new Request("https://app.example.com/api/files/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
};

describe("POST /api/files/render", () => {
  it("refuses signed-out browsers and bad input", async () => {
    expect(
      (await call({ kind: "document", title: "T", body: "x", format: "docx" }, false)).status,
    ).toBe(401);
    expect((await call({ kind: "flow", title: "T", body: "x", format: "docx" })).status).toBe(400);
  });

  it("renders documents and tables to Office bytes", async () => {
    const docx = await call({ kind: "document", title: "Notes", body: "# Hi", format: "docx" });
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    expect(
      Buffer.from(await docx.arrayBuffer())
        .subarray(0, 2)
        .toString(),
    ).toBe("PK");

    const xlsx = await call({ kind: "table", title: "Prices", body: "a,b\n1,2", format: "xlsx" });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
  });
});
