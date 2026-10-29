CREATE TYPE "public"."onboarding_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."org_member_status" AS ENUM('active', 'left');--> statement-breakpoint
CREATE TYPE "public"."org_skill_origin" AS ENUM('member', 'playbook');--> statement-breakpoint
CREATE TYPE "public"."playbook_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "onboardings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"playbook_id" uuid,
	"plan" jsonb NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "onboarding_status" DEFAULT 'active' NOT NULL,
	"started_by" text,
	"starter_skills_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_handbook_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid,
	"admin" boolean DEFAULT false NOT NULL,
	"onboard" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_id" uuid,
	"admin" boolean DEFAULT false NOT NULL,
	"status" "org_member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "org_members_org_id_user_id_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "org_role_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"member_id" uuid,
	"origin" "org_skill_origin" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_role_skills_skill_id_unique" UNIQUE("skill_id")
);
--> statement-breakpoint
CREATE TABLE "org_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_roles_org_id_title_unique" UNIQUE("org_id","title")
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"status" "playbook_status" DEFAULT 'draft' NOT NULL,
	"source_skill_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"model" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "role_playbooks_role_id_version_unique" UNIQUE("role_id","version")
);
--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_member_id_org_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_playbook_id_role_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."role_playbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_started_by_auth_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_handbook_notes" ADD CONSTRAINT "org_handbook_notes_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_handbook_notes" ADD CONSTRAINT "org_handbook_notes_updated_by_auth_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_invited_by_auth_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_accepted_by_auth_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_skills" ADD CONSTRAINT "org_role_skills_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_skills" ADD CONSTRAINT "org_role_skills_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_skills" ADD CONSTRAINT "org_role_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_role_skills" ADD CONSTRAINT "org_role_skills_member_id_org_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."org_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_roles" ADD CONSTRAINT "org_roles_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_playbooks" ADD CONSTRAINT "role_playbooks_role_id_org_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."org_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_playbooks" ADD CONSTRAINT "role_playbooks_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboardings_member_id_index" ON "onboardings" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "onboardings_org_id_status_index" ON "onboardings" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "org_handbook_notes_org_id_position_index" ON "org_handbook_notes" USING btree ("org_id","position");--> statement-breakpoint
CREATE INDEX "org_invites_org_id_index" ON "org_invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_invites_email_index" ON "org_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "org_members_user_id_index" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_members_role_id_index" ON "org_members" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "org_role_skills_role_id_index" ON "org_role_skills" USING btree ("role_id");