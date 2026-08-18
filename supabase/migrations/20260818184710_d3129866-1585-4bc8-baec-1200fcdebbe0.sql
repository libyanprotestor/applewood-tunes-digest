ALTER TABLE public.delivery_jobs ADD COLUMN IF NOT EXISTS approved_for_delivery boolean NOT NULL DEFAULT false;
ALTER TABLE public.delivery_packages ADD COLUMN IF NOT EXISTS metadata_xml text;
ALTER TABLE public.delivery_packages ADD COLUMN IF NOT EXISTS manifest jsonb;