-- enums
CREATE TYPE public.upload_kind AS ENUM ('album', 'singles', 'ringtones');
CREATE TYPE public.upload_status AS ENUM ('draft', 'uploaded', 'in_review', 'ready', 'packaging', 'delivering', 'delivered', 'rejected', 'cancelled');
CREATE TYPE public.delivery_state AS ENUM ('queued', 'claimed', 'packaging', 'uploading', 'succeeded', 'failed');
CREATE TYPE public.upload_file_role AS ENUM ('audio', 'artwork', 'document', 'other');

-- uploads
CREATE TABLE public.uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublabel_id uuid NOT NULL REFERENCES public.sublabels(id) ON DELETE RESTRICT,
  created_by uuid,
  kind public.upload_kind NOT NULL,
  title text NOT NULL,
  artist_name text,
  upc text,
  release_date date,
  status public.upload_status NOT NULL DEFAULT 'draft',
  storage_prefix text NOT NULL,
  total_bytes bigint NOT NULL DEFAULT 0,
  file_count integer NOT NULL DEFAULT 0,
  admin_notes text,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_uploads_sublabel ON public.uploads(sublabel_id);
CREATE INDEX idx_uploads_status ON public.uploads(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploads TO authenticated;
GRANT ALL ON public.uploads TO service_role;
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uploads read" ON public.uploads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR sublabel_id = public.current_sublabel_id());
CREATE POLICY "uploads insert own" ON public.uploads FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR sublabel_id = public.current_sublabel_id());
CREATE POLICY "uploads update" ON public.uploads FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR (sublabel_id = public.current_sublabel_id() AND status = 'draft'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR sublabel_id = public.current_sublabel_id());
CREATE POLICY "uploads delete admin" ON public.uploads FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_uploads_updated BEFORE UPDATE ON public.uploads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- upload files
CREATE TABLE public.upload_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  role public.upload_file_role NOT NULL DEFAULT 'other',
  filename text NOT NULL,
  storage_key text NOT NULL,
  content_type text,
  bytes bigint NOT NULL DEFAULT 0,
  duration_seconds numeric,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_upload_files_upload ON public.upload_files(upload_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upload_files TO authenticated;
GRANT ALL ON public.upload_files TO service_role;
ALTER TABLE public.upload_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upload_files read" ON public.upload_files FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.uploads u WHERE u.id = upload_id
    AND (public.has_role(auth.uid(), 'admin') OR u.sublabel_id = public.current_sublabel_id())));
CREATE POLICY "upload_files write" ON public.upload_files FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.uploads u WHERE u.id = upload_id
    AND (public.has_role(auth.uid(), 'admin') OR u.sublabel_id = public.current_sublabel_id())));
CREATE POLICY "upload_files update" ON public.upload_files FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.uploads u WHERE u.id = upload_id
    AND (public.has_role(auth.uid(), 'admin') OR u.sublabel_id = public.current_sublabel_id())))
  WITH CHECK (true);
CREATE POLICY "upload_files delete" ON public.upload_files FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.uploads u WHERE u.id = upload_id
    AND (public.has_role(auth.uid(), 'admin') OR (u.sublabel_id = public.current_sublabel_id() AND u.status = 'draft'))));

-- isrc pool
CREATE TABLE public.isrc_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  used_by_track_id uuid,
  assigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_isrc_pool_free ON public.isrc_pool(code) WHERE used_by_track_id IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.isrc_pool TO authenticated;
GRANT ALL ON public.isrc_pool TO service_role;
ALTER TABLE public.isrc_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "isrc_pool admin" ON public.isrc_pool FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- upload tracks (metadata sheet)
CREATE TABLE public.upload_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  file_id uuid REFERENCES public.upload_files(id) ON DELETE SET NULL,
  track_number integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  version text,
  artist_name text,
  isrc text,
  explicit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_upload_tracks_upload ON public.upload_tracks(upload_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upload_tracks TO authenticated;
GRANT ALL ON public.upload_tracks TO service_role;
ALTER TABLE public.upload_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upload_tracks read" ON public.upload_tracks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.uploads u WHERE u.id = upload_id
    AND (public.has_role(auth.uid(), 'admin') OR u.sublabel_id = public.current_sublabel_id())));
CREATE POLICY "upload_tracks admin write" ON public.upload_tracks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_upload_tracks_updated BEFORE UPDATE ON public.upload_tracks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.isrc_pool
  ADD CONSTRAINT isrc_pool_track_fk FOREIGN KEY (used_by_track_id)
  REFERENCES public.upload_tracks(id) ON DELETE SET NULL;

-- delivery jobs
CREATE TABLE public.delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.uploads(id) ON DELETE CASCADE,
  state public.delivery_state NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  lease_until timestamptz,
  worker_id text,
  apple_ticket text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX idx_delivery_jobs_state ON public.delivery_jobs(state);
CREATE INDEX idx_delivery_jobs_upload ON public.delivery_jobs(upload_id);

GRANT SELECT, INSERT, UPDATE ON public.delivery_jobs TO authenticated;
GRANT ALL ON public.delivery_jobs TO service_role;
ALTER TABLE public.delivery_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_jobs read" ON public.delivery_jobs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.uploads u WHERE u.id = upload_id
    AND (public.has_role(auth.uid(), 'admin') OR u.sublabel_id = public.current_sublabel_id())));
CREATE POLICY "delivery_jobs admin write" ON public.delivery_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_delivery_jobs_updated BEFORE UPDATE ON public.delivery_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- delivery logs
CREATE TABLE public.delivery_logs (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.delivery_jobs(id) ON DELETE CASCADE,
  line text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_logs_job ON public.delivery_logs(job_id, id);

GRANT SELECT ON public.delivery_logs TO authenticated;
GRANT ALL ON public.delivery_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.delivery_logs_id_seq TO service_role;
ALTER TABLE public.delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "delivery_logs read" ON public.delivery_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.delivery_jobs j JOIN public.uploads u ON u.id = j.upload_id
    WHERE j.id = job_id AND (public.has_role(auth.uid(), 'admin') OR u.sublabel_id = public.current_sublabel_id())));

-- worker job claim (service_role only)
CREATE OR REPLACE FUNCTION public.claim_delivery_job(_worker_id text, _lease_seconds integer DEFAULT 3600)
RETURNS TABLE(job_id uuid, upload_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH next_job AS (
    SELECT j.id FROM public.delivery_jobs j
    WHERE j.state = 'queued'
       OR (j.state IN ('claimed','packaging','uploading') AND j.lease_until < now())
    ORDER BY j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.delivery_jobs j
  SET state = 'claimed',
      attempts = j.attempts + 1,
      claimed_at = now(),
      lease_until = now() + make_interval(secs => _lease_seconds),
      worker_id = _worker_id
  FROM next_job
  WHERE j.id = next_job.id
  RETURNING j.id, j.upload_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_delivery_job(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_delivery_job(text, integer) TO service_role;