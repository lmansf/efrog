-- Run this in the Supabase SQL editor (project: dhnzjpgrcuwbptzjlkec).
-- You only need to run it once. Re-running is safe (CREATE OR REPLACE).
--
-- This function lets the browser fetch leaderboard data directly from
-- Supabase without going through the Flask server on Render. It uses
-- SECURITY DEFINER so it runs with elevated privileges and can read
-- the observations table (which has no anon SELECT policy), while only
-- returning aggregated scores — no raw observation data is exposed.

CREATE OR REPLACE FUNCTION get_leaderboard()
RETURNS TABLE (
  username        text,
  unique_species  bigint,
  total_obs       bigint,
  gem_score       bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = "Version_1", public
AS $$
  SELECT
    (
      SELECT o2.username
      FROM   observations o2
      WHERE  o2.user_id = o.user_id
        AND  o2.username IS NOT NULL
        AND  o2.username != ''
      ORDER  BY o2.created_at DESC
      LIMIT  1
    )                          AS username,
    COUNT(DISTINCT o.species)  AS unique_species,
    COUNT(*)                   AS total_obs,
    COUNT(DISTINCT o.species) * COUNT(*) * 10  AS gem_score
  FROM  observations o
  WHERE o.user_id IS NOT NULL
    AND o.user_id != ''
  GROUP BY o.user_id
  HAVING COUNT(DISTINCT o.species) * COUNT(*) * 10 > 0
  ORDER BY gem_score DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION get_leaderboard() TO anon, authenticated;
