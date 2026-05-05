import { describe, expect, test } from "bun:test";
import { extensionLanguage, isFocus, parseJsonFromText, repoNameFromTarget, sanitizeName } from "../src/utils";

describe("utils", () => {
  test("validates focus values", () => {
    expect(isFocus("authz")).toBe(true);
    expect(isFocus("other")).toBe(false);
  });

  test("derives stable repo names", () => {
    expect(repoNameFromTarget("https://github.com/example/vulnerable-app.git")).toBe("vulnerable-app");
    expect(repoNameFromTarget("git@github.com:example/project.git")).toBe("project");
    expect(sanitizeName("weird repo!")).toBe("weird-repo");
  });

  test("maps common languages", () => {
    expect(extensionLanguage("src/main.rs")).toBe("rust");
    expect(extensionLanguage("src/server.ts")).toBe("typescript");
    expect(extensionLanguage("kernel/io_uring.c")).toBe("c");
  });

  test("extracts fenced JSON", () => {
    expect(parseJsonFromText<{ ok: boolean }>("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
  });
});
