import type { WebSocketRoute } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { OPEN_CANVAS, openBoard, pickTool, type Board } from "./board.ts";

/**
 * The live link, when it drops.
 *
 * Reported as a console error — `WebSocket connection … failed: ERR_CONNECTION_REFUSED` —
 * with nothing on the page to say so. The socket already reconnected on its own, but a
 * dropped link was invisible, and what was drawn while it was down was marked as sent and
 * never sent. These check that the page says so, and that nothing is lost.
 *
 * The socket is a Playwright route standing in for engine/realtime, so a spec can drop it
 * and see what arrives on the next one. Frames are sealed with the room key and cannot be
 * read here; PUBLISH frames are counted after the AUTH/SUBSCRIBE handshake.
 */

interface Live {
  sockets: WebSocketRoute[];
  received: number[];
}

function attachLiveHandler(socket: WebSocketRoute, live: Live): void {
  const index = live.sockets.push(socket) - 1;
  live.received[index] = 0;
  socket.onMessage((raw) => {
    let msg: { type?: string; sub_id?: string };
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as {
        type?: string;
        sub_id?: string;
      };
    } catch {
      return;
    }
    if (msg.type === "AUTH") {
      socket.send(
        JSON.stringify({
          type: "AUTH_OK",
          conn_id: `e2e-${index}`,
          server_time: new Date().toISOString(),
        }),
      );
      return;
    }
    if (msg.type === "SUBSCRIBE") {
      socket.send(
        JSON.stringify({
          type: "SUBSCRIBED",
          sub_id: msg.sub_id ?? "live",
          seq: 0,
        }),
      );
      return;
    }
    // Only count collab traffic — not AUTH/SUBSCRIBE control frames.
    if (msg.type === "PUBLISH") {
      live.received[index] = (live.received[index] ?? 0) + 1;
    }
  });
}

async function openWithLive(
  page: Parameters<typeof openBoard>[0],
): Promise<{ board: Board; live: Live }> {
  const live: Live = { sockets: [], received: [] };
  const board = await openBoard(page, "e2e", {
    live: (socket) => attachLiveHandler(socket, live),
  });
  // Connected: the client announces itself (join PUBLISH) after AUTH+SUBSCRIBE.
  await expect.poll(() => live.received[0] ?? 0).toBeGreaterThan(0);
  return { board, live };
}

const liveChip = (page: Parameters<typeof openBoard>[0]) =>
  page.getByLabel("Live collaboration", { exact: true });

async function drawBox(board: Board): Promise<void> {
  const { page, box } = board;
  await pickTool(page, "Rectangle");
  await page.mouse.move(box.x + OPEN_CANVAS.left + 100, box.y + OPEN_CANVAS.top + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + OPEN_CANVAS.left + 260, box.y + OPEN_CANVAS.top + 180, {
    steps: 4,
  });
  await page.mouse.up();
}

test("the header says nothing while the link is up", async ({ page }) => {
  await openWithLive(page);
  await expect(liveChip(page)).toHaveCount(0);
});

test("a dropped link is shown, and clears when it comes back", async ({ page }) => {
  const { live } = await openWithLive(page);

  await live.sockets[0]!.close();

  await expect(liveChip(page)).toContainText("Connection lost");
  // The client reconnects on its own, and the next socket is announced to.
  await expect.poll(() => live.sockets.length, { timeout: 5_000 }).toBe(2);
  await expect.poll(() => live.received[1] ?? 0).toBeGreaterThan(0);
  await expect(liveChip(page)).toHaveCount(0);
});

test("what is done while the link is down reaches peers once it is back", async ({ page }) => {
  // A delete, pressed the moment the link drops: one key, so it lands well inside the
  // half-second before the first reconnect. It used to be marked as sent and dropped.
  const { board, live } = await openWithLive(page);
  await drawBox(board);
  await expect
    .poll(() => live.received[0] ?? 0, { message: "the box went out" })
    .toBeGreaterThan(1);

  await live.sockets[0]!.close();
  await expect(liveChip(page)).toContainText("Connection lost");
  await board.page.keyboard.press("Delete");

  await expect.poll(() => live.sockets.length, { timeout: 5_000 }).toBe(2);
  // Announced, then the delete.
  await expect
    .poll(() => live.received[1] ?? 0, { message: "the offline delete was sent on reconnect" })
    .toBeGreaterThanOrEqual(2);
});
