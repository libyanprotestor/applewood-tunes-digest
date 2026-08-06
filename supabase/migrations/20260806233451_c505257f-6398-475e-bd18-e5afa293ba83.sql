CREATE TYPE public.app_role AS ENUM ('admin', 'sublabel');
CREATE TYPE public.item_type AS ENUM ('ringtone', 'single', 'album', 'other');
CREATE TYPE public.run_status AS ENUM ('pending', 'success', 'not_ready', 'failed');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- sublabels
CREATE TABLE public.sublabels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  contact_email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sublabels TO authenticated;
GRANT ALL ON public.sublabels TO service_role;
ALTER TABLE public.sublabels ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_sublabels_updated BEFORE UPDATE ON public.sublabels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  sublabel_id uuid REFERENCES public.sublabels(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- user roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_sublabel_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sublabel_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles self or admin" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "profiles admin write" ON public.profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "sublabels read" ON public.sublabels FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR id = public.current_sublabel_id());
CREATE POLICY "sublabels admin write" ON public.sublabels FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- items
CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sublabel_id uuid NOT NULL REFERENCES public.sublabels(id) ON DELETE CASCADE,
  title text NOT NULL,
  artist_name text,
  isrc text,
  upc text,
  item_type public.item_type NOT NULL DEFAULT 'single',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX items_isrc_key ON public.items (upper(isrc)) WHERE isrc IS NOT NULL;
CREATE UNIQUE INDEX items_upc_key ON public.items (upper(upc)) WHERE upc IS NOT NULL;
CREATE INDEX items_sublabel_idx ON public.items (sublabel_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO authenticated;
GRANT ALL ON public.items TO service_role;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "items read" ON public.items FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR sublabel_id = public.current_sublabel_id());
CREATE POLICY "items admin write" ON public.items FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- sales
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  sublabel_id uuid NOT NULL REFERENCES public.sublabels(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  region text NOT NULL,
  country_code text,
  units integer NOT NULL DEFAULT 0,
  original_currency text,
  revenue_usd numeric(14,4) NOT NULL DEFAULT 0,
  product_type_id text,
  report_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_date_idx ON public.sales (sale_date);
CREATE INDEX sales_sublabel_date_idx ON public.sales (sublabel_id, sale_date);
CREATE INDEX sales_item_idx ON public.sales (item_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales read" ON public.sales FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') OR sublabel_id = public.current_sublabel_id());
CREATE POLICY "sales admin write" ON public.sales FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- report runs
CREATE TABLE public.report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region text NOT NULL,
  report_date date NOT NULL,
  status public.run_status NOT NULL DEFAULT 'pending',
  rows_parsed integer NOT NULL DEFAULT 0,
  rows_matched integer NOT NULL DEFAULT 0,
  rows_unmatched integer NOT NULL DEFAULT 0,
  revenue_usd numeric(14,4) NOT NULL DEFAULT 0,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (region, report_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_runs TO authenticated;
GRANT ALL ON public.report_runs TO service_role;
ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs admin" ON public.report_runs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- unmatched sales
CREATE TABLE public.unmatched_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_run_id uuid REFERENCES public.report_runs(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  region text NOT NULL,
  country_code text,
  title text,
  artist_name text,
  isrc text,
  upc text,
  units integer NOT NULL DEFAULT 0,
  original_currency text,
  revenue_usd numeric(14,4) NOT NULL DEFAULT 0,
  product_type_id text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unmatched_open_idx ON public.unmatched_sales (resolved, sale_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unmatched_sales TO authenticated;
GRANT ALL ON public.unmatched_sales TO service_role;
ALTER TABLE public.unmatched_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "unmatched admin" ON public.unmatched_sales FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));