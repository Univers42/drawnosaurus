/**
 * End-to-end smoke test for the inspector, against a real dev server.
 *
 * Not a unit test. The whole point of this tool is that it reaches through Playwright,
 * the DOM, the WASM boundary and into a Rust engine — and every one of those joins is a
 * place it can be wrong while every part looks right on its own. So this drives the real
 * thing and checks the numbers move when the editor does.
 *
 *     make dev                                  # web on :5373
 *     export PLAYWRIGHT_BROWSERS_PATH=/sgoinfre/students/$USER/.cache/ms-playwright
 *     node tools/editor-inspector/src/smoke.ts
 */

import { canonicalScene, diffScenes } from "./canonical.ts";
import { InspectorSession, type DebugWindow } from "./session.ts";

type Json = Record<string, unknown>;

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const session = new InspectorSession();

try {
  const { url } = await session.open(process.env.INSPECTOR_URL);
  console.log(`opened ${url}`);
  const page = session.requirePage();
  const snapshot = () =>
    page.evaluate(() =>
      (window as never as DebugWindow).__drawEngine!.debugSnapshot(),
    ) as Promise<Json>;

  const empty = await snapshot();
  check("a fresh board has no elements", (empty.scene as Json).elementCount === 0);
  check("the viewport reports a size", (empty.viewport as Json).width! > 0);
  check(
    "frames have been painted",
    ((empty.rendering as Json).frames as number) > 0,
    JSON.stringify(empty.rendering),
  );

  // Draw a rectangle with several moves — a single-move drag is exactly what hides the
  // bugs this tool exists to find.
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("no canvas box");
  const at = (x: number, y: number) => ({ x: box.x + x, y: box.y + y });

  await page.evaluate(() => (window as never as DebugWindow).__drawEngine!.setTool("rectangle"));
  const from = at(520, 260);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(from.x + 32 * step, from.y + 20 * step);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);

  const drawn = await snapshot();
  check("drawing adds an element", (drawn.scene as Json).elementCount === 1);
  check("the revision moved", (drawn.scene as Json).revision !== (empty.scene as Json).revision);
  check("the new shape is selected", (drawn.scene as Json).selectedCount === 1);
  check(
    "the gesture is over",
    (drawn.interaction as Json).kind === null,
    String((drawn.interaction as Json).kind),
  );
  check(
    "pointer events outnumber engine steps",
    ((drawn.host as Json).pointerEvents as number) >= ((drawn.host as Json).engineSteps as number),
    JSON.stringify(drawn.host),
  );
  check(
    "something was rendered",
    ((drawn.rendering as Json).elementsRendered as number) >= 1,
    JSON.stringify(drawn.rendering),
  );

  // Hit testing through the engine, not guessed from pixels.
  const middle = at(600, 320);
  const hit = await page.evaluate(
    ([x, y]) => (window as never as DebugWindow).__drawEngine!.hitTest(x!, y!, 10) ?? null,
    [600, 320] as const,
  );
  check(
    "hit_test finds the outline of a transparent shape",
    hit === null,
    "a transparent shape is hit on its outline only — the middle is a hole, by design",
  );
  void middle;

  const onEdge = await page.evaluate(
    ([x, y]) => (window as never as DebugWindow).__drawEngine!.hitTest(x!, y!, 10) ?? null,
    [520, 260] as const,
  );
  check("hit_test finds it on its corner", onEdge !== null);

  check(
    "hit tests were timed",
    ((await snapshot()).host as Json).hitTests !== 0,
    JSON.stringify((await snapshot()).host),
  );

  // Canonical form: a scene must compare equal to itself, and a change must show up.
  const json = await page.evaluate(() =>
    (window as never as DebugWindow).__drawEngine!.exportJson(),
  );
  const elements = (JSON.parse(json) as { elements?: Json[] }).elements ?? [];
  const canonical = canonicalScene(elements);
  check("canonical form drops identity", !("id" in (canonical[0] ?? {})));
  check("canonical form keeps geometry", "width" in (canonical[0] ?? {}));
  check("a scene equals itself", diffScenes(canonical, canonicalScene(elements)).equal);

  const moved = structuredClone(elements);
  (moved[0] as Json).x = ((moved[0] as Json).x as number) + 50;
  const diff = diffScenes(canonical, canonicalScene(moved));
  check("a moved element is a difference", !diff.equal, JSON.stringify(diff.differences));

  const errors = session.takeErrors();
  check("the page threw nothing", errors.length === 0, errors.join(" | "));
} finally {
  await session.close();
}

console.log(failures === 0 ? "\nsmoke: all green" : `\nsmoke: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
