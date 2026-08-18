CREATE OR REPLACE FUNCTION public.claim_delivery_job(_worker_id text, _lease_seconds integer DEFAULT 3600)
 RETURNS TABLE(job_id uuid, upload_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only delivery workers may claim jobs';
  END IF;

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
$function$;