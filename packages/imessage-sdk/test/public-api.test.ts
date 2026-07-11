import { describe, expectTypeOf, it } from "vitest";

import type { IMessageProviderName } from "../src/index.js";

describe("public API scaffold", () => {
  it("includes the three v0.1 providers", () => {
    expectTypeOf<IMessageProviderName>().toEqualTypeOf<
      "blooio" | "photon" | "sendblue"
    >();
  });
});
