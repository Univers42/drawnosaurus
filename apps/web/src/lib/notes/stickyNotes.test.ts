import { describe, expect, it } from "vitest";
import { drawElementSchema, type DrawElementDto } from "@drawnosaurus/contract";
import { migrateLegacyStickyGroups, migrateLegacyStickyJson } from "./stickyNotes.ts";
import board from "./fixtures/legacy-sticky-zxkqwodsxu.json";

const LEGACY_GROUP = "el-1972369698-1218107780";
const LOOKALIKE_GROUP = "el-321662093-1831537800";
const SHADOW = "el-182453653-1037543462";
const NOTE = "el-1744582970-916586019";
const DATE = "el-735064406-2073341333";
const LABEL = "el-455390627-177421627";

/** Parsed as the server would take it, so the fixture is known to be real wire elements. */
const fixture = drawElementSchema.array().parse(board.elements);
const inGroup = (group: string) => fixture.filter((element) => element.groupIds?.[0] === group);
const byId = (elements: readonly DrawElementDto[], id: string): DrawElementDto => {
  const found = elements.find((element) => element.id === id);
  if (!found) throw new Error(`no element ${id}`);
  return found;
};

/** The day after the fixture's note was drawn, mid-morning. */
const NOW = new Date(2026, 8, 25, 10).getTime();
const nonce = () => 7;

type Pieces = [
  shadow: DrawElementDto,
  note: DrawElementDto,
  date: DrawElementDto,
  label: DrawElementDto,
];

/** What the old factory made, piece by piece. */
function legacyNote(
  options: {
    groupIds?: string[];
    text?: string;
    date?: string;
    ink?: string;
    fontSize?: number;
  } = {},
): Pieces {
  const common = {
    angle: 0,
    fillStyle: "solid",
    strokeStyle: "solid",
    roughness: 0,
    seed: 1,
    groupIds: options.groupIds ?? ["legacy"],
    version: 3,
    versionNonce: 30,
    updated: 1,
    isDeleted: false,
  } as const;
  return [
    {
      ...common,
      id: "n-shadow",
      type: "rectangle",
      x: 3,
      y: 3,
      width: 220,
      height: 220,
      strokeColor: "transparent",
      backgroundColor: "#000000",
      strokeWidth: 0,
      opacity: 16,
      roundness: 12,
      locked: true,
    },
    {
      ...common,
      id: "n",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 220,
      height: 220,
      strokeColor: "#a5d8ff",
      backgroundColor: "#a5d8ff",
      strokeWidth: 0,
      opacity: 100,
      roundness: 12,
      boundTextId: "n-label",
    },
    {
      ...common,
      id: "n-date",
      type: "text",
      x: 162,
      y: 194,
      width: 48,
      height: 18,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      strokeWidth: 1,
      opacity: 45,
      roundness: null,
      text: options.date ?? "24 Sep",
      fontSize: 12,
    },
    {
      ...common,
      id: "n-label",
      type: "text",
      x: 16,
      y: 24,
      width: 188,
      height: 164,
      strokeColor: options.ink ?? "#1e1e1e",
      backgroundColor: "transparent",
      strokeWidth: 1,
      opacity: 100,
      roundness: null,
      text: options.text ?? "",
      fontSize: options.fontSize ?? 20,
      containerId: "n",
    },
  ];
}

/** Migrating `input` changes nothing: the same objects back, nothing to save. */
const untouched = (input: readonly DrawElementDto[]) => {
  const result = migrateLegacyStickyGroups(input, NOW, nonce);
  expect(result.changed).toEqual([]);
  expect(result.removed).toEqual([]);
  expect(result.elements).toHaveLength(input.length);
  result.elements.forEach((element, index) => expect(element).toBe(input[index]));
};

describe("the fixture", () => {
  it("holds the four pieces of one legacy note, and a group of four that is not one", () => {
    expect(inGroup(LEGACY_GROUP).map((element) => element.id)).toEqual([SHADOW, NOTE, DATE, LABEL]);
    expect(inGroup(LOOKALIKE_GROUP)).toHaveLength(4);
    expect(fixture).toHaveLength(8);
  });
});

