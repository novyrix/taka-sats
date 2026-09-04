-- Down migration for 0001_collectors (Code Style Guide §8: every migration is reversible).
DROP TABLE IF EXISTS "tag_history";
DROP TABLE IF EXISTS "collectors";
