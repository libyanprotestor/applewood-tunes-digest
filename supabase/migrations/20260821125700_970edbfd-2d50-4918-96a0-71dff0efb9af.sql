ALTER TYPE public.item_type ADD VALUE IF NOT EXISTS 'album_song';
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS catalog_synced_at timestamptz;