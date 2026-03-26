import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTaskComments1742860800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,
    );
    await queryRunner.query(`
      CREATE TABLE task_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content TEXT NOT NULL,
        is_edited BOOLEAN NOT NULL DEFAULT false,
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_task_comments_task_id ON task_comments (task_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_task_comments_author_id ON task_comments (author_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_task_comments_author_id`);
    await queryRunner.query(`DROP INDEX idx_task_comments_task_id`);
    await queryRunner.query(`DROP TABLE task_comments`);
  }
}
