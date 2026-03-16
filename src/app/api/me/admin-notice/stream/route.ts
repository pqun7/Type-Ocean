export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { getAdminNotice } from "@/features/admin/server/admin-notices";

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastNoticeId: string | null = null;
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let poller: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (closed) {
          return;
        }

        closed = true;

        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        if (poller) {
          clearInterval(poller);
          poller = null;
        }
      };

      const enqueue = (payload: string) => {
        if (closed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      const pushCurrent = async () => {
        if (closed) {
          return;
        }

        const notice = await getAdminNotice(userId);
        const nextId = notice?.id ?? null;
        if (nextId !== lastNoticeId) {
          lastNoticeId = nextId;
          enqueue(encodeEvent("notice", { notice }));
        }
      };

      enqueue(encodeEvent("ready", { ok: true }));
      void pushCurrent();

      heartbeat = setInterval(() => {
        enqueue(`: heartbeat ${Date.now()}\n\n`);
      }, 15_000);

      poller = setInterval(() => {
        void pushCurrent();
      }, 5_000);

      return cleanup;
    },
    cancel() {
      // start() owns the interval cleanup via its returned disposer.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
