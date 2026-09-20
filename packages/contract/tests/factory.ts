import type { DrawElementDto } from "../src/element.ts";

/**
 * A valid element, overridable field by field. Tests state only what they are
 * actually about; everything else is a sane default so a schema change surfaces
 * here once instead of in every case.
 */
export function element(patch: Partial<DrawElementDto> = {}): DrawElementDto {
  return {
    id: "el-1",
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: 8,
    seed: 12345,
    version: 1,
    versionNonce: 1000,
    updated: 0,
    isDeleted: false,
    ...patch,
  };
}
