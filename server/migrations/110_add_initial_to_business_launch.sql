-- Add support for 'initial' package in Business Launch Program
-- Allows $100 initial consultation option alongside Foundation/Launch/Accelerator

ALTER TABLE consulting_requests
  DROP CONSTRAINT IF EXISTS consulting_requests_package_selected_check,
  ADD CONSTRAINT consulting_requests_package_selected_check
    CHECK (package_selected IN ('initial', 'foundation', 'launch', 'accelerator'));

-- Update the column comment for clarity
COMMENT ON COLUMN consulting_requests.package_selected IS 'Package tier: initial ($100/2hr), foundation ($750), launch ($1500), accelerator ($3000)';
