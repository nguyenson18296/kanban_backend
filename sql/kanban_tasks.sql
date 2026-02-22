-- ============================================
-- KANBAN PROJECT — TASK MANAGEMENT DATA MODEL
-- PostgreSQL Schema (Raw SQL Only)
-- ============================================
-- Depends on:
--   001_create_users.sql   (users table, fn_update_timestamp, pgcrypto)
--   002_create_teams.sql   (teams table)


-- ============================================
-- 1. ENUMS
-- ============================================

CREATE TYPE task_priority AS ENUM (
    'no_priority',
    'urgent',
    'high',
    'medium',
    'low'
);

CREATE TYPE task_status AS ENUM (
    'open',
    'in_progress',
    'in_review',
    'done',
    'cancelled'
);


-- ============================================
-- 2. COLUMNS TABLE (Kanban columns)
-- ============================================
-- "column" is a reserved word in SQL, so table name is "kanban_columns"

CREATE TABLE kanban_columns (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    position        INT NOT NULL DEFAULT 0,                -- Ordering: 0, 1, 2, 3...
    color           VARCHAR(20),                           -- Hex color for UI
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_kanban_columns_name UNIQUE (name),
    CONSTRAINT chk_kanban_columns_position CHECK (position >= 0)
);

CREATE INDEX idx_kanban_columns_position ON kanban_columns (position) WHERE is_archived = FALSE;

CREATE TRIGGER trg_kanban_columns_updated_at
    BEFORE UPDATE ON kanban_columns
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();


-- ============================================
-- 3. LABELS TABLE
-- ============================================

CREATE TABLE labels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(50) NOT NULL,
    color           VARCHAR(20) NOT NULL,                  -- e.g. '#EF4444'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_labels_name UNIQUE (name),
    CONSTRAINT chk_labels_color CHECK (color ~* '^#[0-9A-Fa-f]{6}$')
);

CREATE TRIGGER trg_labels_updated_at
    BEFORE UPDATE ON labels
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();


-- ============================================
-- 4. TASKS TABLE
-- ============================================

CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    status          task_status NOT NULL DEFAULT 'open',
    priority        task_priority NOT NULL DEFAULT 'no_priority',
    position        INT NOT NULL DEFAULT 0,                -- Ordering within a column
    ticket_number   SERIAL NOT NULL,                       -- Auto-increment for ticket_id generation
    ticket_id       VARCHAR(20) UNIQUE,                    -- e.g. 'KAN-1', 'KAN-2' (set after insert)
    column_id       INT NOT NULL REFERENCES kanban_columns(id) ON DELETE RESTRICT,
    team_id         INT REFERENCES teams(id) ON DELETE SET NULL,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_tasks_position CHECK (position >= 0)
);

CREATE INDEX idx_tasks_column_id ON tasks (column_id);
CREATE INDEX idx_tasks_column_position ON tasks (column_id, position) WHERE status != 'cancelled';
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_priority ON tasks (priority);
CREATE INDEX idx_tasks_team_id ON tasks (team_id);
CREATE INDEX idx_tasks_created_by ON tasks (created_by);
CREATE UNIQUE INDEX idx_tasks_ticket_number ON tasks (ticket_number);

CREATE OR REPLACE FUNCTION fn_set_ticket_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.ticket_id := 'KAN-' || NEW.ticket_number;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_set_ticket_id
    BEFORE INSERT ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_ticket_id();

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();


-- ============================================
-- 5. TASK ASSIGNEES (many-to-many: tasks ↔ users)
-- ============================================

CREATE TABLE task_assignees (
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (task_id, user_id)
);

CREATE INDEX idx_task_assignees_user_id ON task_assignees (user_id);


-- ============================================
-- 6. TASK LABELS (many-to-many: tasks ↔ labels)
-- ============================================

CREATE TABLE task_labels (
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id        UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (task_id, label_id)
);

CREATE INDEX idx_task_labels_label_id ON task_labels (label_id);


-- ============================================
-- 7. SEED DATA
-- ============================================

-- Default columns
INSERT INTO kanban_columns (name, position, color) VALUES
    ('Backlog',     0, '#6B7280'),
    ('Todo',        1, '#3B82F6'),
    ('In Progress', 2, '#F59E0B'),
    ('In Review',   3, '#8B5CF6'),
    ('Done',        4, '#10B981');

-- Default labels
INSERT INTO labels (name, color) VALUES
    ('Bug',         '#EF4444'),
    ('Feature',     '#3B82F6'),
    ('Improvement', '#10B981'),
    ('Hotfix',      '#F97316'),
    ('Documentation','#6366F1'),
    ('Design',      '#EC4899'),
    ('DevOps',      '#14B8A6'),
    ('Research',    '#8B5CF6');


