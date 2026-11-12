import { describe, expect, it } from "vitest";
import { isRowActivation } from "./activation";

const row = { name: "row" };
const link = { name: "link" };

describe("isRowActivation", () => {
  it("activates a focused row on Enter or Space", () => {
    expect(
      isRowActivation({ key: "Enter", target: row, currentTarget: row }),
    ).toBe(true);
    expect(
      isRowActivation({ key: " ", target: row, currentTarget: row }),
    ).toBe(true);
  });

  it("ignores keys that originate from a descendant control", () => {
    expect(
      isRowActivation({ key: "Enter", target: link, currentTarget: row }),
    ).toBe(false);
    expect(
      isRowActivation({ key: " ", target: link, currentTarget: row }),
    ).toBe(false);
  });

  it("ignores other keys", () => {
    expect(
      isRowActivation({ key: "a", target: row, currentTarget: row }),
    ).toBe(false);
  });
});
