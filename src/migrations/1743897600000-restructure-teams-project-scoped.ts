import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestructureTeamsProjectScoped1743897600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create project_members table
    await queryRunner.query(`
      CREATE TABLE project_members (
        project_id  VARCHAR(8)  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, user_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_project_members_user_id ON project_members (user_id)`,
    );

    // 2. Add project_id to teams (nullable first for migration)
    await queryRunner.query(
      `ALTER TABLE teams ADD COLUMN project_id VARCHAR(8) REFERENCES projects(id) ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_teams_project_id ON teams (project_id)`,
    );

    // 3. Create team_members table
    await queryRunner.query(`
      CREATE TABLE team_members (
        team_id     INT         NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id  VARCHAR(8)  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (team_id, user_id),
        UNIQUE (user_id, project_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_team_members_user_id ON team_members (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_team_members_project_id ON team_members (project_id)`,
    );

    // 4. Migrate existing data
    await queryRunner.query(`
      UPDATE teams t
      SET project_id = p.id
      FROM projects p
      WHERE p.team_id = t.id
    `);

    await queryRunner.query(`
      INSERT INTO team_members (team_id, user_id, project_id)
      SELECT u.team_id, u.id, t.project_id
      FROM users u
      JOIN teams t ON t.id = u.team_id
      WHERE u.team_id IS NOT NULL AND t.project_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO project_members (project_id, user_id)
      SELECT tm.project_id, tm.user_id
      FROM team_members tm
      ON CONFLICT DO NOTHING
    `);

    // 5. Drop old constraints and columns
    await queryRunner.query(`
      ALTER TABLE teams DROP CONSTRAINT IF EXISTS "UQ_48e7d8d1fb0b86afebf1c88b57f"
    `);
    await queryRunner.query(`
      ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_name_key
    `);

    await queryRunner.query(`
      ALTER TABLE teams ADD CONSTRAINT uq_teams_project_name UNIQUE (project_id, name)
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_team_id`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS team_id`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_projects_team_id`);
    await queryRunner.query(
      `ALTER TABLE projects DROP CONSTRAINT IF EXISTS fk_projects_team_id`,
    );
    await queryRunner.query(
      `ALTER TABLE projects DROP COLUMN IF EXISTS team_id`,
    );

    await queryRunner.query(`
      DELETE FROM teams WHERE project_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE teams ALTER COLUMN project_id SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE teams ALTER COLUMN project_id DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE teams DROP CONSTRAINT IF EXISTS uq_teams_project_name`,
    );
    await queryRunner.query(
      `ALTER TABLE teams ADD CONSTRAINT teams_name_key UNIQUE (name)`,
    );

    await queryRunner.query(
      `ALTER TABLE projects ADD COLUMN team_id INTEGER`,
    );

    await queryRunner.query(`ALTER TABLE users ADD COLUMN team_id INTEGER`);
    await queryRunner.query(
      `CREATE INDEX idx_users_team_id ON users (team_id)`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS team_members`);
    await queryRunner.query(`DROP TABLE IF EXISTS project_members`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_teams_project_id`);
    await queryRunner.query(
      `ALTER TABLE teams DROP COLUMN IF EXISTS project_id`,
    );
  }
}
