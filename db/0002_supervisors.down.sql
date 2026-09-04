-- Down migration for 0002_supervisors (Code Style Guide §8: every migration is reversible).
DROP TABLE IF EXISTS "supervisors";
