ALTER TABLE public.uploads
  ADD COLUMN IF NOT EXISTS genre_code text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS label_name text,
  ADD COLUMN IF NOT EXISTS copyright_pline text,
  ADD COLUMN IF NOT EXISTS copyright_cline text,
  ADD COLUMN IF NOT EXISTS extract_error text;

ALTER TABLE public.upload_tracks
  ADD COLUMN IF NOT EXISTS folder_number integer,
  ADD COLUMN IF NOT EXISTS artwork_file_id uuid REFERENCES public.upload_files(id) ON DELETE SET NULL;

ALTER TABLE public.sublabels
  ADD COLUMN IF NOT EXISTS default_genre_code text,
  ADD COLUMN IF NOT EXISTS default_language text,
  ADD COLUMN IF NOT EXISTS default_label_name text,
  ADD COLUMN IF NOT EXISTS default_copyright_owner text;

CREATE TABLE IF NOT EXISTS public.delivery_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE CASCADE,
  upload_id uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  vendor_id text NOT NULL,
  title text,
  state public.delivery_state NOT NULL DEFAULT 'queued',
  apple_ticket text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.delivery_packages TO authenticated;
GRANT ALL ON public.delivery_packages TO service_role;

ALTER TABLE public.delivery_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read delivery packages"
ON public.delivery_packages FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_delivery_packages_updated
BEFORE UPDATE ON public.delivery_packages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_delivery_packages_job ON public.delivery_packages(job_id);