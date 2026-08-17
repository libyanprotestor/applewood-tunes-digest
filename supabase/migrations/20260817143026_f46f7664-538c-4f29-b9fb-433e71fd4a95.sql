ALTER TABLE public.items ADD COLUMN IF NOT EXISTS apple_id text;
CREATE INDEX IF NOT EXISTS items_apple_id_idx ON public.items (apple_id);