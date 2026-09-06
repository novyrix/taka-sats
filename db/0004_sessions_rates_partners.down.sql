-- Down migration for 0004_sessions_rates_partners (Code Style Guide §8: every migration is reversible).
DROP TABLE IF EXISTS "session_supervisors";
DROP TABLE IF EXISTS "supervisor_rotations";
DROP TABLE IF EXISTS "material_rates";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "partners";
