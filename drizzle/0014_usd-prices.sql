-- Custom SQL migration file, put your code below! --
-- The marketplace moves from naira to US dollars, held as integer cents.
--
-- Listing prices are converted at 1,500 naira = 1 US dollar, rounded up to a
-- whole dollar, with a minimum of 1 dollar. Owners can change them afterwards.
UPDATE "listings"
SET "price_cents" = GREATEST(1, CEIL("price_ngn" / 1500.0))::integer * 100
WHERE "price_cents" IS NULL;--> statement-breakpoint
UPDATE "listings"
SET "premium_review_cents" = CASE
  WHEN "premium_review_ngn" <= 0 THEN 0
  ELSE GREATEST(1, CEIL("premium_review_ngn" / 1500.0))::integer * 100
END
WHERE "premium_review_ngn" IS NOT NULL AND "premium_review_cents" IS NULL;--> statement-breakpoint
-- Past payments keep their history honestly: they were made in naira, so they
-- stay naira, with amounts in kobo (the naira's minor unit).
UPDATE "transactions"
SET
  "currency" = 'NGN',
  "amount_cents" = "amount_ngn" * 100,
  "platform_fee_cents" = "platform_fee_ngn" * 100,
  "owner_share_cents" = "owner_share_ngn" * 100,
  "employer_share_cents" = "employer_share_ngn" * 100
WHERE "amount_cents" IS NULL;