-- ============================================
-- 8. HELPER FUNCTIONS
-- ============================================

-- 8a. Reorder columns: swap two columns by position
CREATE OR REPLACE FUNCTION fn_swap_column_positions(
    p_column_id_a INT,
    p_column_id_b INT
)
RETURNS VOID AS $$
DECLARE
    v_pos_a INT;
    v_pos_b INT;
BEGIN
    SELECT position INTO v_pos_a FROM kanban_columns WHERE id = p_column_id_a;
    IF v_pos_a IS NULL THEN
        RAISE EXCEPTION 'Column with id "%" not found', p_column_id_a;
    END IF;

    SELECT position INTO v_pos_b FROM kanban_columns WHERE id = p_column_id_b;
    IF v_pos_b IS NULL THEN
        RAISE EXCEPTION 'Column with id "%" not found', p_column_id_b;
    END IF;

    UPDATE kanban_columns SET position = v_pos_b WHERE id = p_column_id_a;
    UPDATE kanban_columns SET position = v_pos_a WHERE id = p_column_id_b;
END;
$$ LANGUAGE plpgsql;


-- 8b. Move a task to a different column at a specific position
CREATE OR REPLACE FUNCTION fn_move_task(
    p_task_id       UUID,
    p_new_column_id INT,
    p_new_position  INT
)
RETURNS VOID AS $$
DECLARE
    v_old_column_id INT;
    v_old_position  INT;
BEGIN
    -- Get current location
    SELECT column_id, position INTO v_old_column_id, v_old_position
    FROM tasks WHERE id = p_task_id;

    IF v_old_column_id IS NULL THEN
        RAISE EXCEPTION 'Task with id "%" not found', p_task_id;
    END IF;

    -- Close gap in old column
    UPDATE tasks
    SET position = position - 1
    WHERE column_id = v_old_column_id
      AND position > v_old_position;

    -- Open gap in new column
    UPDATE tasks
    SET position = position + 1
    WHERE column_id = p_new_column_id
      AND position >= p_new_position;

    -- Move the task
    UPDATE tasks
    SET column_id = p_new_column_id,
        position  = p_new_position
    WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql;


-- 8c. Reorder a task within the same column
CREATE OR REPLACE FUNCTION fn_reorder_task(
    p_task_id      UUID,
    p_new_position INT
)
RETURNS VOID AS $$
DECLARE
    v_column_id    INT;
    v_old_position INT;
BEGIN
    SELECT column_id, position INTO v_column_id, v_old_position
    FROM tasks WHERE id = p_task_id;

    IF v_column_id IS NULL THEN
        RAISE EXCEPTION 'Task with id "%" not found', p_task_id;
    END IF;

    IF v_old_position = p_new_position THEN
        RETURN;
    END IF;

    -- Shift tasks between old and new position
    IF p_new_position < v_old_position THEN
        -- Moving up: shift others down
        UPDATE tasks
        SET position = position + 1
        WHERE column_id = v_column_id
          AND position >= p_new_position
          AND position < v_old_position;
    ELSE
        -- Moving down: shift others up
        UPDATE tasks
        SET position = position - 1
        WHERE column_id = v_column_id
          AND position > v_old_position
          AND position <= p_new_position;
    END IF;

    UPDATE tasks SET position = p_new_position WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- 9. EXAMPLE QUERIES
-- ============================================

-- -------------------------------------------------
-- 9a. CREATE a column
-- -------------------------------------------------
-- INSERT INTO kanban_columns (name, position, color)
-- VALUES ('QA Testing', 5, '#F43F5E');


-- -------------------------------------------------
-- 9b. CREATE a task in a column
-- -------------------------------------------------
-- INSERT INTO tasks (title, description, priority, column_id, position, created_by)
-- VALUES (
--     'Implement user authentication',
--     'Add JWT-based login with refresh token rotation',
--     'high',
--     (SELECT id FROM kanban_columns WHERE name = 'Todo'),
--     (SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE column_id = (SELECT id FROM kanban_columns WHERE name = 'Todo')),
--     (SELECT id FROM users WHERE email = 'alice@kanban.dev')
-- );


-- -------------------------------------------------
-- 9c. MOVE a task between columns
-- -------------------------------------------------
-- SELECT fn_move_task(
--     'task-uuid-here',
--     (SELECT id FROM kanban_columns WHERE name = 'In Progress'),
--     0   -- place at top
-- );


