-- Group 4 Slice D (item 175): manual travel blocks on the availability
-- calendar. availability_blocks.type gains 'travel', a block kind the helper
-- sets explicitly for travel time. The availability engine already treats
-- every non-'available' type as blocked (computeDay, getHourSlots, the
-- available-slots endpoint), so a travel block subtracts from free time
-- exactly like a time-off block; the distinct type exists so the calendar
-- can label it as travel instead of time off. Applied migrations are
-- immutable, so migration 112's CHECK is extended here, never edited.
ALTER TABLE availability_blocks DROP CONSTRAINT IF EXISTS availability_blocks_type_check;
ALTER TABLE availability_blocks ADD CONSTRAINT availability_blocks_type_check CHECK (type IN ('available', 'unavailable', 'busy', 'travel'));
