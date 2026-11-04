/**
 * Whose voice this is: a small fingerprint (mean MFCCs plus median pitch)
 * read from raw samples. Timbre compares by cosine similarity; pitch must
 * also be close, since means alone blur nearby pitches together. Everything
 * runs on the device — enrollment and checks never upload audio or prints.
 * Casual protection against the wrong person talking to Persuna, not
 * authentication.
 */

const FRAME_MS = 25;
const HOP_MS = 10;
const PRE_EMPHASIS = 0.97;
const MEL_FILTERS = 26;
const MEL_LOW_HZ = 80;
const MEL_HIGH_HZ = 8000;
/** Cepstra kept (c1..c19): the voice's shape, not its loudness. */
const CEPSTRA = 19;
/** A frame counts as voiced above this share of the loudest frame. */
const VOICED_FRACTION = 0.05;
/** At least this many voiced frames, or there wasn't enough voice to keep. */
const MIN_VOICED_FRAMES = 30;
/** The rate recordings are decoded at for a print. */
export const PRINT_RATE = 16_000;

/**
 * Two prints of one voice score at least this. Same voice re-recorded scores
 * ~1.0; the pitch check below carries nearby-but-different voices, so this
 * stays lenient. Casual protection, not authentication: colds and new mics
 * can miss.
 */
export const MATCH_THRESHOLD = 0.86;
/** Two prints' median pitches must be within about two semitones. */
export const PITCH_RATIO_MAX = 1.12;

export interface Voiceprint {
  mean: number[];
  frames: number;
  /** Median pitch in Hz, or null when no frame carried a clear pitch. */
  pitch: number | null;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j &= ~bit;
    j |= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * curR - im[i + k + len / 2] * curI;
        const vi = re[i + k + len / 2] * curI + im[i + k + len / 2] * curR;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nextR = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nextR;
      }
    }
  }
}

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

/** Triangular mel filters as [bin, weight] pairs into the power spectrum. */
function melFilters(count: number, nfft: number, rate: number): [number, number][][] {
  const high = Math.min(MEL_HIGH_HZ, rate / 2);
  const points = Array.from({ length: count + 2 }, (_, i) =>
    Math.floor(
      ((nfft + 1) *
        melToHz(hzToMel(MEL_LOW_HZ) + ((hzToMel(high) - hzToMel(MEL_LOW_HZ)) * i) / (count + 1))) /
        rate,
    ),
  );
  return Array.from({ length: count }, (_, m) => {
    const weights: [number, number][] = [];
    for (let k = points[m]; k < points[m + 1]; k++) {
      weights.push([k, (k - points[m]) / Math.max(1, points[m + 1] - points[m])]);
    }
    for (let k = points[m + 1]; k < points[m + 2]; k++) {
      weights.push([k, (points[m + 2] - k) / Math.max(1, points[m + 2] - points[m + 1])]);
    }
    return weights;
  });
}

/**
 * One frame's pitch by YIN (cumulative-mean-normalized difference): the
 * first dip under the threshold, parabolically refined. Null when nothing
 * is clearly periodic. Pure.
 */
function yinPitch(frame: Float64Array, sampleRate: number): number | null {
  const n = frame.length;
  const minLag = Math.max(1, Math.floor(sampleRate / 500));
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / 50));
  if (maxLag <= minLag) return null;
  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i + tau < n; i++) {
      const d = frame[i] - frame[i + tau];
      s += d * d;
    }
    running += s;
    cmnd[tau] = running === 0 ? 1 : (s * tau) / running;
  }
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau] < 0.15) {
      // Past the threshold: on to the dip's bottom, then refine it.
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++;
      let refined = tau;
      if (tau > 0 && tau < maxLag) {
        const denom = cmnd[tau - 1] - 2 * cmnd[tau] + cmnd[tau + 1];
        if (denom !== 0) {
          refined =
            tau + Math.max(-1, Math.min(1, (0.5 * (cmnd[tau - 1] - cmnd[tau + 1])) / denom));
        }
      }
      return sampleRate / refined;
    }
  }
  return null;
}

/**
 * A voice's fingerprint: mean MFCCs plus median pitch over its voiced
 * frames. Null when there isn't enough voice (too short, too quiet). Pure,
 * so it's tested directly.
 */
