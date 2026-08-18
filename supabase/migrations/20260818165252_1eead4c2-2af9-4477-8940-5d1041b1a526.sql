GRANT EXECUTE ON FUNCTION public.claim_delivery_job(text, integer) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_packages TO authenticated;
GRANT ALL ON public.delivery_logs TO service_role;
GRANT ALL ON public.delivery_packages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.delivery_logs_id_seq TO authenticated;

CREATE POLICY "delivery_logs admin write" ON public.delivery_logs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "delivery_packages admin write" ON public.delivery_packages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));