-- -------------------------------------------------
-- 9d. ASSIGN users to a task
-- -------------------------------------------------
-- INSERT INTO task_assignees (task_id, user_id) VALUES
--     ('task-uuid-here', (SELECT id FROM users WHERE email = 'alice@kanban.dev')),
--     ('task-uuid-here', (SELECT id FROM users WHERE email = 'bob@kanban.dev'))
-- ON CONFLICT DO NOTHING;

-- Remove an assignee
-- DELETE FROM task_assignees
-- WHERE task_id = 'task-uuid-here'
--   AND user_id = (SELECT id FROM users WHERE email = 'bob@kanban.dev');


-- -------------------------------------------------
-- 9e. ADD / REMOVE labels from a task
-- -------------------------------------------------
-- Add labels
-- INSERT INTO task_labels (task_id, label_id) VALUES
--     ('task-uuid-here', (SELECT id FROM labels WHERE name = 'Feature')),
--     ('task-uuid-here', (SELECT id FROM labels WHERE name = 'Backend'))
-- ON CONFLICT DO NOTHING;

-- Remove a label
-- DELETE FROM task_labels
-- WHERE task_id = 'task-uuid-here'
--   AND label_id = (SELECT id FROM labels WHERE name = 'Feature');


-- -------------------------------------------------
-- 9f. GET /api/board — Composite board endpoint
--     Returns JSON: { columns: [{ id, name, position, color, task_count, tasks }] }
--     Each task includes nested assignees and labels arrays.
--     Supports: per-column pagination, priority/search/assignee/label filters.
-- -------------------------------------------------

-- Base board query (no filters, 50 tasks per column)
SELECT json_build_object('columns',
    (SELECT COALESCE(json_agg(col_data ORDER BY col_data.position), '[]'::json)
     FROM (
         SELECT
             kc.id,
             kc.name,
             kc.position,
             kc.color,
             (SELECT COUNT(*) FROM tasks t WHERE t.column_id = kc.id) AS task_count,
             (SELECT COALESCE(json_agg(task_row ORDER BY task_row.position), '[]'::json)
              FROM (
                  SELECT
                      t.id, t.title, t.ticket_id, t.position,
                      t.status, t.priority, t.created_at,
                      (SELECT COALESCE(json_agg(json_build_object(
                          'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url
                      )), '[]'::json)
                      FROM task_assignees ta JOIN users u ON u.id = ta.user_id
                      WHERE ta.task_id = t.id) AS assignees,
                      (SELECT COALESCE(json_agg(json_build_object(
                          'id', l.id, 'name', l.name, 'color', l.color
                      )), '[]'::json)
                      FROM task_labels tl JOIN labels l ON l.id = tl.label_id
                      WHERE tl.task_id = t.id) AS labels
                  FROM tasks t
                  WHERE t.column_id = kc.id
                  ORDER BY t.position
                  LIMIT 50                                     tasksPerColumn
              ) task_row
             ) AS tasks
         FROM kanban_columns kc
         WHERE kc.is_archived = FALSE
         ORDER BY kc.position
     ) col_data
    )
);


-- -------------------------------------------------
-- 9g. Board with priority filter
--     GET /api/board?priority=high
-- -------------------------------------------------
-- Same as 9f but add to inner tasks WHERE clause:
--   AND t.priority = 'high'
-- And the task_count subquery gets the same filter:
--   (SELECT COUNT(*) FROM tasks t WHERE t.column_id = kc.id AND t.priority = 'high')


-- -------------------------------------------------
-- 9h. Board with search filter
--     GET /api/board?search=login
-- -------------------------------------------------
-- Same as 9f but add to inner tasks WHERE clause:
--   AND t.title ILIKE '%login%'
-- Escape % and _ in user input to prevent wildcard injection.


-- -------------------------------------------------
-- 9i. Board filtered by assignee (subquery approach)
--     GET /api/board?assigneeId=<uuid>
--     Uses subquery so the LEFT JOIN still returns ALL assignees of matching tasks.
-- -------------------------------------------------
-- Same as 9f but add to inner tasks WHERE clause:
--   AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = '<assignee-uuid>')


-- -------------------------------------------------
-- 9j. Board filtered by label (subquery approach)
--     GET /api/board?labelId=<uuid>
--     Uses subquery so the LEFT JOIN still returns ALL labels of matching tasks.
-- -------------------------------------------------
-- Same as 9f but add to inner tasks WHERE clause:
--   AND t.id IN (SELECT task_id FROM task_labels WHERE label_id = '<label-uuid>')


-- -------------------------------------------------
-- 9k. Combined filters (AND logic)
--     GET /api/board?priority=high&assigneeId=<uuid>&tasksPerColumn=10
-- -------------------------------------------------
-- Combine the WHERE clauses from 9g–9j and adjust LIMIT to tasksPerColumn value.