export function fingerprint(samples: Float32Array, sampleRate: number): Voiceprint | null {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  const frameLen = Math.round((FRAME_MS / 1000) * sampleRate);
  const hop = Math.max(1, Math.round((HOP_MS / 1000) * sampleRate));
  if (samples.length < frameLen || frameLen < 8) return null;
  const emphasized = new Float64Array(samples.length);
  emphasized[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    emphasized[i] = samples[i] - PRE_EMPHASIS * samples[i - 1];
  }
  const window = Float64Array.from({ length: frameLen }, (_, i) => {
    return 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frameLen - 1));
  });
  let nfft = 1;
  while (nfft < frameLen) nfft <<= 1;
  const filters = melFilters(MEL_FILTERS, nfft, sampleRate);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const raw = new Float64Array(frameLen);
  const cepstraOf = (start: number): number[] => {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameLen; i++) re[i] = emphasized[start + i] * window[i];
    fft(re, im);
    const logMel = filters.map((weights) => {
      let e = 0;
      for (const [k, w] of weights) {
        if (k < 0 || k > nfft / 2) continue;
        e += w * (re[k] * re[k] + im[k] * im[k]);
      }
      return Math.log(Math.max(1e-10, e));
    });
    const cepstra: number[] = [];
    for (let c = 1; c <= CEPSTRA; c++) {
      let s = 0;
      for (let m = 0; m < logMel.length; m++) {
        s += logMel[m] * Math.cos((Math.PI * c * (m + 0.5)) / logMel.length);
      }
      cepstra.push(s);
    }
    return cepstra;
  };
  const starts: number[] = [];
  for (let start = 0; start + frameLen <= samples.length; start += hop) starts.push(start);
  const energies = starts.map((start) => {
    let energy = 0;
    for (let i = 0; i < frameLen; i++) {
      const v = emphasized[start + i] * window[i];
      energy += v * v;
    }
    return energy;
  });
  const loudest = Math.max(0, ...energies);
  const voiced = starts.filter((_, i) => energies[i] > loudest * VOICED_FRACTION);
  if (voiced.length < MIN_VOICED_FRAMES) return null;
  const mean = Array.from({ length: CEPSTRA }, () => 0);
  const pitches: number[] = [];
  voiced.forEach((start, vi) => {
    const cepstra = cepstraOf(start);
    for (let c = 0; c < CEPSTRA; c++) mean[c] += cepstra[c] / voiced.length;
    // Pitch on every third voiced frame: plenty for a median, a third the cost.
    // Unwindowed: tapering the edges would break the period YIN looks for.
    if (vi % 3 === 0) {
      for (let i = 0; i < frameLen; i++) raw[i] = samples[start + i];
      const pitch = yinPitch(raw, sampleRate);
      if (pitch !== null) pitches.push(pitch);
    }
  });
  pitches.sort((a, b) => a - b);
  const pitch = pitches.length >= 5 ? pitches[Math.floor(pitches.length / 2)] : null;
  return { mean, frames: voiced.length, pitch };
}

/** Cosine similarity of two prints' means: 1 is the same voice. */
export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Whether a fresh print is the enrolled voice, with its timbre score. Timbre
 * must clear the threshold, and when both prints carry a pitch those must be
 * close too. Whispers and pitchless prints fall back to timbre alone.
 */
export function matchVoiceprint(
  sample: Voiceprint,
  enrolled: Voiceprint,
  threshold = MATCH_THRESHOLD,
): { match: boolean; score: number } {
  const score = similarity(sample.mean, enrolled.mean);
  if (score < threshold) return { match: false, score };
  if (sample.pitch && enrolled.pitch) {
    const ratio = Math.max(sample.pitch, enrolled.pitch) / Math.min(sample.pitch, enrolled.pitch);
    if (ratio > PITCH_RATIO_MAX) return { match: false, score };
  }
  return { match: true, score };
}

/**
 * A recording's print: decoded and fingerprinted in the browser. Null when
 * it can't be decoded or holds too little voice. Browser-only (needs audio
 * decoding); the pure fingerprinting above is what the suite pins. Decoded
 * at 16 kHz: every band the print uses is under 8 kHz, and the pitch search
 * costs the square of the rate, so a 48 kHz decode only adds delay to a turn.
 */
export async function fingerprintOfAudio(blob: Blob): Promise<Voiceprint | null> {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  let context: AudioContext;
  try {
    context = new AudioCtx({ sampleRate: PRINT_RATE });
  } catch {
    // Older engines decode only at the device's rate: slower, same print.
    context = new AudioCtx();
  }
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (!decoded.length) return null;
    return fingerprint(decoded.getChannelData(0), decoded.sampleRate);
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Who listens in a hands-free conversation. The ElevenLabs agent hears the
 * microphone itself, so no voiceprint check can run: with owner-only voice
 * on, the page listens instead, where every utterance is checked. Pure.
 */
export function handsFreeListener(opts: {
  agentMode: boolean;
  agentReady: boolean;
  setupDone: boolean;
  ownerOnly: boolean;
}): "agent" | "page" {
  return opts.agentMode && opts.agentReady && opts.setupDone && !opts.ownerOnly ? "agent" : "page";
}
