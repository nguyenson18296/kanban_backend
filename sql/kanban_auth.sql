-- ============================================
-- KANBAN PROJECT — AUTHENTICATION SYSTEM
-- PostgreSQL Schema (Raw SQL Only)
-- ============================================
-- Depends on: 001_create_users.sql (users table, fn_update_timestamp, pgcrypto)


-- 1. TOKEN TYPE ENUM
-- ============================================
CREATE TYPE token_type AS ENUM ('access', 'refresh');


-- 2. REFRESH TOKENS TABLE
-- ============================================
-- Access tokens are stateless (JWT verified by signature, not stored in DB)
-- Refresh tokens are stored for revocation, rotation & session tracking

CREATE TABLE refresh_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL,                         -- SHA-256 hash of the token (never store raw)
    device_info     VARCHAR(255),                          -- e.g. 'Chrome on macOS', 'Mobile App'
    ip_address      INET,
    is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_refresh_token_hash UNIQUE (token_hash)
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at) WHERE is_revoked = FALSE;


-- 3. LOGIN ATTEMPTS TABLE (brute-force protection)
-- ============================================
CREATE TABLE login_attempts (
    id              SERIAL PRIMARY KEY,
    email           CITEXT NOT NULL,
    ip_address      INET,
    success         BOOLEAN NOT NULL DEFAULT FALSE,
    attempted_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_login_attempts_email_time ON login_attempts (email, attempted_at DESC);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts (ip_address, attempted_at DESC);


-- 4. HELPER FUNCTIONS
-- ============================================

-- 4a. Hash a token string using SHA-256
CREATE OR REPLACE FUNCTION fn_hash_token(raw_token TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN encode(digest(raw_token, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- 4b. Authenticate user — returns user row or nothing
CREATE OR REPLACE FUNCTION fn_authenticate(
    p_email    TEXT,
    p_password TEXT
)
RETURNS TABLE (
    id          UUID,
    email       CITEXT,
    full_name   VARCHAR,
    role        user_role,
    team_id     INT,
    avatar_url  TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id, u.email, u.full_name, u.role, u.team_id, u.avatar_url
    FROM users u
    WHERE u.email = p_email
      AND u.password_hash = crypt(p_password, u.password_hash)
      AND u.is_active = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4c. Check if account is locked (>= 5 failed attempts in last 15 min)
CREATE OR REPLACE FUNCTION fn_is_account_locked(p_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    failed_count INT;
BEGIN
    SELECT COUNT(*) INTO failed_count
    FROM login_attempts
    WHERE email = p_email
      AND success = FALSE
      AND attempted_at > CURRENT_TIMESTAMP - INTERVAL '15 minutes';

    RETURN failed_count >= 5;
END;
$$ LANGUAGE plpgsql;


-- 4d. Record a login attempt
CREATE OR REPLACE FUNCTION fn_record_login_attempt(
    p_email      TEXT,
    p_ip_address INET,
    p_success    BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO login_attempts (email, ip_address, success)
    VALUES (p_email, p_ip_address, p_success);
END;
$$ LANGUAGE plpgsql;


-- 4e. Full login flow — authenticate + record attempt + check lockout
CREATE OR REPLACE FUNCTION fn_login(
    p_email       TEXT,
    p_password    TEXT,
    p_ip_address  INET DEFAULT NULL
)
RETURNS TABLE (
    status      TEXT,             -- 'success', 'locked', 'invalid'
    user_id     UUID,
    email       CITEXT,
    full_name   VARCHAR,
    role        user_role,
    team_id     INT,
    avatar_url  TEXT
) AS $$
DECLARE
    v_user RECORD;
BEGIN
    -- 1. Check lockout
    IF fn_is_account_locked(p_email) THEN
        RETURN QUERY SELECT 'locked'::TEXT, NULL::UUID, NULL::CITEXT,
            NULL::VARCHAR, NULL::user_role, NULL::INT, NULL::TEXT;
        RETURN;
    END IF;

    -- 2. Authenticate
    SELECT a.* INTO v_user
    FROM fn_authenticate(p_email, p_password) a;

    IF v_user.id IS NOT NULL THEN
        -- Success
        PERFORM fn_record_login_attempt(p_email, p_ip_address, TRUE);
        RETURN QUERY SELECT 'success'::TEXT, v_user.id, v_user.email,
            v_user.full_name, v_user.role, v_user.team_id, v_user.avatar_url;
    ELSE
        -- Failed
        PERFORM fn_record_login_attempt(p_email, p_ip_address, FALSE);
        RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, NULL::CITEXT,
            NULL::VARCHAR, NULL::user_role, NULL::INT, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4f. Store a refresh token (after login success)
CREATE OR REPLACE FUNCTION fn_store_refresh_token(
    p_user_id      UUID,
    p_raw_token    TEXT,
    p_device_info  VARCHAR DEFAULT NULL,
    p_ip_address   INET DEFAULT NULL,
    p_ttl_days     INT DEFAULT 30
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
    VALUES (
        p_user_id,
        fn_hash_token(p_raw_token),
        p_device_info,
        p_ip_address,
        CURRENT_TIMESTAMP + (p_ttl_days || ' days')::INTERVAL
    );
END;
$$ LANGUAGE plpgsql;


-- 4g. Validate & rotate refresh token (returns user if valid, revokes old token)
CREATE OR REPLACE FUNCTION fn_rotate_refresh_token(
    p_old_raw_token  TEXT,
    p_new_raw_token  TEXT,
    p_device_info    VARCHAR DEFAULT NULL,
    p_ip_address     INET DEFAULT NULL,
    p_ttl_days       INT DEFAULT 30
)
RETURNS TABLE (
    status      TEXT,             -- 'success', 'expired', 'revoked', 'invalid'
    user_id     UUID,
    email       CITEXT,
    full_name   VARCHAR,
    role        user_role,
    team_id     INT,
    avatar_url  TEXT
) AS $$
DECLARE
    v_token RECORD;
    v_user  RECORD;
BEGIN
    -- 1. Find the token by hash
    SELECT rt.* INTO v_token
    FROM refresh_tokens rt
    WHERE rt.token_hash = fn_hash_token(p_old_raw_token);

    -- Not found
    IF v_token.id IS NULL THEN
        RETURN QUERY SELECT 'invalid'::TEXT, NULL::UUID, NULL::CITEXT,
            NULL::VARCHAR, NULL::user_role, NULL::INT, NULL::TEXT;
        RETURN;
    END IF;

    -- Already revoked (possible token theft — revoke ALL tokens for this user)
    IF v_token.is_revoked THEN
        UPDATE refresh_tokens SET is_revoked = TRUE
        WHERE user_id = v_token.user_id AND is_revoked = FALSE;

        RETURN QUERY SELECT 'revoked'::TEXT, NULL::UUID, NULL::CITEXT,
            NULL::VARCHAR, NULL::user_role, NULL::INT, NULL::TEXT;
        RETURN;
    END IF;

    -- Expired
    IF v_token.expires_at < CURRENT_TIMESTAMP THEN
        UPDATE refresh_tokens SET is_revoked = TRUE WHERE id = v_token.id;

        RETURN QUERY SELECT 'expired'::TEXT, NULL::UUID, NULL::CITEXT,
            NULL::VARCHAR, NULL::user_role, NULL::INT, NULL::TEXT;
        RETURN;
    END IF;

    -- 2. Revoke old token
    UPDATE refresh_tokens SET is_revoked = TRUE WHERE id = v_token.id;

    -- 3. Issue new refresh token
    PERFORM fn_store_refresh_token(
        v_token.user_id, p_new_raw_token, p_device_info, p_ip_address, p_ttl_days
    );

    -- 4. Return user info (for generating new access token)
    RETURN QUERY
    SELECT 'success'::TEXT, u.id, u.email, u.full_name, u.role, u.team_id, u.avatar_url
    FROM users u
    WHERE u.id = v_token.user_id AND u.is_active = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4h. Logout — revoke a specific refresh token
CREATE OR REPLACE FUNCTION fn_logout(p_raw_token TEXT)
RETURNS VOID AS $$
BEGIN
    UPDATE refresh_tokens
    SET is_revoked = TRUE
    WHERE token_hash = fn_hash_token(p_raw_token)
      AND is_revoked = FALSE;
END;
$$ LANGUAGE plpgsql;


-- 4i. Logout all sessions for a user
CREATE OR REPLACE FUNCTION fn_logout_all(p_user_id UUID)
RETURNS INT AS $$
DECLARE
    revoked_count INT;
BEGIN
    UPDATE refresh_tokens
    SET is_revoked = TRUE
    WHERE user_id = p_user_id
      AND is_revoked = FALSE;

    GET DIAGNOSTICS revoked_count = ROW_COUNT;
    RETURN revoked_count;
END;
$$ LANGUAGE plpgsql;


-- 5. CLEANUP: expired tokens & old login attempts
-- ============================================
-- Run periodically via pg_cron or external scheduler

CREATE OR REPLACE FUNCTION fn_cleanup_auth()
RETURNS TABLE (tokens_deleted INT, attempts_deleted INT) AS $$
DECLARE
    v_tokens  INT;
    v_attempts INT;
BEGIN
    -- Remove expired/revoked tokens older than 7 days
    DELETE FROM refresh_tokens
    WHERE (is_revoked = TRUE OR expires_at < CURRENT_TIMESTAMP)
      AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';
    GET DIAGNOSTICS v_tokens = ROW_COUNT;

    -- Remove login attempts older than 30 days
    DELETE FROM login_attempts
    WHERE attempted_at < CURRENT_TIMESTAMP - INTERVAL '30 days';
    GET DIAGNOSTICS v_attempts = ROW_COUNT;

    RETURN QUERY SELECT v_tokens, v_attempts;
END;
$$ LANGUAGE plpgsql;


-- 6. USAGE EXAMPLES
-- ============================================

-- === LOGIN FLOW ===
-- Step 1: Call fn_login
-- SELECT * FROM fn_login('alice@kanban.dev', 'password123', '192.168.1.1'::INET);
--  status  |               user_id                |     email         | full_name    | ...
-- ---------+--------------------------------------+-------------------+--------------+----
--  success | 550e8400-e29b-41d4-a716-446655440000 | alice@kanban.dev  | Alice Nguyen | ...

-- Step 2: App generates JWT access token (short-lived, 15min)
--   payload: { sub: user_id, email, role, team_id }
--   signed with app secret — NOT stored in DB

-- Step 3: App generates random refresh token & stores hash
-- SELECT fn_store_refresh_token(
--     '550e8400-e29b-41d4-a716-446655440000',  -- user_id from step 1
--     'random-refresh-token-string-here',        -- generated by app (e.g. crypto.randomUUID())
--     'Chrome on macOS',
--     '192.168.1.1'::INET
-- );

-- === REFRESH FLOW ===
-- Client sends expired access token + refresh token
-- App calls fn_rotate_refresh_token → gets user info → issues new JWT + new refresh token
-- SELECT * FROM fn_rotate_refresh_token(
--     'old-refresh-token-string',
--     'new-refresh-token-string',
--     'Chrome on macOS',
--     '192.168.1.1'::INET
-- );

-- === LOGOUT ===
-- Single session:  SELECT fn_logout('current-refresh-token');
-- All sessions:    SELECT fn_logout_all('550e8400-...');

-- === CLEANUP (schedule daily) ===
-- SELECT * FROM fn_cleanup_auth();
