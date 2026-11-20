-- Group 9 Slice E (item 482, verification finding D-81):
-- releasing an assigned internal job back to the marketplace was
-- impossible end to end. releaseMarketplace (localDeliveryDispatchService)
-- updates an 'assigned' job to 'posted' with the assignment cleared,
-- but the state-integrity trigger (migration 594) allowed no
-- assigned -> posted transition, so every release of an assigned job
-- died at the trigger with 'Invalid delivery status transition:
-- assigned -> posted'. Releasing an unassigned posted job worked
-- (posted -> posted is no transition), which is why the path looked
-- fine in code review and in the mocked unit tests. The service already
-- guards the release (ops-only, explicit reason, no pickup, no helper,
-- no open recovery), and the trigger's other checks still hold in the
-- same UPDATE (marketplace_posted retains no assignment). This replaces
-- the guard function with the single added transition; migration 594
-- itself is untouched.
BEGIN;

CREATE OR REPLACE FUNCTION enforce_local_delivery_state_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_status TEXT := OLD.status::text;
  new_status TEXT := NEW.status::text;
BEGIN
  IF NEW.helper_user_id IS NOT NULL AND NEW.internal_driver_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Delivery cannot have both marketplace and internal owners'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.internal_driver_user_id IS NOT NULL AND NEW.fulfillment_source <> 'internal' THEN
    RAISE EXCEPTION 'Internal driver requires internal fulfillment source'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.helper_user_id IS NOT NULL AND NEW.fulfillment_source <> 'marketplace' THEN
    RAISE EXCEPTION 'Marketplace helper requires marketplace fulfillment source'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status::text IN ('delivered', 'returned', 'cancelled')
     AND old_status NOT IN ('delivered', 'returned', 'cancelled') THEN
    IF NEW.status::text = 'delivered'
       AND (NEW.delivered_at IS NULL OR NEW.proof_verified_at IS NULL) THEN
      RAISE EXCEPTION 'Delivery completion requires verified proof and completion time'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status::text = 'returned'
       AND (NEW.returned_at IS NULL OR NEW.proof_verified_at IS NULL) THEN
      RAISE EXCEPTION 'Return completion requires verified proof and return time'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF old_status IS DISTINCT FROM new_status THEN
    IF old_status IN ('delivered', 'returned', 'cancelled') THEN
      RAISE EXCEPTION 'Terminal delivery status cannot be changed'
        USING ERRCODE = '23514';
    END IF;

    IF NOT (
      (old_status = 'posted' AND new_status IN ('assigned', 'cancelled'))
      OR (old_status = 'assigned' AND new_status IN ('picked_up', 'cancelled', 'failed', 'posted'))
      OR (old_status = 'picked_up' AND new_status IN ('in_transit', 'failed'))
      OR (old_status = 'in_transit' AND new_status IN ('delivered', 'failed'))
      OR (old_status = 'failed' AND new_status IN ('assigned', 'picked_up', 'in_transit', 'returned'))
    ) THEN
      RAISE EXCEPTION 'Invalid delivery status transition: % -> %', old_status, new_status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status::text = 'assigned'
     AND NEW.helper_user_id IS NULL
     AND NEW.internal_driver_user_id IS NULL THEN
    RAISE EXCEPTION 'Assigned delivery requires an owner'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.dispatch_state = 'marketplace_posted'
     AND (NEW.fulfillment_source <> 'marketplace'
       OR NEW.helper_user_id IS NOT NULL
       OR NEW.internal_driver_user_id IS NOT NULL
       OR NEW.vehicle_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Marketplace-posted delivery cannot retain an assignment'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.dispatch_state = 'internal_assigned'
     AND (NEW.fulfillment_source <> 'internal'
       OR NEW.internal_driver_user_id IS NULL
       OR NEW.vehicle_id IS NULL
       OR NEW.helper_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Internal-assigned delivery requires an internal driver and vehicle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status::text = 'failed' AND NEW.dispatch_state <> 'exception' THEN
    RAISE EXCEPTION 'Failed delivery must remain in exception dispatch state'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status::text = 'returned' AND NEW.dispatch_state <> 'returned' THEN
    RAISE EXCEPTION 'Returned delivery must remain in returned dispatch state'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status::text = 'delivered' AND NEW.dispatch_state <> 'completed' THEN
    RAISE EXCEPTION 'Delivered delivery must remain in completed dispatch state'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
