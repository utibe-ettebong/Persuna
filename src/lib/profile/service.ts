/**
 * Public profiles: who someone is (in their own words), the work they show,
 * the skills they rent out, and how clients and sellers rated them on
 * projects. Everything here is chosen by the person or is a public record
 * (listings, ratings); no job or project material is shown.
 */
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { audit, type Actor } from "@/lib/audit";
import { NotFoundError } from "@/lib/skill/service";
import { ensureHandle, getProfile, publicProfile } from "@/lib/persuna/service";
import { confidentialSkills } from "@/lib/teams/confidential";
import { publicSkillName } from "@/lib/teams/rules";
import {
  MAX_PORTFOLIO,
  displayName,
  moveItem,
  ratingSummary,
  type PortfolioInput,
  type ProfileInput,
} from "./rules";

const { persunaProfiles, portfolioItems, skills, projects, projectProposals, authUsers } = schema;

/** Your profile as you edit it, with your portfolio and skills to tag pieces with. */
export async function myProfile(userId: string) {
  const profile = await getProfile(userId);
  const handle = await ensureHandle(userId);
  const user = await db().query.authUsers.findFirst({ where: eq(authUsers.id, userId) });
  return {
    handle,
    accountName: user?.name ?? "",
    publicName: profile.publicName,
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    portfolio: await portfolioOf(userId),
    skills: await db()
      .select({ slug: skills.slug, name: skills.name })
      .from(skills)
      .where(eq(skills.ownerId, userId))
      .orderBy(asc(skills.name)),
  };
}

export async function saveProfile(userId: string, input: ProfileInput, actor: Actor) {
  await getProfile(userId);
  await db()
    .update(persunaProfiles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(persunaProfiles.userId, userId));
  await audit({
    actor,
    action: "profile.updated",
    // Account ids aren't uuids; the actor already says whose profile it is.
    entityType: "profile",
    entityId: null,
    details: {
      fields: Object.entries(input)
        .filter(([, v]) => v)
        .map(([k]) => k),
    },
  });
}

async function portfolioOf(userId: string) {
  return db()
    .select({ item: portfolioItems, skill: { slug: skills.slug, name: skills.name } })
    .from(portfolioItems)
    .leftJoin(skills, eq(portfolioItems.skillId, skills.id))
    .where(eq(portfolioItems.userId, userId))
    .orderBy(asc(portfolioItems.position), asc(portfolioItems.createdAt));
}

async function skillIdFor(userId: string, slug: string) {
  if (!slug) return null;
  const skill = await db().query.skills.findFirst({
    where: and(eq(skills.ownerId, userId), eq(skills.slug, slug)),
  });
  if (!skill) throw new Error("That isn't one of your skills");
  return skill.id;
}

export async function addPortfolioItem(userId: string, input: PortfolioInput, actor: Actor) {
  const existing = await portfolioOf(userId);
  if (existing.length >= MAX_PORTFOLIO) {
    throw new Error(`You can show up to ${MAX_PORTFOLIO} pieces. Remove one first.`);
  }
  const [row] = await db()
    .insert(portfolioItems)
    .values({
      userId,
      title: input.title,
      description: input.description,
      link: input.link,
      imageUrl: input.imageUrl,
      skillId: await skillIdFor(userId, input.skill),
      position: existing.length,
    })
    .returning();
  await audit({
    actor,
    action: "portfolio.added",
    entityType: "portfolio_item",
    entityId: row.id,
    skillId: row.skillId,
  });
  return row;
}

async function ownedItem(userId: string, itemId: string) {
  const item = await db().query.portfolioItems.findFirst({
    where: and(eq(portfolioItems.id, itemId), eq(portfolioItems.userId, userId)),
  });
  if (!item) throw new NotFoundError("No such portfolio piece");
  return item;
}

export async function updatePortfolioItem(
  userId: string,
  itemId: string,
  input: PortfolioInput,
  actor: Actor,
) {
  await ownedItem(userId, itemId);
  const skillId = await skillIdFor(userId, input.skill);
  await db()
    .update(portfolioItems)
    .set({
      title: input.title,
      description: input.description,
      link: input.link,
      imageUrl: input.imageUrl,
      skillId,
    })
    .where(eq(portfolioItems.id, itemId));
  await audit({
    actor,
    action: "portfolio.updated",
    entityType: "portfolio_item",
    entityId: itemId,
    skillId,
  });
}

