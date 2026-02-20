-- ============================================
-- KANBAN PROJECT — USER ENTITY
-- PostgreSQL Schema (Raw SQL Only)
-- ============================================

-- 1. EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- For gen_random_uuid() & crypt()
CREATE EXTENSION IF NOT EXISTS "citext";     -- For case-insensitive email


-- 2. ROLE ENUM
-- ============================================
CREATE TYPE user_role AS ENUM (
    'backend_developer',
    'frontend_developer',
    'fullstack_developer',
    'qa',
    'devops',
    'designer',
    'product_manager',
    'tech_lead'
);


-- 3. USERS TABLE
-- ============================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    password_hash   TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'backend_developer',
    team            VARCHAR(100),                          -- Will be replaced by team_id FK later
    avatar_url      TEXT DEFAULT 'https://api.dicebear.com/9.x/initials/svg?seed=default',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT chk_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);


-- 4. INDEXES
-- ============================================
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_team ON users (team);
CREATE INDEX idx_users_is_active ON users (is_active);


-- 5. AUTO-UPDATE updated_at TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();


-- 6. SEED DATA
-- ============================================
-- Default password: "password123" hashed with pgcrypto's crypt + blowfish
-- Usage:  crypt('password123', gen_salt('bf', 10))
-- Verify: WHERE password_hash = crypt('input_password', password_hash)

INSERT INTO users (email, full_name, password_hash, role, team, avatar_url) VALUES
    (
        'alice@kanban.dev',
        'Alice Nguyen',
        crypt('password123', gen_salt('bf', 10)),
        'tech_lead',
        'Platform',
        'https://api.dicebear.com/9.x/initials/svg?seed=Alice+Nguyen'
    ),
    (
        'bob@kanban.dev',
        'Bob Tran',
        crypt('password123', gen_salt('bf', 10)),
        'backend_developer',
        'Platform',
        'https://api.dicebear.com/9.x/initials/svg?seed=Bob+Tran'
    ),
    (
        'carol@kanban.dev',
        'Carol Le',
        crypt('password123', gen_salt('bf', 10)),
        'frontend_developer',
        'Web UI',
        'https://api.dicebear.com/9.x/initials/svg?seed=Carol+Le'
    ),
    (
        'dave@kanban.dev',
        'Dave Pham',
        crypt('password123', gen_salt('bf', 10)),
        'qa',
        'Quality',
        'https://api.dicebear.com/9.x/initials/svg?seed=Dave+Pham'
    ),
    (
        'eve@kanban.dev',
        'Eve Vo',
        crypt('password123', gen_salt('bf', 10)),
        'designer',
        'Web UI',
        'https://api.dicebear.com/9.x/initials/svg?seed=Eve+Vo'
    );


-- 7. HELPER QUERIES
-- ============================================

-- Verify password for login
-- SELECT id, full_name, email, role, team, avatar_url
-- FROM users
-- WHERE email = 'alice@kanban.dev'
--   AND password_hash = crypt('password123', password_hash);

-- Get all active users on a team
-- SELECT id, full_name, email, role, avatar_url
-- FROM users
-- WHERE team = 'Platform' AND is_active = TRUE
-- ORDER BY full_name;
