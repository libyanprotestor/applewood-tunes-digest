CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE has_admin boolean;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, sublabel_id)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'full_name',''),
    NULLIF(NEW.raw_user_meta_data->>'sublabel_id','')::uuid
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO has_admin;
  IF NOT has_admin THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  ELSIF (NEW.raw_user_meta_data->>'sublabel_id') IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'sublabel') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.sales_summary(_from date, _to date, _bucket text, _sublabel uuid DEFAULT NULL)
RETURNS TABLE (bucket date, units bigint, revenue_usd numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT date_trunc(
           CASE WHEN _bucket IN ('day','week','month','year') THEN _bucket ELSE 'day' END,
           s.sale_date
         )::date AS bucket,
         SUM(s.units)::bigint AS units,
         SUM(s.revenue_usd) AS revenue_usd
  FROM public.sales s
  WHERE s.sale_date BETWEEN _from AND _to
    AND (_sublabel IS NULL OR s.sublabel_id = _sublabel)
  GROUP BY 1 ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.sales_summary(date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_summary(date, date, text, uuid) TO authenticated, service_role;