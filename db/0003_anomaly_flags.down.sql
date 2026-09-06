-- Down migration for 0003_anomaly_flags (Code Style Guide §8: every migration is reversible).
DROP TABLE IF EXISTS "anomaly_flags";
