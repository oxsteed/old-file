CREATE TABLE demand_taxonomy_nodes (
 id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE,
 parent_id INTEGER REFERENCES demand_taxonomy_nodes(id),
 labels JSONB NOT NULL, sensitive BOOLEAN NOT NULL DEFAULT FALSE,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
 version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE demand_taxonomy_rules (
 id SERIAL PRIMARY KEY, node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id),
 locale TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN
 ('category_id','skill_id','job_type','cuisine_tag','menu_tag','keyword')),
 pattern TEXT NOT NULL, weight NUMERIC NOT NULL CHECK(weight BETWEEN 0 AND 1),
 UNIQUE(node_id,locale,kind,pattern)
);
INSERT INTO demand_taxonomy_nodes(code,labels,status) VALUES
 ('services.plumbing', '{"en":"Plumbing","es":"Plomería","fr":"Plomberie","ht":"Plonbri","ar":"السباكة"}','active'),
 ('services.plumbing.drain_clog','{"en":"Clogged drain","es":"Desagüe atascado","fr":"Canalisation bouchée","ht":"Tiyo bouche","ar":"انسداد المصرف"}','active'),
 ('food.restaurant_ops.delivery_growth','{"en":"Delivery growth","es":"Crecimiento de entregas","fr":"Développement des livraisons","ht":"Devlopman livrezon","ar":"نمو التوصيل"}','active'),
 ('business.setup.online_booking','{"en":"Online booking","es":"Reservas en línea","fr":"Réservation en ligne","ht":"Rezèvasyon sou entènèt","ar":"الحجز عبر الإنترنت"}','active');
UPDATE demand_taxonomy_nodes SET parent_id=(SELECT id FROM demand_taxonomy_nodes WHERE code='services.plumbing')
WHERE code='services.plumbing.drain_clog';
INSERT INTO demand_taxonomy_rules(node_id,locale,kind,pattern,weight)
SELECT n.id,k.locale,'keyword',k.pattern,0.7 FROM demand_taxonomy_nodes n CROSS JOIN
 (VALUES ('en','clog'),('en','blocked drain'),('es','atascado'),('es','desagüe'),
 ('fr','bouché'),('fr','canalisation'),('ht','tiyo bouche'),('ht','drenaj'),('ar','انسداد'),('ar','تسليك')) k(locale,pattern)
WHERE n.code='services.plumbing.drain_clog';
