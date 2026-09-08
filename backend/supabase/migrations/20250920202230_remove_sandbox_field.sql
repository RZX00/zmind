-- Migration: Remove sandbox field from projects table
-- This migration removes the Daytona sandbox-related field as part of the transition to cloud-only architecture

BEGIN;

-- Remove sandbox field from projects table
ALTER TABLE projects DROP COLUMN IF EXISTS sandbox;

COMMIT;