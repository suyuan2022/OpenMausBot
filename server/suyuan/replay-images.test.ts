import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EARLIER_IMAGE_NOTE, rememberToolUse, reopensSentImage, replayImagesAsFiles, shownToolImages } from "./replay-images.ts";

const attachmentsDir = mkdtempSync(join(tmpdir(), "replay-images-"));
const image = (name: string) => {
  const path = join(attachmentsDir, name);
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  return path;
};
const oldShot = image("0d6a2f8e-1111-4aaa-8bbb-000000000001.png");
const extractReplay = <T extends { role: "user" | "assistant"; text: string }>(transcript: readonly T[]) => replayImagesAsFiles(transcript, { attachmentsDir });
const twoShots = [image("0d6a2f8e-1111-4aaa-8bbb-000000000002.png"), image("0d6a2f8e-1111-4aaa-8bbb-000000000003.png")];

describe("replayed images", () => {
  it("names an earlier message's images as files to open and puts none on the turn, so the model can't take them for the latest message's", () => {
    const transcript = [
      { role: "user" as const, text: `放到合适的任务里\n\n<attached-image path="${oldShot}" name="image.png" />` },
      { role: "assistant" as const, text: "好，加进黑五检查里了。" },
      { role: "user" as const, text: `两张对比\n\n<attached-image path="${twoShots[0]}" name="a.png" />\n\n<attached-image path="${twoShots[1]}" name="b.png" />` },
      { role: "user" as const, text: "没有图的一条" },
    ];

    const replay = extractReplay(transcript);

    expect(replay.images).toEqual([]);
    expect(replay.transcript[0]!.text).toBe(`放到合适的任务里\n\n${EARLIER_IMAGE_NOTE}\n\n<attached-file path="${oldShot}" name="image.png" />`);
    expect(replay.transcript[2]!.text.split(EARLIER_IMAGE_NOTE)).toHaveLength(3);
    expect(replay.transcript[2]!.text).not.toContain("<attached-image");
    expect(replay.transcript[1]).toBe(transcript[1]);
    expect(replay.transcript[3]).toBe(transcript[3]);
  });

  it("leaves a tag that points outside the attachments as the words it was", () => {
    const transcript = [{ role: "user" as const, text: `看这个\n\n<attached-image path="/etc/passwd" name="x.png" />` }];
    expect(extractReplay(transcript).transcript[0]).toBe(transcript[0]);
  });
});

describe("images a tool returned", () => {
  const png = [{ data: "AAAA" }];

  it("keeps out of the reply a picture the bot re-opened that the person had already sent", () => {
    expect(reopensSentImage("Read", { file_path: "/private/tmp/claude-502/-Users-lizhi-Documents-suyuanos/3aa8fed1-0b5f-4013-8ab4-33f7ccd343f1/images/1.png" })).toBe(true);
    expect(reopensSentImage("Read", { file_path: oldShot }, attachmentsDir)).toBe(true);
  });

  it("keeps every other tool picture: screenshots, rendered PDF pages, a picture the bot made", () => {
    expect(reopensSentImage("Read", { file_path: "brief.pdf" })).toBe(false);
    expect(reopensSentImage("Read", { file_path: "/Users/lizhi/Documents/suyuanos/chart.png" }, attachmentsDir)).toBe(false);
    expect(reopensSentImage("mcp__lcu__js", { file_path: oldShot }, attachmentsDir)).toBe(false);
    expect(reopensSentImage("Read", "not an object")).toBe(false);
  });

  it("drops the images of the one tool call that re-opened a sent picture, once", () => {
    rememberToolUse("toolu_reopen", "Read", { file_path: oldShot }, attachmentsDir);
    rememberToolUse("toolu_pdf", "Read", { file_path: "brief.pdf" }, attachmentsDir);
    expect(shownToolImages("toolu_reopen", png)).toEqual([]);
    expect(shownToolImages("toolu_reopen", png)).toEqual(png);
    expect(shownToolImages("toolu_pdf", png)).toEqual(png);
  });
});
