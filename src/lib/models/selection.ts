import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  modelConfig,
  roleKey,
  rolePicker,
  setting,
  speechConfig,
  transcriptionConfig,
  type ModelRoleConfig,
  type SpeechConfig,
} from "@/env";
import { audit, type Actor } from "@/lib/audit";
import { createGateway, type ModelClient } from "./gateway";
import { createSpeaker, type Speaker } from "./speech";
import { createTranscriber, type Transcriber } from "./transcribe";

const { platformModels } = schema;

/** Model roles an admin can point at a cataloged model. */
export const catalogRoles = [
  "extract",
  "draft",
  "evaluate",
  "listen",
  "transcribe",
  "speech",
] as const;

export type CatalogRole = (typeof catalogRoles)[number];

export interface CatalogEntry {
  id: string;
  role: string;
  label: string;
  model: string;
  /** Provider preset id, or null for the role's env routing. */
  provider: string | null;
  /** Explicit base URL, winning over the preset's. */
  baseUrl: string | null;
  /** Voice id (speech role only). */
  voice: string | null;
  /** Reasoning level (chat roles only). */
  reasoningEffort: string | null;
  enabled: boolean;
  selected: boolean;
  updatedAt: Date;
}

/** One provider an admin can point a role at: a Railway key slot plus its URL. Never a key. */
export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string | null;
  keySlot: string;
  api?: "elevenlabs" | "openai";
}

const CHAT_SLOTS = ["EXTRACT", "DRAFT", "EVAL", "LISTEN", "TRANSCRIBE"] as const;

/**
 * The providers a role can use: the key slots set in Railway, plus the voice
 * API shapes for speech. Names and URLs only — keys are never listed.
 */
export function providerPresets(role: CatalogRole): ProviderPreset[] {
  if (role === "speech") {
    if (!setting("SPEECH_API_KEY")) return [];
    const custom = setting("SPEECH_BASE_URL");
    const presets: ProviderPreset[] = [
      {
        id: "elevenlabs",
        label: "ElevenLabs",
        baseUrl: "https://api.elevenlabs.io/v1",
        keySlot: "SPEECH",
        api: "elevenlabs",
      },
    ];
    if (custom) {
      let label = "Custom voice server";
      try {
        label = new URL(custom).host;
      } catch {
        label = custom;
      }
      presets.push({ id: "custom", label, baseUrl: custom, keySlot: "SPEECH", api: "openai" });
    }
    return presets;
  }
  return CHAT_SLOTS.filter((slot) => roleKey(slot)).map((slot) => ({
    id: slot.toLowerCase(),
    label: `${slot} key`,
    baseUrl: setting(`${slot}_BASE_URL`) ?? null,
    keySlot: slot,
  }));
}

export interface ProviderSelection {
  model: string;
  provider: string | null;
  baseUrl: string | null;
  reasoningEffort: string | null;
}

/**
 * Applies a catalog selection's provider routing onto a chat/transcribe
 * config: the model's id, the slot's key and URL, and the entry's explicit
 * URL when it has one. A borrowed reasoning setting is cleared — a setting
 * meant for one provider is never sent to another — unless the entry sets
 * one. An unknown provider keeps env routing (and warns) rather than
 * misrouting a turn.
 */
export function applyProvider(
  config: ModelRoleConfig,
  selection: ProviderSelection | null,
  presets: ProviderPreset[],
): ModelRoleConfig {
  if (!selection) return config;
  const withModel = { ...config, model: selection.model };
  if (!selection.provider) return withModel;
  const preset = presets.find((entry) => entry.id === selection.provider);
  if (!preset) {
    console.warn(`[models] unknown provider "${selection.provider}"; keeping env routing.`);
    return withModel;
  }
  const pick = rolePicker(preset.keySlot);
  const effort = ["none", "minimal", "low", "medium", "high", "max"] as const;
  const reasoningEffort = effort.includes(
    (selection.reasoningEffort ?? "") as (typeof effort)[number],
  )
    ? (selection.reasoningEffort as ModelRoleConfig["reasoningEffort"])
    : undefined;
  return {
    ...withModel,
    baseUrl: selection.baseUrl ?? pick("BASE_URL") ?? preset.baseUrl ?? config.baseUrl,
    apiKey: pick("API_KEY") ?? config.apiKey,
    reasoningEffort,
  };
}

export interface SpeechSelection extends ProviderSelection {
  voice: string | null;
}

/**
 * Applies a catalog selection's provider routing onto a speech config: the
 * voice API shape (ElevenLabs or OpenAI-compatible), its URL, and the voice.
 * Switching the voice between ElevenLabs and Qwen is one selection.
 */
