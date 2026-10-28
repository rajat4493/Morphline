CREATE TABLE "package_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	"version" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"is_deployed" boolean DEFAULT true NOT NULL,
	"source_status" text NOT NULL,
	"coverage" double precision DEFAULT 0 NOT NULL,
	"xaml_total" integer DEFAULT 0 NOT NULL,
	"xaml_parsed" integer DEFAULT 0 NOT NULL,
	"package_sha256" text,
	"package_bytes" integer,
	"identity_matches" boolean,
	"failure" text,
	"failure_detail" text,
	"graph" jsonb,
	"isolation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"encrypted" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	"from_analysis_id" uuid NOT NULL,
	"to_analysis_id" uuid NOT NULL,
	"from_version" text NOT NULL,
	"to_version" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "package_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "package_analysis_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "package_permission_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connectors" ADD COLUMN "package_retain_raw" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dependencies" ADD COLUMN "basis" text DEFAULT 'confirmed_orchestrator' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_analyses" ADD CONSTRAINT "package_analyses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_analyses" ADD CONSTRAINT "package_analyses_process_id_automation_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."automation_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_blobs" ADD CONSTRAINT "package_blobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_blobs" ADD CONSTRAINT "package_blobs_analysis_id_package_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."package_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_diffs" ADD CONSTRAINT "package_diffs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_diffs" ADD CONSTRAINT "package_diffs_process_id_automation_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."automation_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_diffs" ADD CONSTRAINT "package_diffs_from_analysis_id_package_analyses_id_fk" FOREIGN KEY ("from_analysis_id") REFERENCES "public"."package_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_diffs" ADD CONSTRAINT "package_diffs_to_analysis_id_package_analyses_id_fk" FOREIGN KEY ("to_analysis_id") REFERENCES "public"."package_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pkg_an_key" ON "package_analyses" USING btree ("process_id","version","analyzer_version");--> statement-breakpoint
CREATE UNIQUE INDEX "pkg_blob_an" ON "package_blobs" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pkg_diff_key" ON "package_diffs" USING btree ("from_analysis_id","to_analysis_id");