describe("migrateLegacyStickyGroups", () => {
  it("turns the four pieces of a note on a real board into one note, and nothing else", () => {
    const { elements, changed, removed } = migrateLegacyStickyGroups(fixture, NOW, nonce);

    const note = {
      ...byId(fixture, NOTE),
      type: "stickynote" as const,
      // The legacy border was the pad's own colour; natively the stroke is the ink.
      strokeColor: "#1e1e1e",
      baseHeight: 220,
      created: new Date(2026, 8, 24, 12).getTime(),
      version: 7,
      versionNonce: 7,
      updated: NOW,
    };
    delete note.groupIds;
    delete note.boundTextId;
    expect(changed).toEqual([note]);
    expect(changed[0]).not.toHaveProperty("groupIds");
    expect(changed[0]).not.toHaveProperty("boundTextId");
    expect(drawElementSchema.safeParse(changed[0]).success).toBe(true);

    // The label never had a word in it: gone, with the shadow and the date.
    expect(removed.map((element) => element.id)).toEqual([SHADOW, DATE, LABEL]);
    for (const tombstone of removed) {
      const before = byId(fixture, tombstone.id);
      expect(tombstone).toEqual({
        ...before,
        isDeleted: true,
        version: before.version + 1,
        versionNonce: 7,
        updated: NOW,
      });
    }

    // In place of the rectangle it was; the lookalike group, the very same objects.
    expect(elements.map((element) => element.id)).toEqual([
      NOTE,
      ...inGroup(LOOKALIKE_GROUP).map((element) => element.id),
    ]);
    expect(elements[0]).toBe(changed[0]);
    for (const element of elements.slice(1)) expect(element).toBe(byId(fixture, element.id));
  });

  it("keeps a label that says something, bound to the note, in its ink and at its size", () => {
    const input = legacyNote({ text: "hello", ink: "#e03131", fontSize: 28 });
    const { elements, changed, removed } = migrateLegacyStickyGroups(input, NOW, nonce);

    expect(elements.map((element) => element.id)).toEqual(["n", "n-label"]);
    const [note, label] = changed;
    expect(note).toMatchObject({
      id: "n",
      type: "stickynote",
      strokeColor: "#e03131",
      backgroundColor: "#a5d8ff",
      boundTextId: "n-label",
      version: 4,
    });
    expect(note).not.toHaveProperty("groupIds");
    expect(label).toEqual({
      ...input[3],
      groupIds: undefined,
      baseFontSize: 28,
      version: 4,
      versionNonce: 7,
      updated: NOW,
    });
    expect(label).not.toHaveProperty("groupIds");
    expect(removed.map((element) => element.id)).toEqual(["n-shadow", "n-date"]);
    for (const element of changed) expect(drawElementSchema.safeParse(element).success).toBe(true);
  });

  it("writes in the default ink over a transparent label, and at 20 a label with no size", () => {
    const input = legacyNote({ text: "hi", ink: "transparent" });
    delete input[3].fontSize;
    const [note, label] = migrateLegacyStickyGroups(input, NOW, nonce).changed;
    expect(note?.strokeColor).toBe("#1e1e1e");
    expect(label?.baseFontSize).toBe(20);
    expect(label).not.toHaveProperty("fontSize");
  });

  it("keeps a note grouped with other shapes in that outer group", () => {
    const input = legacyNote({ text: "inside", groupIds: ["legacy", "outer"] });
    const { changed } = migrateLegacyStickyGroups(input, NOW, nonce);
    expect(changed.map((element) => element.groupIds)).toEqual([["outer"], ["outer"]]);
  });

  it("reads the pre-array spelling of a group", () => {
    const input = legacyNote({ text: "old" }).map((element) => {
      const old = { ...element, groupId: "legacy" };
      delete old.groupIds;
      return old;
    });
    const { changed, removed } = migrateLegacyStickyGroups(input, NOW, nonce);
    expect(changed.map((element) => element.type)).toEqual(["stickynote", "text"]);
    for (const element of changed) expect(element).not.toHaveProperty("groupId");
    expect(removed).toHaveLength(2);
  });

  it("dates a note in the year its date names", () => {
    const [note] = migrateLegacyStickyGroups(
      legacyNote({ date: "3 Mar 2024" }),
      NOW,
      nonce,
    ).changed;
    expect(note?.created).toBe(new Date(2024, 2, 3, 12).getTime());
  });

  it("dates a note without a year on the last such day that is not after today", () => {
    const newYear = new Date(2026, 0, 2, 9).getTime();
    const created = (date: string) =>
      migrateLegacyStickyGroups(legacyNote({ date }), newYear, nonce).changed[0]?.created;
    expect(created("31 Dec")).toBe(new Date(2025, 11, 31, 12).getTime());
    expect(created("2 Jan")).toBe(new Date(2026, 0, 2, 12).getTime());
    expect(created("29 Feb")).toBe(new Date(2024, 1, 29, 12).getTime());
  });

  it("leaves alone what only looks like a note", () => {
    // The same board's other group of four: a rectangle, two diamonds and an arrow.
    untouched(inGroup(LOOKALIKE_GROUP));

    const [shadow, note, date, label] = legacyNote({ text: "x" });
    // No shadow.
    untouched([note, date, label]);
    // A shape added to the group.
    untouched([shadow, note, date, label, { ...date, id: "extra", text: "extra" }]);
    // A shadow that is an ordinary shape.
    untouched([{ ...shadow, opacity: 100 }, note, date, label]);
    untouched([{ ...shadow, backgroundColor: "#1e1e1e" }, note, date, label]);
    // A note with no pad.
    untouched([shadow, { ...note, backgroundColor: "transparent" }, date, label]);
    // A date that is not one.
    for (const text of ["Sep 24", "24 Sept", "24 sep", "31 Feb", "hello", "24 Sep 26"]) {
      untouched([shadow, note, { ...date, text }, label]);
    }
    // A label that is not this note's.
    untouched([shadow, note, date, { ...label, containerId: "elsewhere" }]);
    // A shadow already deleted leaves three pieces, one of them missing.
    untouched([{ ...shadow, isDeleted: true }, note, date, label]);
  });

  it("binds an arrow bound to a shadow to its note", () => {
    const [shadow, note, date, label] = legacyNote({ text: "target" });
    const arrow: DrawElementDto = {
      ...date,
      id: "a",
      type: "arrow",
      groupIds: [],
      text: undefined,
      points: [
        [0, 0],
        [100, 0],
      ],
      startBinding: "elsewhere",
      endBinding: "n-shadow",
    };
    const bystander: DrawElementDto = { ...arrow, id: "b", endBinding: "n" };
    const { elements, changed } = migrateLegacyStickyGroups(
      [shadow, note, date, label, arrow, bystander],
      NOW,
      nonce,
    );
    expect(elements.map((element) => element.id)).toEqual(["n", "n-label", "a", "b"]);
    expect(changed.map((element) => element.id)).toEqual(["n", "n-label", "a"]);
    expect(byId(changed, "a")).toEqual({
      ...arrow,
      endBinding: "n",
      version: arrow.version + 1,
      versionNonce: 7,
      updated: NOW,
    });
    expect(byId(elements, "b")).toBe(bystander);
  });

  it("changes nothing the second time", () => {
    const once = migrateLegacyStickyGroups(
      [...fixture, ...legacyNote({ text: "again" })],
      NOW,
      nonce,
    );
    expect(once.changed).toHaveLength(3);
    untouched(once.elements);
  });

  it("gives a board without such a note back as it was", () => {
    untouched([...inGroup(LOOKALIKE_GROUP), ...legacyNote({ text: "x" }).slice(1)]);
    untouched([]);
  });
});

