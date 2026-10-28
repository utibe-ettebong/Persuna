"use client";

/**
 * Permission-gated screen watching for Persona. The user shares ONE window;
 * a frame is looked at every so often, and only sent when the window has
 * visibly changed since the last frame that was sent.
 */
export const WATCH_EVERY_MS = 30_000;
export const MAX_LOOKS = 40;
const MAX_WIDTH = 1280;
/** Mean per-pixel change (0–255) on a tiny greyscale thumbnail that counts as "changed". */
const CHANGE_THRESHOLD = 6;

export interface Watcher {
  stop(): void;
}

/** What Persona Desktop offers: the screen or app chosen there, with no click needed. */
type DesktopPicker = { personaDesktop?: { pickScreen?: () => Promise<string | null> } };

/**
 * The stream to watch. In Persona Desktop the app picks the screen or window
 * (asking once, then remembering), so watching can start when you just say
 * "watch my screen". In a browser it's the browser's own picker, which only
 * opens from a click or key press.
 */
async function screenStream(): Promise<MediaStream> {
  const pick = (window as Window & DesktopPicker).personaDesktop?.pickScreen;
  if (pick) {
    const source = await pick();
    if (!source) throw new DOMException("Sharing was cancelled.", "NotAllowedError");
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // Chromium's desktop capture, which Electron answers with the chosen source.
        mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: source, maxFrameRate: 2 },
      } as MediaTrackConstraints,
    });
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      "This browser can't share a window. Try Chrome, Edge or Firefox on a computer.",
    );
  }
  return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
}

/** True where watching can start without a click (Persona Desktop). */
export const watchesWithoutClick = () =>
  typeof window !== "undefined" &&
  Boolean((window as Window & DesktopPicker).personaDesktop?.pickScreen);

export async function startWatching(handlers: {
  onFrame: (dataUrl: string) => Promise<void> | void;
  onEnded: () => void;
}): Promise<Watcher> {
  const stream = await screenStream();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();

  let last: Uint8ClampedArray | null = null;
  let stopped = false;
  let busy = false;

  const look = async () => {
    if (stopped || busy || !video.videoWidth) return;
    busy = true;
    try {
      const thumb = signature(video);
      if (last && difference(last, thumb) < CHANGE_THRESHOLD) return;
      last = thumb;
      await handlers.onFrame(frameOf(video));
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void look(), WATCH_EVERY_MS);
  const first = setTimeout(() => void look(), 1500);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(first);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    handlers.onEnded();
  };
  stream.getVideoTracks()[0]?.addEventListener("ended", stop);
  return { stop };
}

function frameOf(video: HTMLVideoElement): string {
  const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** A 32×18 greyscale thumbnail, enough to tell whether the window changed. */
function signature(video: HTMLVideoElement): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, 32, 18);
  const { data } = ctx.getImageData(0, 0, 32, 18);
  const grey = new Uint8ClampedArray(32 * 18);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = (data[i * 4] * 3 + data[i * 4 + 1] * 6 + data[i * 4 + 2]) / 10;
  }
  return grey;
}

export function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
