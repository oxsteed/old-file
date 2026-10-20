-- Grants are catalogued in adminPermissionController; no existing grant is broadened.
CREATE INDEX IF NOT EXISTS growth_demand_day_node ON demand_daily(day,node_id);
CREATE INDEX IF NOT EXISTS growth_supply_day_node ON supply_daily(day,node_id);
