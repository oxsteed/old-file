CREATE TABLE propensity_scores (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model TEXT NOT NULL, score NUMERIC NOT NULL CHECK(score BETWEEN 0 AND 1),
 reasons JSONB NOT NULL, model_version TEXT NOT NULL,
 computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,model)
);
