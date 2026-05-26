-- ═══════════════════════════════════════════════════════════
-- DataLake FaceID — Supabase Table Setup
-- ═══════════════════════════════════════════════════════════
-- Run this SQL in your Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════

-- Attendance records synced from mobile devices
CREATE TABLE IF NOT EXISTS attendance_records (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  upload_token  TEXT UNIQUE NOT NULL,       -- Idempotent key (prevents duplicates)
  local_id      TEXT NOT NULL,              -- Original device-side record ID
  person_id     TEXT NOT NULL,              -- Enrolled person identifier
  person_name   TEXT NOT NULL,              -- Full name
  timestamp     TIMESTAMPTZ NOT NULL,       -- When authentication occurred
  formatted_time TEXT,                      -- Human-readable 12hr local time (e.g. 03:47:54 PM)
  similarity    REAL NOT NULL,              -- Cosine similarity score (0-1)
  device_id     TEXT NOT NULL,              -- Source device identifier
  embedding_hash TEXT NOT NULL,             -- SHA-256 of face embedding (no raw data)
  synced_at     TIMESTAMPTZ DEFAULT NOW()   -- When this record was synced
);

-- Index for fast queries by device and date
CREATE INDEX IF NOT EXISTS idx_attendance_device ON attendance_records(device_id);
CREATE INDEX IF NOT EXISTS idx_attendance_timestamp ON attendance_records(timestamp);

-- Enable Row Level Security (best practice)
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts and reads (for hackathon demo)
-- In production, replace with proper auth policies
CREATE POLICY "Allow all operations" ON attendance_records
  FOR ALL USING (true) WITH CHECK (true);
