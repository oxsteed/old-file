-- Drop the unused refresh_tokens table from 001
-- authController.js uses the 'sessions' table instead
DROP TABLE IF EXISTS refresh_tokens;
