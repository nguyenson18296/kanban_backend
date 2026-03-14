import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParentIdToTasks1741392000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tasks_parent_id ON tasks (parent_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_tasks_parent_id`);
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN parent_id`);
  }
}
