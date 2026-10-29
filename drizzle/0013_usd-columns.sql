ALTER TABLE "listings" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "premium_review_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "platform_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "owner_share_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "employer_share_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;