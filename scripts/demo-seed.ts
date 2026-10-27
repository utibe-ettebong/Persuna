/**
 * Sets up a ready-to-show demo: the sample meeting-minutes skill with rules,
 * a test run, a published version and a live marketplace listing.
 * Safe to run more than once. Uses whatever models are configured (the mock
 * when no key is set); re-extract from the studio after adding real keys.
 *
 *   npm run demo:seed
 */
import path from "node:path";
import { createModelClient } from "@/lib/models";
import { readiness, saveListing, setListingActive } from "@/lib/market/service";
import { loadSkillFolder } from "@/lib/skill/pairs-fs";
import {
  extractVersion,
  getSkillOverview,
  importPairs,
  publishVersion,
  runEval,
  upsertSkill,
} from "@/lib/skill/service";

async function main() {
  const client = createModelClient();
  const { definition, pairs } = await loadSkillFolder(path.resolve("data/skills/meeting-minutes"));
  const skill = await upsertSkill(definition);
  const { upserted } = await importPairs(skill.id, pairs);
  console.log(`Skill "${skill.name}": ${upserted} sample pairs`);

  let overview = await getSkillOverview(skill.slug);
  if (!overview.skill.currentVersionId) {
    const version = await extractVersion(client, skill.slug);
    console.log(`Extracted v${version.version} (${version.sheet.rules.length} rules)`);
    overview = await getSkillOverview(skill.slug);
  }
  const current = overview.versions.find((v) => v.id === overview.skill.currentVersionId)!;
  if (!current.latestRun || current.latestRun.status !== "complete") {
    const run = await runEval(client, current.id);
    console.log(`Tested v${current.version}: replication score ${run.meanScore}`);
  }
  if (!overview.skill.publishedVersionId) {
    await publishVersion(skill.id, current.id, false);
    console.log(`Published v${current.version}`);
  }

  const sample = pairs.find((p) => p.split === "train")!.output;
  await saveListing(skill.id, {
    title: "Meeting notes into polished minutes",
    description:
      "Send raw meeting notes and get finished minutes in a consistent house format: header block, decisions in bold, and an action table with owners and due dates.",
    priceNgn: 5000,
    turnaroundHours: 24,
    sampleOutput: sample,
    ownerType: "freelancer",
    declareOwnership: true,
    premiumReviewNgn: 1500,
  });
  const ready = await readiness(skill.id);
  if (ready.ready) {
    await setListingActive(skill.id, true);
    console.log("Listing is live in the marketplace");
  } else {
    console.log(
      "Listing saved but not live yet:",
      ready.requirements
        .filter((r) => !r.met)
        .map((r) => r.label)
        .join("; "),
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