describe("migrateLegacyStickyJson", () => {
  it("converts a document's notes, and omits the pieces it dropped", () => {
    const document = { type: "osidraw", version: 1, elements: fixture, appState: { zoom: 2 } };
    const text = migrateLegacyStickyJson(JSON.stringify(document), NOW, nonce);
    expect(text).not.toBeNull();
    const migrated = JSON.parse(text ?? "") as typeof document;
    expect(migrated.type).toBe("osidraw");
    expect(migrated.version).toBe(1);
    expect(migrated.appState).toEqual({ zoom: 2 });
    expect(migrated.elements.map((element) => element.id)).toEqual([
      NOTE,
      ...inGroup(LOOKALIKE_GROUP).map((element) => element.id),
    ]);
    expect(migrated.elements[0]?.type).toBe("stickynote");
    expect(migrated.elements.some((element) => element.isDeleted)).toBe(false);
  });

  it("answers null for what is not a document with a legacy note in it", () => {
    const document = (elements: unknown) =>
      JSON.stringify({ type: "osidraw", version: 1, elements });
    expect(migrateLegacyStickyJson("hello", NOW, nonce)).toBeNull();
    expect(migrateLegacyStickyJson("[]", NOW, nonce)).toBeNull();
    expect(migrateLegacyStickyJson("null", NOW, nonce)).toBeNull();
    expect(
      migrateLegacyStickyJson(
        JSON.stringify({ type: "excalidraw", elements: fixture }),
        NOW,
        nonce,
      ),
    ).toBeNull();
    expect(migrateLegacyStickyJson(document(inGroup(LOOKALIKE_GROUP)), NOW, nonce)).toBeNull();
    expect(migrateLegacyStickyJson(document([null, 3]), NOW, nonce)).toBeNull();
    expect(migrateLegacyStickyJson(document("nope"), NOW, nonce)).toBeNull();
  });
});
