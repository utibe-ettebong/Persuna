import { z } from "zod";
import { clockField, sightField, turnModeField } from "@/lib/persuna/fields";
import { audit } from "@/lib/audit";
import { actorOf, getUser } from "@/lib/auth/session";
import { createModelClient, createTranscriber } from "@/lib/models";
import { ModelError } from "@/lib/models/gateway";
import { readAudio } from "@/lib/models/transcribe";
import { chatFromVoiceStream, chatStream } from "@/lib/persuna/service";

const ROUTE = "/api/persuna/chat-stream";

/**
 * A turn, streamed. The message goes up as form audio or text (with the screen
 * mode, read and clock) and Server-Sent Events come back: heard, then each sentence
 * as it's written, then done with the saved result, or error when the turn
 * fails. look-closer ends a turn early: nothing is saved, and the client sends
 * the screenshot it held back, with what was heard and said. Signed-in users only.
 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Nothing was recorded", { status: 400 });
  }
  const audio = readAudio(form.get("audio"));
  const text = form.get("text");
  const typed = typeof text === "string" ? text.trim().slice(0, 4000) : "";
  if (!audio && !typed) return new Response("Nothing was recorded", { status: 400 });
  const clock = clockField.safeParse({
    day: form.get("day"),
    now: form.get("now"),
    offset: Number(form.get("offset")),
  });
  if (!clock.success) return new Response("Bad clock", { status: 400 });
  const image = form.get("screen");
  const scene = form.get("scene");
  let sight: z.output<typeof sightField>;
  try {
    sight = sightField.parse({
      image: typeof image === "string" ? image : null,
      scene: typeof scene === "string" ? JSON.parse(scene) : null,
      circled: form.get("circled") === "1",
    });
  } catch {
    return new Response("That screen read couldn't be used", { status: 400 });
  }
  // Talk mode never carries the screen: a read with it is refused, and each
  // read that does travel is audited with the mode that allowed it.
  const mode = turnModeField.parse(form.get("mode"));
  if (mode === "talk" && sight) {
    return new Response("Talk mode sends no screen", { status: 400 });
  }
  if (sight) {
    try {
      await audit({
        actor: actorOf(user),
        action: "screen.read",
        entityType: "screen_read",
        details: {
          mode,
          app: sight.scene?.app ?? null,
          circled: sight.circled,
          route: ROUTE,
        },
      });
    } catch (error) {
      console.error(error);
      return new Response("That screen read couldn't be logged", { status: 500 });
    }
  }

  const said = form.get("said-first");
  const turn = {
    clock: clock.data,
    actor: actorOf(user),
    mode,
    sight,
    show: form.get("show") === "1",
    pictureHeld: form.get("picture-held") === "1",
    heardLive: form.get("heard-live") === "1",
    saidFirst: typeof said === "string" ? said.slice(0, 4000) : undefined,
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      try {
        const client = createModelClient(user);
        const events = audio
          ? chatFromVoiceStream(client, createTranscriber(user), user.id, { audio, ...turn }, ROUTE)
          : chatStream(client, user.id, { text: typed, ...turn }, ROUTE);
        for await (const turnEvent of events) {
          if (turnEvent.type === "done") send("done", turnEvent.result);
          else if (turnEvent.type === "look-closer") send("look-closer", turnEvent);
          else send(turnEvent.type, { text: turnEvent.text });
        }
      } catch (error) {
        console.error(error);
        send("error", {
          message:
            error instanceof ModelError
              ? "I couldn't reach my model just now. Give me a moment and try again."
              : error instanceof Error
                ? error.message
                : "Something went wrong.",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
