import { describe, expect, it } from "vitest";
import { attachmentCacheControl } from "./attachment-cache.ts";

describe("attachmentCacheControl", () => {
  it("keeps pictures for good and everything else uncached", () => {
    expect(attachmentCacheControl("image/png", true)).toBe("private, max-age=31536000, immutable");
    expect(attachmentCacheControl("image/webp", true)).toBe("private, max-age=31536000, immutable");
    expect(attachmentCacheControl("audio/mp4", true)).toBe("private, no-store");
    expect(attachmentCacheControl("application/pdf", true)).toBe("private, no-store");
  });

  it("caches nothing where more than one identity may sign in", () => {
    expect(attachmentCacheControl("image/png", false)).toBe("private, no-store");
    expect(attachmentCacheControl("application/pdf", false)).toBe("private, no-store");
  });
});
