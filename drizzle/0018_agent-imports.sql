CREATE TYPE "public"."agent_import_status" AS ENUM('received', 'training', 'testing', 'verified', 'failed');--> statement-breakpoint
CREATE TABLE "agent_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"agent_key_id" uuid,
	"agent_name" text NOT NULL,
	"status" "agent_import_status" DEFAULT 'received' NOT NULL,
	"skill_id" uuid,
	"payload" jsonb,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_keys_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "agent_imports" ADD CONSTRAINT "agent_imports_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_imports" ADD CONSTRAINT "agent_imports_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_imports" ADD CONSTRAINT "agent_imports_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_imports_user_id_created_at_index" ON "agent_imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_imports_agent_key_id_created_at_index" ON "agent_imports" USING btree ("agent_key_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_keys_user_id_index" ON "agent_keys" USING btree ("user_id");