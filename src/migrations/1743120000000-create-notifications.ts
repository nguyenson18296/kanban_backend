import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotifications1743120000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await queryRunner.query(`
      CREATE TYPE notification_type AS ENUM (
        'comment_created',
        'comment_mentioned',
        'task_assigned',
        'task_updated'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE notifications (
        id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
        type          notification_type NOT NULL,
        recipient_id  UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id      UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        entity_type   VARCHAR(50)       NOT NULL,
        entity_id     UUID              NOT NULL,
        payload       JSONB             NOT NULL DEFAULT '{}',
        is_read       BOOLEAN           NOT NULL DEFAULT false,
        read_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ       NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_notifications_recipient_id ON notifications (recipient_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_notifications_actor_id ON notifications (actor_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_notifications_type ON notifications (type)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_notifications_entity ON notifications (entity_id)`,
    );
    // Composite index for the primary query pattern: unread notifications for a user, newest first
    await queryRunner.query(
      `CREATE INDEX idx_notifications_recipient_unread ON notifications (recipient_id, is_read, created_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_notifications_recipient_unread`);
    await queryRunner.query(`DROP INDEX idx_notifications_entity`);
    await queryRunner.query(`DROP INDEX idx_notifications_type`);
    await queryRunner.query(`DROP INDEX idx_notifications_actor_id`);
    await queryRunner.query(`DROP INDEX idx_notifications_recipient_id`);
    await queryRunner.query(`DROP TABLE notifications`);
    await queryRunner.query(`DROP TYPE notification_type`);
  }
}
