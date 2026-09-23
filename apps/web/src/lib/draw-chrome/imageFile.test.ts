import { describe, expect, it } from "vitest";
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_SIDE,
  needsDownscale,
  prepareImageFile,
  smallerOf,
  scaledToFit,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  describeRejection,
  imagesFrom,
  isSupportedImageType,
  isWithinSizeLimit,
  rejectImageFile,
} from "./imageFile.ts";

describe("which files can be inserted", () => {
  it("accepts the types Excalidraw accepts", () => {
    for (const type of ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/avif"]) {
      expect(isSupportedImageType(type), type).toBe(true);
    }
  });

  it("is not case sensitive about the type", () => {
    // Some platforms report `IMAGE/PNG`, and a file refused for its capitalisation looks
    // like a file refused for no reason.
    expect(isSupportedImageType("IMAGE/PNG")).toBe(true);
  });

  it("refuses things that are not images", () => {
    for (const type of ["application/pdf", "text/plain", "video/mp4", "", "image"]) {
      expect(isSupportedImageType(type), type).toBe(false);
    }
  });

  it("refuses files past the size limit", () => {
    // The image rides on the element, so it is carried by every autosave, every realtime
    // message and every export. Past a few megabytes that stops being a picture and
    // starts being the reason the board is slow.
    expect(isWithinSizeLimit(0)).toBe(true);
    expect(isWithinSizeLimit(IMAGE_MAX_BYTES)).toBe(true);
    expect(isWithinSizeLimit(IMAGE_MAX_BYTES + 1)).toBe(false);
    expect(isWithinSizeLimit(Number.NaN)).toBe(false);
    expect(isWithinSizeLimit(-1)).toBe(false);
  });

  it("says which rule a file broke", () => {
    // Which one matters: "too big" and "wrong kind" need different things from the user.
    expect(rejectImageFile({ type: "application/pdf", size: 10 })).toBe("type");
    expect(rejectImageFile({ type: "image/png", size: IMAGE_MAX_BYTES + 1 })).toBe("size");
    expect(rejectImageFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("checks the type before the size", () => {
    // A 40MB PDF is not "too large"; it is not an image. Reporting the size would send
    // someone off to compress a file that would never have been accepted.
    expect(rejectImageFile({ type: "application/pdf", size: IMAGE_MAX_BYTES * 10 })).toBe("type");
  });

  it("explains every rejection it can produce", () => {
    for (const reason of ["type", "size", "decode"] as const) {
      expect(describeRejection(reason).length, reason).toBeGreaterThan(0);
    }
  });
});

describe("the file input", () => {
  it("offers exactly the types that will be accepted", () => {
    // A picker that lists a type the code then refuses is the worst of both: the file
    // dialog says yes and the board says no.
    expect(IMAGE_ACCEPT.split(",")).toEqual([...IMAGE_MIME_TYPES]);
  });
});

describe("dropping several files at once", () => {
  const file = (type: string): File => ({ type, size: 10, name: "x" }) as File;

  it("keeps the images and drops everything else", () => {
    const picked = imagesFrom([file("image/png"), file("application/pdf"), file("image/webp")]);
    expect(picked.map((f) => f.type)).toEqual(["image/png", "image/webp"]);
  });

  it("keeps the order they were dropped in", () => {
    // The caller offsets each one from the last, so the order decides which ends up on
    // top — and it should be the order you dropped them.
    const picked = imagesFrom([file("image/webp"), file("image/png")]);
    expect(picked.map((f) => f.type)).toEqual(["image/webp", "image/png"]);
  });
});

describe("shrinking large images before the size check", () => {
  it("leaves an image that already fits alone", () => {
    expect(scaledToFit(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledToFit(1440, 900)).toEqual({ width: 1440, height: 900 });
  });

  it("brings the longer side down to the limit and keeps the proportions", () => {
    expect(scaledToFit(4032, 3024)).toEqual({ width: 1440, height: 1080 });
    expect(scaledToFit(3024, 4032)).toEqual({ width: 1080, height: 1440 });
  });

  it("never upscales and never produces a zero side", () => {
    expect(scaledToFit(10, 10)).toEqual({ width: 10, height: 10 });
    expect(scaledToFit(100_000, 1)).toEqual({ width: 1440, height: 1 });
  });

  it("uses Excalidraw's limit", () => {
    expect(IMAGE_MAX_SIDE).toBe(1440);
  });

  it("shrinks raster images past the limit and never SVG", () => {
    expect(needsDownscale("image/jpeg", 4032, 3024)).toBe(true);
    expect(needsDownscale("image/png", 1440, 1440)).toBe(false);
    expect(needsDownscale("image/svg+xml", 9000, 9000)).toBe(false);
    expect(needsDownscale("IMAGE/SVG+XML", 9000, 9000)).toBe(false);
  });
});

describe("preparing a file: type, then shrink, then size", () => {
  const photo = { type: "image/jpeg", size: IMAGE_MAX_BYTES + 1 };
  const shrunkTo = (size: number) => async (file: typeof photo) => ({ ...file, size });

  it("lets in a photo that is over the limit until it is shrunk", async () => {
    // The order the reported bug got wrong: size first refused this outright.
    expect(await prepareImageFile(photo, shrunkTo(900_000))).toEqual({
      file: { type: "image/jpeg", size: 900_000 },
    });
  });

  it("refuses by size what is still too big after shrinking", async () => {
    expect(await prepareImageFile(photo, shrunkTo(IMAGE_MAX_BYTES + 1))).toEqual({
      rejection: "size",
    });
  });

  it("refuses by type before spending anything on shrinking", async () => {
    let shrinks = 0;
    const result = await prepareImageFile({ type: "application/pdf", size: 10 }, async (file) => {
      shrinks += 1;
      return file;
    });
    expect(result).toEqual({ rejection: "type" });
    expect(shrinks).toBe(0);
  });
});

describe("never trading a file for a bigger one", () => {
  it("keeps the original when the re-encoded copy came out larger", () => {
    // An AVIF re-encoded as PNG, say.
    expect(smallerOf({ size: 3_000_000 }, { size: 400_000 })).toEqual({ size: 400_000 });
    expect(smallerOf({ size: 300_000 }, { size: 4_000_000 })).toEqual({ size: 300_000 });
  });

  it("leaves an animated GIF alone rather than flattening it to one frame", () => {
    expect(needsDownscale("image/gif", 4000, 3000)).toBe(false);
  });
});
