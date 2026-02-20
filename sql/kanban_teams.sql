-- ============================================
-- KANBAN PROJECT — TEAM ENTITY
-- PostgreSQL Schema (Raw SQL Only)
-- ============================================
-- Depends on: kanban_users.sql (fn_update_timestamp)


-- 1. TEAMS TABLE
-- ============================================
CREATE TABLE teams (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    color           VARCHAR(20),                           -- Hex color for UI, e.g. '#3B82F6'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT uq_teams_name UNIQUE (name),
    CONSTRAINT chk_teams_color CHECK (color ~* '^#[0-9A-Fa-f]{6}$')
);


-- 2. INDEXES
-- ============================================
CREATE INDEX idx_teams_is_active ON teams (is_active);


-- 3. AUTO-UPDATE updated_at TRIGGER
-- ============================================
-- Reuses fn_update_timestamp() from users migration
CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();


-- 4. MIGRATE USERS: replace team string with team_id FK
-- ============================================
ALTER TABLE users ADD COLUMN team_id INT;

ALTER TABLE users
    ADD CONSTRAINT fk_users_team
    FOREIGN KEY (team_id) REFERENCES teams(id)
    ON DELETE SET NULL;

CREATE INDEX idx_users_team_id ON users (team_id);


-- 5. SEED TEAMS
-- ============================================
INSERT INTO teams (name, description, color) VALUES
    ('Platform',  'Core platform & infrastructure',       '#3B82F6'),
    ('Web UI',    'Frontend & design systems',            '#10B981'),
    ('Quality',   'QA, testing & automation',             '#F59E0B'),
    ('DevOps',    'CI/CD, infrastructure & monitoring',   '#EF4444');


-- 6. BACKFILL: map existing users.team string → team_id
-- ============================================
UPDATE users SET team_id = t.id
FROM teams t
WHERE users.team = t.name;

-- Drop old string column after verifying backfill
ALTER TABLE users DROP COLUMN team;

-- Drop the old string index (created in users migration)
DROP INDEX IF EXISTS idx_users_team;


-- 7. HELPER QUERIES
-- ============================================

-- List all active teams with member count
-- SELECT t.id, t.name, t.color, COUNT(u.id) AS member_count
-- FROM teams t
-- LEFT JOIN users u ON u.team_id = t.id AND u.is_active = TRUE
-- WHERE t.is_active = TRUE
-- GROUP BY t.id
-- ORDER BY t.name;

-- Get all members of a team
-- SELECT u.id, u.full_name, u.email, u.role, u.avatar_url
-- FROM users u
-- WHERE u.team_id = 1
--   AND u.is_active = TRUE
-- ORDER BY u.full_name;
