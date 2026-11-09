import { describe, expect, it } from "vitest";
import { attachmentCacheControl } from "./attachment-cache.ts";

describe("attachmentCacheControl", () => {
  it("keeps pictures for good and everything else uncached", () => {
    expect(attachmentCacheControl("image/png")).toBe("private, max-age=31536000, immutable");
    expect(attachmentCacheControl("image/webp")).toBe("private, max-age=31536000, immutable");
    expect(attachmentCacheControl("audio/mp4")).toBe("private, no-store");
    expect(attachmentCacheControl("application/pdf")).toBe("private, no-store");
  });
});
