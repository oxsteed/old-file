#!/usr/bin/env node
'use strict';
// Uses a dedicated network-isolated test container, never the app database.
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { overrideSql, applyOverride, locationSql } = require('../services/restaurantStoreMenuService');
const container = process.env.RESTAURANT_MENU_TEST_CONTAINER || 'oxsteed-franchise-menu-test';
if (!/^oxsteed-franchise-[a-z0-9-]+-test$/.test(container)) throw new Error('Dedicated franchise test container required');
const database = `franchise_menu_${randomBytes(8).toString('hex')}`;
function sql(command, db = database) {
  const result = spawnSync('docker', ['--context', 'colima', 'exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'franchise_test', '-d', db], { input: command, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'Disposable schema verification failed');
  return result.stdout;
}
try {
  sql(`CREATE DATABASE ${database};`, 'franchise_test');
  const locations = fs.readFileSync(path.join(__dirname, '../migrations/319_restaurant_locations.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/963_restaurant_store_menu.sql'), 'utf8');
  sql(`CREATE TABLE users(id UUID PRIMARY KEY);
    CREATE TABLE food_restaurants(id BIGINT PRIMARY KEY, display_name TEXT NOT NULL,
      address_street TEXT,address_city TEXT,address_state TEXT,address_zip TEXT,address_country VARCHAR(2),
      latitude DOUBLE PRECISION,longitude DOUBLE PRECISION,timezone TEXT,phone TEXT,operating_hours JSONB);
    ${locations}
    CREATE TABLE food_orders(restaurant_id BIGINT,location_id BIGINT,queue_number INTEGER,created_at TIMESTAMPTZ);
    CREATE TABLE restaurant_pos_payments(restaurant_id BIGINT,location_id BIGINT);
    CREATE TABLE restaurant_pos_shifts(restaurant_id BIGINT,location_id BIGINT);
    CREATE TABLE restaurant_printer_jobs(restaurant_id BIGINT,location_id BIGINT);
    CREATE TABLE restaurant_inventory_items(restaurant_id BIGINT,location_id BIGINT);
    CREATE TABLE restaurant_daily_counters(restaurant_id BIGINT,location_id BIGINT,business_date DATE,last_queue_number INTEGER,
      UNIQUE(restaurant_id,location_id,business_date));
    CREATE TABLE food_menu_items(id BIGINT PRIMARY KEY, restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id),
      price_cents INTEGER NOT NULL, is_available BOOLEAN NOT NULL);
    CREATE TABLE screen_events(restaurant_id BIGINT,location_id BIGINT,kind TEXT,entity_id TEXT);
    CREATE FUNCTION restaurant_screen_record_change(BIGINT,BIGINT,TEXT,TEXT) RETURNS VOID LANGUAGE SQL AS
      'INSERT INTO screen_events VALUES($1,$2,$3,$4)';
    INSERT INTO food_restaurants(id,display_name,address_city,timezone) VALUES(1,'Brand one','Test city','America/New_York'),(2,'Brand two','Other city','UTC'),(3,'Legacy store','Copied city','America/New_York');
    INSERT INTO restaurant_locations(id,restaurant_id,is_primary,status,name) VALUES(10,1,TRUE,'active','First'),(11,1,FALSE,'active','Sibling'),(20,2,TRUE,'active','Other');
    INSERT INTO food_orders VALUES(3,NULL,9,NOW());
    INSERT INTO restaurant_daily_counters VALUES(3,NULL,CURRENT_DATE,12);
    ${migration}
    ${migration}
    INSERT INTO food_restaurants(id,display_name) VALUES(4,'New onboarding');
    DO $$ BEGIN
      IF (SELECT COUNT(*) FROM restaurant_locations WHERE restaurant_id=3) <> 1
        OR NOT EXISTS(SELECT 1 FROM restaurant_locations WHERE restaurant_id=3 AND address_city='Copied city' AND timezone='America/New_York' AND is_primary)
        OR (SELECT COUNT(*) FROM restaurant_locations WHERE restaurant_id=4) <> 1
        OR (SELECT COUNT(*) FROM restaurant_locations WHERE restaurant_id=1) <> 2
      THEN RAISE EXCEPTION 'Default store backfill/onboarding/replay changed configured stores'; END IF;
      IF NOT EXISTS(SELECT 1 FROM food_orders o JOIN restaurant_locations l ON l.id=o.location_id WHERE l.restaurant_id=3 AND o.queue_number=9)
        OR NOT EXISTS(SELECT 1 FROM restaurant_daily_counters c JOIN restaurant_locations l ON l.id=c.location_id WHERE l.restaurant_id=3 AND c.last_queue_number=12)
      THEN RAISE EXCEPTION 'Legacy order/counter continuity lost'; END IF;
    END $$;
    INSERT INTO food_menu_items VALUES(100,1,1000,TRUE),(200,2,2000,TRUE);
    INSERT INTO restaurant_store_menu_overrides(restaurant_id,location_id,menu_item_id,price_cents,is_available)
      VALUES(1,10,100,1250,FALSE);
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM screen_events WHERE restaurant_id=1 AND location_id=10 AND kind='store_menu' AND entity_id='100') THEN RAISE EXCEPTION 'Store-scoped screen event missing'; END IF;
      BEGIN
        INSERT INTO restaurant_store_menu_overrides(restaurant_id,location_id,menu_item_id) VALUES(1,20,100);
        RAISE EXCEPTION 'Foreign store accepted';
      EXCEPTION WHEN foreign_key_violation THEN NULL; END;
      BEGIN
        INSERT INTO restaurant_store_menu_overrides(restaurant_id,location_id,menu_item_id) VALUES(1,11,200);
        RAISE EXCEPTION 'Foreign menu item accepted';
      EXCEPTION WHEN foreign_key_violation THEN NULL; END;
      BEGIN
        INSERT INTO restaurant_store_menu_overrides(restaurant_id,location_id,menu_item_id,price_cents) VALUES(1,11,100,-1);
        RAISE EXCEPTION 'Negative price accepted';
      EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`);
  function itemAt(storeId) {
    const query = `PREPARE menu_read(BIGINT) AS SELECT row_to_json(m) FROM
      (SELECT fmi.*, ${overrideSql('fmi', '$1')} FROM food_menu_items fmi WHERE fmi.id=100) m;
      EXECUTE menu_read(${storeId});`;
    const result = sql(query).split('\n').find((line) => line.trim().startsWith('{'));
    return applyOverride(JSON.parse(result));
  }
  if (itemAt(10).price_cents !== 1250 || itemAt(10).is_available !== false
    || itemAt(11).price_cents !== 1000 || itemAt(11).is_available !== true) throw new Error('Sibling store isolation failed');
  sql(`PREPARE store_read(BIGINT) AS SELECT ${locationSql('$1')} FROM food_restaurants fr WHERE fr.id=1; EXECUTE store_read(NULL);`);
  console.log('Store menu migration/replay, tenant foreign keys, price checks, SQL projections and sibling-store isolation passed.');
} finally {
  sql(`DROP DATABASE IF EXISTS ${database};`, 'franchise_test');
}
