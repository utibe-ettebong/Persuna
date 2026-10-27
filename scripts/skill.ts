/**
 * Terminal driver for the training loop. Same functions the web app calls.
 *
 *   npm run skill -- import  [--dir data/skills/meeting-minutes] [--owner you@example.com]
 *   npm run skill -- extract [--skill meeting-minutes]
 *   npm run skill -- test    [--skill meeting-minutes] [--version 2]
 *   npm run skill -- correct --result <test-result-id> --file edited.md --reason "..." [--yes]
 *   npm run skill -- publish [--version 2] [--yes to accept a lower score]
 *   npm run skill -- report  [--skill meeting-minutes]
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { userIdByEmail } from "@/lib/auth/users";
import { createModelClient } from "@/lib/models";
import { loadSkillFolder } from "@/lib/skill/pairs-fs";
import { renderSheet } from "@/lib/skill/sheet";
import {
  acceptCorrection,
  proposeCorrectionFromTest,
  publishVersion,
  extractVersion,
  getRun,
  getSkillOverview,
  importPairs,
  runEval,
  upsertSkill,
} from "@/lib/skill/service";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string" },
    skill: { type: "string", default: "meeting-minutes" },
    version: { type: "string" },
    result: { type: "string" },
    file: { type: "string" },
    reason: { type: "string", default: "" },
    owner: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

const client = createModelClient();

async function currentVersionId(slug: string, versionNumber?: string) {
  const { skill, versions } = await getSkillOverview(slug);
  const version = versionNumber
    ? versions.find((v) => v.version === Number(versionNumber))
    : versions.find((v) => v.id === skill.currentVersionId);
  if (!version)
    throw new Error(
      `No ${versionNumber ? `v${versionNumber}` : "current version"}; run extract first`,
    );
  return version;
}

async function printRun(runId: string) {
  const { run, version, results } = await getRun(runId);
  console.log(`\nv${version.version}: replication score ${run.meanScore ?? "n/a"} (${run.status})`);
  for (const { result, example } of results) {
    console.log(
      `  ${example.slug.padEnd(28)} ${String(result.score).padStart(5)}   result ${result.id}`,
    );
  }
}

const commands: Record<string, () => Promise<void>> = {
  async import() {
    const dir = path.resolve(values.dir ?? path.join("data/skills", values.skill!));
    const { definition, pairs } = await loadSkillFolder(dir);
    const ownerId = values.owner ? await userIdByEmail(values.owner) : undefined;
    const skill = await upsertSkill(definition, ownerId);
    const { upserted, removed } = await importPairs(skill.id, pairs);
    const train = pairs.filter((p) => p.split === "train").length;
    console.log(
      `Imported ${upserted} pairs into "${skill.slug}" (${train} train, ${upserted - train} test)`,
    );
    if (removed.length) console.log(`Removed pairs no longer on disk: ${removed.join(", ")}`);
  },

  async extract() {
    const version = await extractVersion(client, values.skill!);
    console.log(`Created v${version.version} with ${version.sheet.rules.length} rules\n`);
    console.log(renderSheet(version.sheet));
  },

  async test() {
    const version = await currentVersionId(values.skill!, values.version);
    console.log(`Running held-back tests on v${version.version}...`);
    const run = await runEval(client, version.id);
    await printRun(run.id);
  },

  async correct() {
    if (!values.result || !values.file) throw new Error("correct needs --result and --file");
    const edited = await readFile(values.file, "utf8");
    const proposal = await proposeCorrectionFromTest(client, values.result, edited, values.reason!);
    console.log(`Proposed: ${proposal.explanation}`);
    for (const op of proposal.ruleOps) console.log(`  ${JSON.stringify(op)}`);
    if (!values.yes) {
      console.log(`\nReview it in the app, or re-run with --yes to accept from here.`);
      return;
    }
    const version = await acceptCorrection(proposal.id);
    console.log(`Accepted as v${version.version}. Re-running tests...`);
    const run = await runEval(client, version.id);
    await printRun(run.id);
  },

  async publish() {
    const version = await currentVersionId(values.skill!, values.version);
    await publishVersion(version.skillId, version.id, Boolean(values.yes));
    console.log(`Published v${version.version}`);
  },

  async report() {
    const { skill, versions, counts } = await getSkillOverview(values.skill!);
    console.log(`${skill.name}: ${counts.train} train / ${counts.test} test pairs`);
    for (const v of [...versions].reverse()) {
      const marker =
        (v.id === skill.currentVersionId ? "*" : " ") +
        (v.id === skill.publishedVersionId ? "P" : " ");
      console.log(
        `${marker} v${v.version} ${v.source.padEnd(10)} score ${v.latestRun?.meanScore ?? "-"}`,
      );
    }
  },
};

const command = commands[positionals[0] ?? ""];
if (!command) {
  console.error(`Usage: npm run skill -- <${Object.keys(commands).join("|")}> [options]`);
  process.exit(1);
}

command()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
