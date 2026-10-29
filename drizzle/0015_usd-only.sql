ALTER TABLE "listings" DROP CONSTRAINT "price_positive";--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "price_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "platform_fee_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "owner_share_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "employer_share_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "employer_share_cents" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" DROP COLUMN "price_ngn";--> statement-breakpoint
ALTER TABLE "listings" DROP COLUMN "premium_review_ngn";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "amount_ngn";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "platform_fee_ngn";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "owner_share_ngn";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "employer_share_ngn";--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "price_cents_positive" CHECK ("listings"."price_cents" > 0);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "premium_review_cents_not_negative" CHECK ("listings"."premium_review_cents" is null or "listings"."premium_review_cents" >= 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "amount_cents_positive" CHECK ("transactions"."amount_cents" > 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "currency_known" CHECK ("transactions"."currency" in ('USD', 'NGN'));