import type { FastifyInstance } from "fastify";
import type * as WebSocket from "ws";

interface LiveParams {
  slug: string;
}

/**
 * What a client sends to learn whether its link still carries anything, and the answer.
 *
 * A link can die without closing — a laptop lid shut, a Wi-Fi network changed, a proxy
 * that dropped it — and a browser's socket then reads as open for as long as TCP takes
 * to give up, which can be many minutes. Everything drawn meanwhile went nowhere, and
 * nothing said so. A client that stops hearing the answer reconnects (`realtimeClient.ts`).
 *
 * Matched as the exact text and never relayed: nothing here reads a frame beyond
 * comparing it with this one.
 */
export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';

/**
 * Who a connection is, as far as this route knows: an id of its own, for this socket
 * only. Told to the socket when it opens, and to everyone else in the room when it
 * closes, so they forget what it held at once.
 *
 * Without it a person who reloaded, or whose laptop went to sleep, went on holding what
 * they had selected on every other screen until their silence timed out — nobody could
 * touch those shapes for most of a minute. The route still reads nothing: it names its
 * own sockets, and clients say which socket is theirs inside their sealed frames.
 */
const welcome = (id: string): string => `{"type":"welcome","socket":"${id}"}`;
const gone = (id: string): string => `{"type":"gone","socket":"${id}"}`;

/**
 * How often each socket is pinged at the protocol level, which browsers answer on their
 * own. One that has not answered by the next ping is dead, and is dropped: until it was,
 * every frame for it was written into a socket nobody was reading.
 */
const HEARTBEAT_MS = 25_000;

/**
 * Blind fan-out for live collaboration. Frames may be AES-GCM sealed client-side;
 * this route must not parse, log, or decrypt payloads — that is what keeps live
 * transit end-to-end encrypted when peers share a fragment room key.
 */
export function registerLiveRoutes(app: FastifyInstance): void {
  const rooms = new Map<string, Set<WebSocket.WebSocket>>();
  /** Names each socket for `welcome` / `gone`: unique for as long as the process runs. */
  let sockets = 0;

  app.get<{ Params: LiveParams }>("/v1/boards/:slug/live", { websocket: true }, (socket, req) => {
    const slug = req.params.slug;
    let room = rooms.get(slug);
    if (!room) {
      room = new Set();
      rooms.set(slug, room);
    }
    room.add(socket);
    sockets += 1;
    const id = String(sockets);
    socket.send(welcome(id));

    let answered = true;
    socket.on("pong", () => {
      answered = true;
    });
    const heartbeat = setInterval(() => {
      if (!answered) {
        socket.terminate();
        return;
      }
      answered = false;
      socket.ping();
    }, HEARTBEAT_MS);

    socket.on("message", (data: WebSocket.RawData) => {
      const text = data.toString();
      if (text === PING) {
        socket.send(PONG);
        return;
      }
      const currentRoom = rooms.get(slug);
      if (currentRoom) {
        for (const peer of currentRoom) {
          if (peer !== socket && peer.readyState === peer.OPEN) {
            peer.send(text);
          }
        }
      }
    });

    const cleanup = () => {
      clearInterval(heartbeat);
      const currentRoom = rooms.get(slug);
      if (currentRoom?.delete(socket)) {
        if (currentRoom.size === 0) {
          rooms.delete(slug);
        }
        for (const peer of currentRoom) {
          if (peer.readyState === peer.OPEN) peer.send(gone(id));
        }
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
