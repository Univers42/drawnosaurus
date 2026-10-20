import { describe, expect, it } from "vitest";
import { formFactorFor } from "./formFactor.ts";

/**
 * The oracle's breakpoints, as thresholds with the numbers in them
 * (`packages/common/src/editorInterface.ts@1118751f:117-129` is the rule as we port it).
 */
describe("formFactorFor", () => {
  it("phones on the phone's own sizes", () => {
    // The two the brief measures: a portrait iPhone and the narrowest screen left standing.
    expect(formFactorFor(390, 844)).toBe("phone");
    expect(formFactorFor(360, 740)).toBe("phone");
  });

  it("phones on a landscape phone, where width is generous and height is not", () => {
    // `h < MQ_MAX_HEIGHT_LANDSCAPE && w < MQ_MAX_WIDTH_LANDSCAPE`: short, not-wide is a
    // phone even though the width alone would say tablet.
    expect(formFactorFor(844, 390)).toBe("phone");
    expect(formFactorFor(800, 430)).toBe("phone");
    expect(formFactorFor(999, 499)).toBe("phone");
  });

  it("is not fooled by width alone into calling a phone tall enough a tablet", () => {
    expect(formFactorFor(599, 900)).toBe("phone");
    expect(formFactorFor(600, 900)).not.toBe("phone");
  });

  it("tablets on the oracle's band", () => {
    // An iPad portrait and something its height: at least 600 on the narrow side, at
    // most 1180 on the long one.
    expect(formFactorFor(768, 1024)).toBe("tablet");
    expect(formFactorFor(1180, 820)).toBe("tablet");
    expect(formFactorFor(600, 1000)).toBe("tablet");
  });

  it("leaves the short-but-wide edge outside the letterboxing", () => {
    // Height at the landscape line fails the height test; width at its cap fails the
    // width test — both fall through to the tablet band.
    // Width at the phone line, though, still phones.
    expect(formFactorFor(1000, 499)).not.toBe("phone");
    expect(formFactorFor(900, 500)).not.toBe("phone");
    expect(formFactorFor(599, 500)).toBe("phone");
  });

  it("desktops above the tablet band", () => {
    expect(formFactorFor(1280, 800)).toBe("desktop");
    expect(formFactorFor(1440, 900)).toBe("desktop");
    expect(formFactorFor(1181, 820)).toBe("desktop");
  });

  it("reads portrait and landscape as the same factor for phones", () => {
    // A rotation is a resize; whichever way it turns, a phone stays a phone.
    expect(formFactorFor(390, 844)).toBe(formFactorFor(844, 390));
  });
});
