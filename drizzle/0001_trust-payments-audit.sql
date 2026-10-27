CREATE TYPE "public"."approved_by" AS ENUM('owner', 'auto');--> statement-breakpoint
CREATE TYPE "public"."employer_decision" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('mock', 'paystack');--> statement-breakpoint
CREATE TYPE "public"."proposal_source" AS ENUM('test', 'job', 'interview', 'walkthrough');--> statement-breakpoint
ALTER TYPE "public"."escrow_status" ADD VALUE 'pending' BEFORE 'held';--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'awaiting_payment' BEFORE 'review';--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"skill_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corrections" ADD COLUMN "source" "proposal_source" DEFAULT 'test' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "approved_by" "approved_by";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "trust_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "flags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "owner_review_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "complaint" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "complained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "premium_review_ngn" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "employer_name" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "employer_email" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "employer_share_percent" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "employer_token" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "employer_decision" "employer_decision";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "employer_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "trust_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "interview" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "renter_email" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "employer_share_ngn" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "premium_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "provider" "payment_provider" DEFAULT 'mock' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "provider_reference" text;--> statement-breakpoint
CREATE INDEX "audit_events_at_index" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_skill_id_index" ON "audit_events" USING btree ("skill_id");--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_employer_token_unique" UNIQUE("employer_token");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_provider_reference_unique" UNIQUE("provider_reference");