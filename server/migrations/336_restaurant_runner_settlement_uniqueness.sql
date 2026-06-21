-- Migration 336: One canonical settlement per runner task.

DELETE FROM restaurant_runner_settlements older
 USING restaurant_runner_settlements newer
 WHERE older.restaurant_id = newer.restaurant_id
   AND older.task_id = newer.task_id
   AND older.task_id IS NOT NULL
   AND older.id < newer.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_runner_settlements_task_unique
  ON restaurant_runner_settlements (restaurant_id, task_id)
  WHERE task_id IS NOT NULL;
