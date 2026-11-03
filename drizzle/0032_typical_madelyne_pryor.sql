ALTER TABLE "mcp_servers" ADD COLUMN "auth_type" text DEFAULT 'token' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "oauth" jsonb;