export function applySpeechProvider(
  config: SpeechConfig,
  selection: SpeechSelection | null,
  presets: ProviderPreset[],
): SpeechConfig {
  if (!selection) return config;
  const withModel = {
    ...config,
    model: selection.model,
    voice: selection.voice ?? config.voice,
  };
  if (!selection.provider) return withModel;
  const preset = presets.find((entry) => entry.id === selection.provider);
  if (!preset) {
    console.warn(`[models] unknown provider "${selection.provider}"; keeping env routing.`);
    return withModel;
  }
  return {
    ...withModel,
    api: preset.api ?? "openai",
    baseUrl: selection.baseUrl ?? preset.baseUrl ?? config.baseUrl,
  };
}

/** Every cataloged model, optionally for one role, newest first. Admins only. */
export async function listCatalog(role?: CatalogRole): Promise<CatalogEntry[]> {
  const rows = await db()
    .select({
      id: platformModels.id,
      role: platformModels.role,
      label: platformModels.label,
      model: platformModels.model,
      provider: platformModels.provider,
      baseUrl: platformModels.baseUrl,
      voice: platformModels.voice,
      reasoningEffort: platformModels.reasoningEffort,
      enabled: platformModels.enabled,
      selected: platformModels.selected,
      updatedAt: platformModels.updatedAt,
    })
    .from(platformModels)
    .where(role ? eq(platformModels.role, role) : undefined)
    .orderBy(desc(platformModels.createdAt));
  return rows;
}

/** One catalog entry by id, or null. */
export async function getCatalogEntry(entryId: string): Promise<CatalogEntry | null> {
  const [row] = await db()
    .select({
      id: platformModels.id,
      role: platformModels.role,
      label: platformModels.label,
      model: platformModels.model,
      provider: platformModels.provider,
      baseUrl: platformModels.baseUrl,
      voice: platformModels.voice,
      reasoningEffort: platformModels.reasoningEffort,
      enabled: platformModels.enabled,
      selected: platformModels.selected,
      updatedAt: platformModels.updatedAt,
    })
    .from(platformModels)
    .where(eq(platformModels.id, entryId));
  return row ?? null;
}

/** The entry a role currently uses, if it has an enabled selection. */
export async function getSelection(role: CatalogRole): Promise<CatalogEntry | null> {
  const [row] = await db()
    .select({
      id: platformModels.id,
      role: platformModels.role,
      label: platformModels.label,
      model: platformModels.model,
      provider: platformModels.provider,
      baseUrl: platformModels.baseUrl,
      voice: platformModels.voice,
      reasoningEffort: platformModels.reasoningEffort,
      enabled: platformModels.enabled,
      selected: platformModels.selected,
      updatedAt: platformModels.updatedAt,
    })
    .from(platformModels)
    .where(
      and(
        eq(platformModels.role, role),
        eq(platformModels.selected, true),
        eq(platformModels.enabled, true),
      ),
    );
  return row ?? null;
}

/** Catalogs a model id for a role. Keys stay env vars; selecting probes that the id works there. */
export async function addCatalogEntry(
  input: {
    role: CatalogRole;
    label: string;
    model: string;
    provider?: string | null;
    baseUrl?: string | null;
    voice?: string | null;
    reasoningEffort?: string | null;
  },
  actor: Actor,
): Promise<CatalogEntry> {
  const presets = providerPresets(input.role);
  if (input.provider && !presets.some((preset) => preset.id === input.provider)) {
    throw new Error("That provider isn't one of this role's key slots.");
  }
  const [row] = await db()
    .insert(platformModels)
    .values({
      role: input.role,
      label: input.label,
      model: input.model,
      provider: input.provider ?? null,
      baseUrl: input.baseUrl ?? null,
      voice: input.voice ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
    })
    .returning({
      id: platformModels.id,
      role: platformModels.role,
      label: platformModels.label,
      model: platformModels.model,
      provider: platformModels.provider,
      baseUrl: platformModels.baseUrl,
      voice: platformModels.voice,
      reasoningEffort: platformModels.reasoningEffort,
      enabled: platformModels.enabled,
      selected: platformModels.selected,
      updatedAt: platformModels.updatedAt,
    });
  if (!row) throw new Error("Could not save that model.");
  await audit({
    actor,
    action: "model.added",
    entityType: "platform_model",
    entityId: row.id,
    details: { role: row.role, label: row.label, model: row.model },
  });
  return row;
}

/**
 * Enables or disables an entry. Disabling the selected entry falls back to
 * env until it is enabled again; nothing else changes.
 */
export async function setCatalogEnabled(entryId: string, enabled: boolean, actor: Actor) {
  const [row] = await db()
    .update(platformModels)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(platformModels.id, entryId))
    .returning({ id: platformModels.id, role: platformModels.role, model: platformModels.model });
  if (!row) throw new Error("No such catalog entry.");
  await audit({
    actor,
    action: enabled ? "model.enabled" : "model.disabled",
    entityType: "platform_model",
    entityId: row.id,
    details: { role: row.role, model: row.model },
  });
}

