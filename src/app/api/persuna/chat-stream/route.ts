import { z } from "zod";
import { clockField, sightField } from "@/lib/persuna/fields";
import { actorOf, getUser } from "@/lib/auth/session";
import { createModelClient, createTranscriber } from "@/lib/models";
import { ModelError } from "@/lib/models/gateway";
import { readAudio } from "@/lib/models/transcribe";
import { chatFromVoiceStream } from "@/lib/persuna/service";

/**
 * A spoken turn, streamed: the recording goes up as form audio (with the
 * screen read and clock, like the voice action) and Server-Sent Events come
 * back — heard, then each sentence as it's written, then done with the saved
 * result, or error when the turn fails. Signed-in users only.
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
  if (!audio) return new Response("Nothing was recorded", { status: 400 });
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      try {
        for await (const turnEvent of chatFromVoiceStream(
          createModelClient(user),
          createTranscriber(user),
          user.id,
          { audio, clock: clock.data, actor: actorOf(user), sight },
          "/api/persuna/chat-stream",
        )) {
          if (turnEvent.type === "done") send("done", turnEvent.result);
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
