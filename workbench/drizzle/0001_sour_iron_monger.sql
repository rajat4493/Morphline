CREATE TABLE "exception_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"text_hash" text NOT NULL,
	"text_redacted" text NOT NULL,
	"label" text NOT NULL,
	"confidence" integer NOT NULL,
	"method" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD COLUMN "provenance" text DEFAULT 'deterministic' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_evidence" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "exception_classifications" ADD CONSTRAINT "exception_classifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exc_cls_key" ON "exception_classifications" USING btree ("tenant_id","text_hash","method","model","prompt_version");