/** Deletes an entry. Deleting the selected one reverts its role to env. */
export async function deleteCatalogEntry(entryId: string, actor: Actor) {
  const [row] = await db().delete(platformModels).where(eq(platformModels.id, entryId)).returning({
    id: platformModels.id,
    role: platformModels.role,
    label: platformModels.label,
    model: platformModels.model,
    selected: platformModels.selected,
  });
  if (!row) throw new Error("No such catalog entry.");
  await audit({
    actor,
    action: "model.deleted",
    entityType: "platform_model",
    entityId: row.id,
    details: { role: row.role, label: row.label, model: row.model, wasSelected: row.selected },
  });
}

/** Points a role at a catalog entry. At most one selection per role. */
export async function selectModel(role: CatalogRole, entryId: string, actor: Actor) {
  const entry = await getCatalogEntry(entryId);
  if (!entry || entry.role !== role) throw new Error("No such catalog entry for that role.");
  if (!entry.enabled) throw new Error("That entry is disabled.");
  await db().transaction(async (tx) => {
    await tx.update(platformModels).set({ selected: false }).where(eq(platformModels.role, role));
    await tx.update(platformModels).set({ selected: true }).where(eq(platformModels.id, entryId));
  });
  await audit({
    actor,
    action: "model.selected",
    entityType: "platform_model",
    entityId: entryId,
    details: { role, model: entry.model, label: entry.label },
  });
}

/** Drops a role's selection; env settings serve it again. */
export async function revertRole(role: CatalogRole, actor: Actor) {
  await db().update(platformModels).set({ selected: false }).where(eq(platformModels.role, role));
  await audit({ actor, action: "model.reverted", entityType: "platform_model", details: { role } });
}

/**
 * Applies a catalog selection onto an env config: the model id only, never
 * the base URL or key, so provider/key routing keeps its existing rules. Pure.
 */
export function applySelection<T extends { model: string }>(
  config: T,
  selection: { model: string } | null,
): T {
  return selection ? { ...config, model: selection.model } : config;
}

/** An env chat/transcribe config with its role's catalog selection applied, if any. */
export async function withModelOverride(
  role: CatalogRole,
  config: ModelRoleConfig,
): Promise<ModelRoleConfig> {
  return applyProvider(config, await getSelection(role), providerPresets(role));
}

/** An env speech config with the voice role's catalog selection applied, if any. */
export async function withSpeechOverride(config: SpeechConfig): Promise<SpeechConfig> {
  return applySpeechProvider(config, await getSelection("speech"), providerPresets("speech"));
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

const PROBE_TIMEOUT_MS = 30_000;

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} timed out after 30 s`)),
      PROBE_TIMEOUT_MS,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Half a second of silent 16 kHz mono 16-bit WAV, for transcription probes. */
export function silenceWav(seconds = 0.5): Uint8Array<ArrayBuffer> {
  const rate = 16000;
  const samples = Math.floor(rate * seconds);
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples * 2));
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return bytes;
}

/**
 * Checks a model id against its role's live settings with the smallest call
 * that proves it: a short completion, a silent clip transcribed, a word
 * spoken. Dependencies inject fakes in tests; live calls use the env config
 * with the candidate model swapped in. Never throws: failures come back as
 * `{ ok: false }`.
 */
export async function probeModel(input: {
  role: CatalogRole;
  model: string;
  deps?: { client?: ModelClient; transcriber?: Transcriber; speaker?: Speaker | null };
}): Promise<ProbeResult> {
  const { role, model } = input;
  try {
    if (role === "transcribe") {
      const transcriber =
        input.deps?.transcriber ?? createTranscriber(() => ({ ...transcriptionConfig(), model }));
      await withTimeout(
        transcriber.transcribe(new Blob([silenceWav()], { type: "audio/wav" }), "probe.wav"),
        "Transcription",
      );
      return { ok: true, detail: `${model} transcribed the probe clip.` };
    }
    if (role === "speech") {
      const speaker =
        input.deps && "speaker" in input.deps
          ? input.deps.speaker
          : createSpeaker(() => {
              const current = speechConfig();
              return current && { ...current, model };
            });
      if (!speaker) return { ok: false, detail: "No speech key is configured for a probe." };
      const { audio } = await withTimeout(speaker.synthesize("ok"), "Speech");
      const reader = audio.getReader();
      try {
        const first = await reader.read();
        if (first.done || !first.value?.length)
          return { ok: false, detail: `${model} returned no audio.` };
        return { ok: true, detail: `${model} spoke ${first.value.length} bytes.` };
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    const client = input.deps?.client ?? createGateway(() => ({ ...modelConfig(role), model }));
    const completion = await client.complete(
      role,
      [{ role: "user", content: "Reply with the word ok." }],
      { maxTokens: 50, timeoutMs: 20_000 },
    );
    if (!completion.text.trim()) return { ok: false, detail: `${model} answered empty.` };
    return { ok: true, detail: `${model} answered: ${completion.text.trim().slice(0, 120)}` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 300) : "Probe failed.",
    };
  }
}
