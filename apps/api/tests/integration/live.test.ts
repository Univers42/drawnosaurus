import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as WebSocket from "ws";
import { PING, PONG } from "../../src/boards/live.ts";
import { startTestApp, type TestApp } from "./support/harness.ts";

/**
 * The live route, over real sockets: it relays what one person sends to everyone else in
 * the same room, and answers a ping so a client can tell a dead link from a quiet room.
 */

let harness: TestApp;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await startTestApp();
  app = harness.app;
  await app.ready();
});

afterAll(async () => {
  await harness.close();
});

/** A socket in `room`, with everything it receives collected. */
async function join(
  room: string,
): Promise<{ socket: WebSocket.WebSocket; heard: string[]; id: string }> {
  const heard: string[] = [];
  let welcomed: (id: string) => void = () => {};
  const id = new Promise<string>((done) => (welcomed = done));
  const socket = await app.injectWS(
    `/v1/boards/${room}/live`,
    {},
    {
      onInit: (ws) => {
        ws.on("message", (data: WebSocket.RawData) => {
          const text = data.toString();
          const hello = /^\{"type":"welcome","socket":"([^"]+)"\}$/.exec(text);
          if (hello) welcomed(hello[1]!);
          else heard.push(text);
        });
      },
    },
  );
  return { socket, heard, id: await id };
}

const settle = () => new Promise((done) => setTimeout(done, 50));

describe("the live route", () => {
  it("relays a frame to everyone else in the room, and nowhere else", async () => {
    const ana = await join("room-a");
    const ben = await join("room-a");
    const elsewhere = await join("room-b");

    ana.socket.send('{"sealed":"opaque"}');
    await expect.poll(() => ben.heard).toEqual(['{"sealed":"opaque"}']);
    await settle();
    expect(ana.heard, "echoed to the sender").toEqual([]);
    expect(elsewhere.heard, "leaked to another room").toEqual([]);

    for (const { socket } of [ana, ben, elsewhere]) socket.terminate();
  });

  it("answers a ping, to the one who asked only", async () => {
    const ana = await join("room-c");
    const ben = await join("room-c");

    ana.socket.send(PING);

    await expect.poll(() => ana.heard).toEqual([PONG]);
    await settle();
    expect(ben.heard, "a ping is not news for anyone else").toEqual([]);

    for (const { socket } of [ana, ben]) socket.terminate();
  });

  it("tells the room when someone's connection goes, naming only its socket", async () => {
    // Over a real port with the runtime's own client, closed as a browser closes a tab:
    // the in-memory sockets above never finish a close handshake.
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const url = `${address.replace(/^http/, "ws")}/v1/boards/room-d/live`;
    const open = async () => {
      const socket = new globalThis.WebSocket(url);
      const heard: string[] = [];
      const id = new Promise<string>((done) => {
        socket.addEventListener("message", (event) => {
          const text = String(event.data);
          const hello = /^\{"type":"welcome","socket":"([^"]+)"\}$/.exec(text);
          if (hello) done(hello[1]!);
          else heard.push(text);
        });
      });
      return { socket, heard, id: await id };
    };
    const ana = await open();
    const ben = await open();
    expect(ana.id).not.toBe(ben.id);

    ana.socket.close();

    await expect.poll(() => ben.heard).toEqual([`{"type":"gone","socket":"${ana.id}"}`]);
    ben.socket.close();
  });
});
