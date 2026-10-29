-- Rename the assistant's tables, indexes and constraints from persona_* to
-- persuna_* (data kept), and the project-update author value with them.
ALTER TABLE "persona_profiles" RENAME TO "persuna_profiles";--> statement-breakpoint
ALTER TABLE "persona_messages" RENAME TO "persuna_messages";--> statement-breakpoint
ALTER TABLE "persona_notes" RENAME TO "persuna_notes";--> statement-breakpoint
ALTER TABLE "persona_reminders" RENAME TO "persuna_reminders";--> statement-breakpoint
ALTER INDEX "persona_messages_user_id_created_at_index" RENAME TO "persuna_messages_user_id_created_at_index";--> statement-breakpoint
ALTER INDEX "persona_notes_user_id_created_at_index" RENAME TO "persuna_notes_user_id_created_at_index";--> statement-breakpoint
ALTER INDEX "persona_reminders_user_id_done_at_index" RENAME TO "persuna_reminders_user_id_done_at_index";--> statement-breakpoint
ALTER TABLE "persuna_profiles" RENAME CONSTRAINT "persona_profiles_user_id_auth_user_id_fk" TO "persuna_profiles_user_id_auth_user_id_fk";--> statement-breakpoint
ALTER TABLE "persuna_profiles" RENAME CONSTRAINT "persona_profiles_focus_skill_id_skills_id_fk" TO "persuna_profiles_focus_skill_id_skills_id_fk";--> statement-breakpoint
ALTER TABLE "persuna_profiles" RENAME CONSTRAINT "persona_profiles_handle_unique" TO "persuna_profiles_handle_unique";--> statement-breakpoint
ALTER TABLE "persuna_messages" RENAME CONSTRAINT "persona_messages_user_id_auth_user_id_fk" TO "persuna_messages_user_id_auth_user_id_fk";--> statement-breakpoint
ALTER TABLE "persuna_messages" RENAME CONSTRAINT "persona_messages_skill_id_skills_id_fk" TO "persuna_messages_skill_id_skills_id_fk";--> statement-breakpoint
ALTER TABLE "persuna_messages" RENAME CONSTRAINT "persona_messages_job_id_jobs_id_fk" TO "persuna_messages_job_id_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "persuna_notes" RENAME CONSTRAINT "persona_notes_user_id_auth_user_id_fk" TO "persuna_notes_user_id_auth_user_id_fk";--> statement-breakpoint
ALTER TABLE "persuna_notes" RENAME CONSTRAINT "persona_notes_skill_id_skills_id_fk" TO "persuna_notes_skill_id_skills_id_fk";--> statement-breakpoint
ALTER TABLE "persuna_reminders" RENAME CONSTRAINT "persona_reminders_user_id_auth_user_id_fk" TO "persuna_reminders_user_id_auth_user_id_fk";--> statement-breakpoint
ALTER TYPE "public"."project_update_author" RENAME VALUE 'persona' TO 'persuna';
