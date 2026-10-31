CREATE TABLE "voice_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"route" text NOT NULL,
	"spoken" boolean DEFAULT false NOT NULL,
	"heard_ms" real,
	"first_token_ms" real,
	"first_sentence_ms" real,
	"first_audio_ms" real,
	"turn_ms" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_turns_user_id_created_at_index" ON "voice_turns" USING btree ("user_id","created_at");