export async function removePortfolioItem(userId: string, itemId: string, actor: Actor) {
  await ownedItem(userId, itemId);
  await db().delete(portfolioItems).where(eq(portfolioItems.id, itemId));
  await audit({
    actor,
    action: "portfolio.removed",
    entityType: "portfolio_item",
    entityId: itemId,
  });
}

export async function movePortfolioItem(userId: string, itemId: string, direction: "up" | "down") {
  const ids = (await portfolioOf(userId)).map((r) => r.item.id);
  const next = moveItem(ids, itemId, direction);
  await db().transaction(async (tx) => {
    for (const [position, id] of next.entries()) {
      await tx.update(portfolioItems).set({ position }).where(eq(portfolioItems.id, id));
    }
  });
}

/** Public profile addresses for these people (made the first time they're needed). */
export async function handlesFor(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const pairs = await Promise.all(
    unique.map(async (id) => [id, await ensureHandle(id).catch(() => null)] as const),
  );
  return new Map(pairs.filter((p): p is [string, string] => Boolean(p[1])));
}

/**
 * Someone's public profile: their own words, their portfolio, the skills
 * they rent out (with Persuna's verification and renters' reviews), and their
 * record on projects, as a client and as a seller.
 */
export async function personProfile(handle: string) {
  const persuna = await publicProfile(handle);
  const profile = await db().query.persunaProfiles.findFirst({
    where: eq(persunaProfiles.handle, handle),
  });
  if (!profile) throw new NotFoundError("No such profile");
  const user = await db().query.authUsers.findFirst({ where: eq(authUsers.id, profile.userId) });

  const posted = await db()
    .select()
    .from(projects)
    .where(and(eq(projects.posterId, profile.userId), ne(projects.status, "draft")))
    .orderBy(desc(projects.createdAt));
  const won = await db()
    .select({ project: projects })
    .from(projects)
    .innerJoin(projectProposals, eq(projects.chosenProposalId, projectProposals.id))
    .where(and(eq(projectProposals.sellerId, profile.userId), isNotNull(projects.chosenProposalId)))
    .orderBy(desc(projects.createdAt));

  const portfolio = await portfolioOf(profile.userId);
  const confidential = await confidentialSkills(
    portfolio.map((p) => p.item.skillId).filter((id): id is string => Boolean(id)),
  );

  // On a project, the poster rates the seller (posterRating) and the seller rates the poster.
  const asSeller = won.map((w) => w.project);
  const sellerReviews = asSeller
    .filter((p) => p.posterRating)
    .map((p) => ({
      rating: p.posterRating!,
      comment: p.posterReview,
      project: p.title,
      date: p.updatedAt,
    }));
  const clientReviews = posted
    .filter((p) => p.sellerRating)
    .map((p) => ({
      rating: p.sellerRating!,
      comment: p.sellerReview,
      project: p.title,
      date: p.updatedAt,
    }));

  return {
    handle,
    name: displayName(profile.publicName, user?.name ?? ""),
    headline: profile.headline,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    memberSince: user?.createdAt ?? profile.createdAt,
    persuna: persuna,
    portfolio: portfolio.map(({ item, skill }) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      link: item.link,
      imageUrl: item.imageUrl,
      // A piece tagged with company know-how shows, but never names the skill.
      skill: publicSkillName(
        skill?.name ?? null,
        Boolean(item.skillId && confidential.has(item.skillId)),
      ),
    })),
    asClient: {
      posted: posted.length,
      completed: posted.filter((p) => p.status === "completed").length,
      open: posted
        .filter((p) => p.status === "open")
        .slice(0, 6)
        .map((p) => ({ id: p.id, title: p.title, budgetCents: p.budgetCents })),
      rating: ratingSummary(clientReviews.map((r) => r.rating)),
      reviews: clientReviews.slice(0, 8),
    },
    asSeller: {
      won: asSeller.length,
      completed: asSeller.filter((p) => p.status === "completed").length,
      rating: ratingSummary(sellerReviews.map((r) => r.rating)),
      reviews: sellerReviews.slice(0, 8),
    },
  };
}

/** Names and profile links for project pages and lists. */
export async function peopleFor(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map<string, { name: string; handle: string | null }>();
  const handles = await handlesFor(ids);
  const rows = await db()
    .select({ id: authUsers.id, name: authUsers.name, publicName: persunaProfiles.publicName })
    .from(authUsers)
    .leftJoin(persunaProfiles, eq(persunaProfiles.userId, authUsers.id))
    .where(inArray(authUsers.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      { name: displayName(r.publicName, r.name), handle: handles.get(r.id) ?? null },
    ]),
  );
}
