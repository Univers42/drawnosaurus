import type { FastifyInstance } from "fastify";
import type * as WebSocket from "ws";

interface LiveParams {
  slug: string;
}

export function registerLiveRoutes(app: FastifyInstance): void {
  const rooms = new Map<string, Set<WebSocket.WebSocket>>();

  app.get<{ Params: LiveParams }>("/v1/boards/:slug/live", { websocket: true }, (socket, req) => {
    const slug = req.params.slug;
    let room = rooms.get(slug);
    if (!room) {
      room = new Set();
      rooms.set(slug, room);
    }
    room.add(socket);

    socket.on("message", (data: WebSocket.RawData) => {
      const text = data.toString();
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
      const currentRoom = rooms.get(slug);
      if (currentRoom) {
        currentRoom.delete(socket);
        if (currentRoom.size === 0) {
          rooms.delete(slug);
        }
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
