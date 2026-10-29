-- Custom SQL migration file, put your code below! --
-- Ratings move onto the payment record, which outlives the job's retention
-- period, so a listing keeps its reviews. Copy the ratings already given.
UPDATE "transactions" AS t
SET "rating" = j."rating", "rating_comment" = j."rating_comment"
FROM "jobs" AS j
WHERE t."job_id" = j."id" AND j."rating" IS NOT NULL AND t."rating" IS NULL;
