import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTaskSubscriptions1744000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE task_subscription_source AS ENUM (
        'assigned',
        'mentioned',
        'commented',
        'manual',
        'created'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE task_subscriptions (
        task_id    UUID                     NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id    UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source     task_subscription_source NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ              NOT NULL DEFAULT now(),
        PRIMARY KEY (task_id, user_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_task_subscriptions_user_id ON task_subscriptions (user_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_task_subscriptions_user_id`);
    await queryRunner.query(`DROP TABLE task_subscriptions`);
    await queryRunner.query(`DROP TYPE task_subscription_source`);
  }
}
