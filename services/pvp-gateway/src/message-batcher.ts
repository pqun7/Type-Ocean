import { toJson, type ServerMessage } from "./protocol";

type BatchableServerMessage = {
  type: "PROGRESS";
  payload: {
    matchId: string;
    userId: string;
  } & Record<string, unknown>;
} | {
  type: "ROOM_STATE";
  payload: {
    room: {
      code: string;
    } & Record<string, unknown>;
  } & Record<string, unknown>;
};

function batchKeyOf(message: BatchableServerMessage) {
  switch (message.type) {
    case "PROGRESS":
      return `PROGRESS:${message.payload.matchId}:${message.payload.userId}`;
    case "ROOM_STATE":
      return `ROOM_STATE:${message.payload.room.code}`;
  }
}

export function isBatchableServerMessage(type: ServerMessage["type"]) {
  return type === "PROGRESS" || type === "ROOM_STATE";
}

export function createMessageBatcher<TSocket extends { send(data: string): unknown }>(params: {
  tickMs: number;
  isOpen: (socket: TSocket) => boolean;
  onFlush?: (info: { socket: TSocket; messages: BatchableServerMessage[] }) => void;
}) {
  const pending = new Map<TSocket, Map<string, BatchableServerMessage>>();

  function flushSocket(socket: TSocket) {
    const queue = pending.get(socket);
    if (!queue) return;

    pending.delete(socket);
    if (!params.isOpen(socket)) return;

    const messages = Array.from(queue.values());
    params.onFlush?.({ socket, messages });

    for (const message of messages) {
      try {
        socket.send(toJson(message));
      } catch {
        // ignore
      }
    }
  }

  const timer = setInterval(() => {
    for (const socket of Array.from(pending.keys())) {
      flushSocket(socket);
    }
  }, Math.max(1, params.tickMs));

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    enqueue(socket: TSocket, message: BatchableServerMessage) {
      const key = batchKeyOf(message);
      const queue = pending.get(socket) ?? new Map<string, BatchableServerMessage>();
      queue.set(key, message);
      pending.set(socket, queue);
    },
    flushAll() {
      for (const socket of Array.from(pending.keys())) {
        flushSocket(socket);
      }
    },
    drop(socket: TSocket) {
      pending.delete(socket);
    },
    stop() {
      clearInterval(timer);
      pending.clear();
    },
  };
}