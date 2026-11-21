ALTER TABLE business_members ADD COLUMN permission_version INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION bump_business_member_permission_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.permission_version:=OLD.permission_version+1; RETURN NEW; END $$;
CREATE TRIGGER business_member_permission_version BEFORE UPDATE ON business_members FOR EACH ROW EXECUTE FUNCTION bump_business_member_permission_version();
CREATE FUNCTION touch_business_member_permission_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN UPDATE business_members SET permission_version=permission_version WHERE id=OLD.membership_id; RETURN OLD;
 ELSE UPDATE business_members SET permission_version=permission_version WHERE id=NEW.membership_id; RETURN NEW;
 END IF;
END $$;
CREATE TRIGGER business_member_override_version AFTER INSERT OR UPDATE OR DELETE ON membership_permission_overrides FOR EACH ROW EXECUTE FUNCTION touch_business_member_permission_version();
CREATE TABLE business_role_templates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 name VARCHAR(100) NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('manager','representative','employee','support_agent')),
 overrides JSONB NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX business_role_templates_scope_idx ON business_role_templates(business_id);
CREATE TABLE business_role_template_history (
 id BIGSERIAL PRIMARY KEY,
 business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 membership_id INTEGER REFERENCES business_members(id) ON DELETE SET NULL,
 actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
 template_name TEXT NOT NULL,
 reason TEXT NOT NULL,
 before_state JSONB NOT NULL,
 after_state JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
