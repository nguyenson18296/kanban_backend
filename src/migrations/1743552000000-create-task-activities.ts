import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTaskActivities1743552000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TYPE task_activity_action AS ENUM (
        'task_created',
        'task_title_updated',
        'task_description_updated',
        'task_status_changed',
        'task_priority_changed',
        'task_due_date_changed',
        'task_assignee_added',
        'task_assignee_removed',
        'task_label_added',
        'task_label_removed',
        'task_moved',
        'task_reordered'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE task_activities (
        id          UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id     UUID                   NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        actor_id    UUID                   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action      task_activity_action   NOT NULL,
        payload     JSONB                  NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ            NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_task_activities_task_id ON task_activities (task_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_task_activities_actor_id ON task_activities (actor_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_task_activities_task_created ON task_activities (task_id, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_task_activities_task_created`);
    await queryRunner.query(`DROP INDEX idx_task_activities_actor_id`);
    await queryRunner.query(`DROP INDEX idx_task_activities_task_id`);
    await queryRunner.query(`DROP TABLE task_activities`);
    await queryRunner.query(`DROP TYPE task_activity_action`);
  }
}
