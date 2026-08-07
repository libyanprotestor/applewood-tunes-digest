ALTER TABLE public.report_runs DROP CONSTRAINT IF EXISTS report_runs_region_report_date_key;
ALTER TABLE public.report_runs DROP COLUMN IF EXISTS region;
DELETE FROM public.report_runs a USING public.report_runs b WHERE a.ctid < b.ctid AND a.report_date = b.report_date;
ALTER TABLE public.report_runs ADD CONSTRAINT report_runs_report_date_key UNIQUE (report_date);
ALTER TABLE public.sales DROP COLUMN IF EXISTS region;
ALTER TABLE public.unmatched_sales DROP COLUMN IF EXISTS region;