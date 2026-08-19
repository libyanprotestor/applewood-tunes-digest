ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS revenue_original numeric NOT NULL DEFAULT 0;
ALTER TABLE public.unmatched_sales ADD COLUMN IF NOT EXISTS revenue_original numeric NOT NULL DEFAULT 0;