
-- report runs: distinguish sales vs streams
ALTER TABLE public.report_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sales';
ALTER TABLE public.report_runs DROP CONSTRAINT IF EXISTS report_runs_report_date_key;
ALTER TABLE public.report_runs ADD CONSTRAINT report_runs_date_kind_key UNIQUE (report_date, kind);

-- settings
CREATE TABLE public.app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  stream_rate_per_1000 numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings readable" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings admin write" ON public.app_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE TRIGGER trg_app_settings_updated BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.app_settings (id, stream_rate_per_1000) VALUES (true, 1);

-- streams
CREATE TABLE public.streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  sublabel_id uuid NOT NULL REFERENCES public.sublabels(id) ON DELETE CASCADE,
  stream_date date NOT NULL,
  ingest_date date,
  apple_identifier text,
  storefront_name text,
  time_bucket text,
  subscription_type text,
  subscription_mode text,
  channel_partner text,
  device_type text,
  source_of_stream text,
  container_type text,
  container_sub_type text,
  container_id text,
  container_name text,
  end_reason_type text,
  offline text,
  audio_format text,
  streams integer NOT NULL DEFAULT 0,
  report_run_id uuid REFERENCES public.report_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_streams_date ON public.streams (stream_date);
CREATE INDEX idx_streams_sublabel ON public.streams (sublabel_id);
CREATE INDEX idx_streams_run ON public.streams (report_run_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.streams TO authenticated;
GRANT ALL ON public.streams TO service_role;
ALTER TABLE public.streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "streams read" ON public.streams FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR sublabel_id = current_sublabel_id());
CREATE POLICY "streams admin write" ON public.streams FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.unmatched_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_run_id uuid REFERENCES public.report_runs(id) ON DELETE SET NULL,
  stream_date date NOT NULL,
  ingest_date date,
  apple_identifier text,
  storefront_name text,
  time_bucket text,
  subscription_type text,
  subscription_mode text,
  channel_partner text,
  device_type text,
  source_of_stream text,
  container_type text,
  container_sub_type text,
  container_id text,
  container_name text,
  end_reason_type text,
  offline text,
  audio_format text,
  streams integer NOT NULL DEFAULT 0,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unmatched_streams TO authenticated;
GRANT ALL ON public.unmatched_streams TO service_role;
ALTER TABLE public.unmatched_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "unmatched streams admin" ON public.unmatched_streams FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.streams_summary(_from date, _to date, _bucket text, _sublabel uuid DEFAULT NULL)
RETURNS TABLE(bucket date, streams bigint, revenue_usd numeric)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT date_trunc(
           CASE WHEN _bucket IN ('day','week','month','year') THEN _bucket ELSE 'day' END,
           s.stream_date
         )::date AS bucket,
         SUM(s.streams)::bigint AS streams,
         ROUND(SUM(s.streams) * (SELECT stream_rate_per_1000 FROM public.app_settings LIMIT 1) / 1000.0, 2) AS revenue_usd
  FROM public.streams s
  WHERE s.stream_date BETWEEN _from AND _to
    AND (_sublabel IS NULL OR s.sublabel_id = _sublabel)
  GROUP BY 1 ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.streams_summary(date,date,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.streams_summary(date,date,text,uuid) TO authenticated, service_role;
