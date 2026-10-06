-- Work Agreement Records-Room (migration 697).
-- OxSteed acts as records keeper (notary), never employer or adjudicator.
-- Bilateral agreements between helper and customer: drawn signatures,
-- versioned change orders, evidence, outside documents, warranty claims.

CREATE TABLE IF NOT EXISTS work_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_signatures', 'active', 'completed', 'closed')),
  disputed BOOLEAN NOT NULL DEFAULT FALSE,
  warranty_months INT NOT NULL DEFAULT 6 CHECK (warranty_months >= 0 AND warranty_months <= 60),
  warranty_terms TEXT,
  reimbursement_terms TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_agreements_job ON work_agreements(job_id);
CREATE INDEX IF NOT EXISTS idx_work_agreements_parties ON work_agreements(helper_id, customer_id);

CREATE TABLE IF NOT EXISTS work_agreement_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES work_agreements(id) ON DELETE CASCADE,
  version_number INT NOT NULL CHECK (version_number >= 1),
  content JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_wa_versions_agreement ON work_agreement_versions(agreement_id, version_number DESC);

CREATE TABLE IF NOT EXISTS work_agreement_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES work_agreements(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES work_agreement_versions(id) ON DELETE CASCADE,
  signer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signer_role TEXT NOT NULL CHECK (signer_role IN ('helper', 'customer')),
  signature_data TEXT NOT NULL CHECK (char_length(signature_data) BETWEEN 100 AND 2000000),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, signer_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_signatures_version ON work_agreement_signatures(version_id);

CREATE TABLE IF NOT EXISTS work_agreement_change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES work_agreements(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES work_agreement_versions(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 10000),
  price_change_cents INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected')),
  proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_change_orders_agreement ON work_agreement_change_orders(agreement_id, status);

CREATE TABLE IF NOT EXISTS work_agreement_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES work_agreements(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN ('before_photo', 'after_photo', 'testing_record')),
  file_url TEXT NOT NULL CHECK (char_length(file_url) BETWEEN 1 AND 2048),
  description TEXT,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_evidence_agreement ON work_agreement_evidence(agreement_id, evidence_type);

CREATE TABLE IF NOT EXISTS work_agreement_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES work_agreements(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL CHECK (char_length(file_url) BETWEEN 1 AND 2048),
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_documents_agreement ON work_agreement_documents(agreement_id);

CREATE TABLE IF NOT EXISTS work_agreement_warranty_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES work_agreements(id) ON DELETE CASCADE,
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 10000),
  status TEXT NOT NULL DEFAULT 'filed'
    CHECK (status IN ('filed', 'under_review', 'resolved', 'denied')),
  filed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_warranty_agreement ON work_agreement_warranty_claims(agreement_id, status);
