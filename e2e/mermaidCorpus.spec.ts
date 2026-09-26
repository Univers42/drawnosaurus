import { test, expect } from "./fixtures.ts";
import { openBoard } from "./board.ts";
import { CORPUS } from "./mermaid/corpus.ts";
import { finiteNumbers, labelsFit, picture, type Placed } from "./mermaid/checks.ts";
import { TYPES } from "./mermaid/types.ts";

/**
 * Real diagrams (`mermaid/corpus.ts`), each placed as the dialog places it and attached
 * beside the SVG Mermaid drew for the converter — the same one, taken from the converter's
 * own off-screen container before it is removed. The picture is for a person to judge;
 * what is asserted is geometric, as in the fuzzer: nothing at NaN, every label inside its
 * shape, a native type as shapes and a picture type as its picture and badge.
 */

for (const { type, name, source } of CORPUS) {
  test(`mermaid corpus: ${type} — ${name}`, async ({ page }, testInfo) => {
    await openBoard(page);
    const result = await page.evaluate(async (source) => {
      // The converter renders into `#mermaid-to-excalidraw-N-container` and removes it
      // before an observer runs; the records still hold what was added.
      let svg = "";
      const watch = new MutationObserver((records) => {
        for (const record of records) {
          const host = record.target as Element;
          if (!host.id?.startsWith("mermaid-to-excalidraw-")) continue;
          for (const node of record.addedNodes) {
            if (node instanceof SVGSVGElement) svg = node.outerHTML;
          }
        }
      });
      watch.observe(document.body, { childList: true, subtree: true });
      const engine = window.__drawEngine!;
      const converted = await window.__mermaidToElements!(source);
      watch.disconnect();
      engine.clear();
      engine.insertJson(JSON.stringify({ type: "osidraw", version: 1, elements: converted }));
      const placed = (JSON.parse(engine.exportJson()) as { elements: Record<string, unknown>[] })
        .elements;
      // What the dialog's Insert does next: the camera fitted to it, landed, then drawn.
      engine.zoomToFitSelection();
      engine.clearSelection();
      for (let frame = 0; frame < 120; frame += 1) {
        const { camera, cameraTarget } = engine;
        if (
          camera.x === cameraTarget.x &&
          camera.y === cameraTarget.y &&
          camera.scale === cameraTarget.scale
        )
          break;
        await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);
      const png = await engine.exportPng();
      const board = png
        ? await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(png);
          })
        : "";
      return {
        svg,
        board,
        placed: placed.map(({ dataUrl, ...rest }) => ({
          ...rest,
          hasPicture: typeof dataUrl === "string" && dataUrl.startsWith("data:image/"),
        })),
      };
    }, source);

    // Side by side, for the report: Mermaid's drawing, then the board's.
    await page.evaluate(({ svg, board }) => {
      const sheet = document.createElement("div");
      sheet.id = "side-by-side";
      sheet.style.cssText =
        "position:fixed;inset:0;z-index:99999;background:#fff;display:flex;gap:16px;padding:16px;box-sizing:border-box";
      for (const [title, src] of [
        ["Mermaid", `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`],
        ["Board", board],
      ] as const) {
        const half = document.createElement("figure");
        half.style.cssText = "flex:1;margin:0;display:flex;flex-direction:column;min-width:0";
        half.innerHTML = `<figcaption style="font:600 14px system-ui">${title}</figcaption>`;
        const img = document.createElement("img");
        img.src = src;
        img.style.cssText = "flex:1;min-height:0;object-fit:contain;border:1px solid #dee2e6";
        half.append(img);
        sheet.append(half);
      }
      document.body.append(sheet);
    }, result);
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLImageElement>("#side-by-side img")].every(
        (i) => i.complete,
      ),
    );
    const sheet = testInfo.outputPath("side-by-side.png");
    await page.locator("#side-by-side").screenshot({ path: sheet });
    await testInfo.attach(`${type}-${name}`, { path: sheet, contentType: "image/png" });

    expect(result.svg, "Mermaid drew something").toContain("<svg");
    const placed = result.placed as Placed[];
    const failures = [...finiteNumbers(placed), ...labelsFit(placed)];
    if (TYPES[type]!.conversion === "fallback") failures.push(...picture(placed));
    else {
      expect(
        placed.some((e) => e.type === "image"),
        "native, not a picture",
      ).toBe(false);
      expect(placed.filter((e) => e.type === "text").length).toBeGreaterThan(0);
    }
    expect(failures).toEqual([]);
  });
}
