-- Allow the admin Business Launch pipeline to archive completed requests.
-- The client has exposed this state since the admin workflow was added, but
-- the original status constraint did not include it.

ALTER TABLE consulting_requests
  DROP CONSTRAINT IF EXISTS consulting_requests_status_check;

ALTER TABLE consulting_requests
  ADD CONSTRAINT consulting_requests_status_check
  CHECK (status IN (
    'pending',
    'contacted',
    'kickoff_scheduled',
    'in_progress',
    'completed',
    'cancelled',
    'archived'
  ));
