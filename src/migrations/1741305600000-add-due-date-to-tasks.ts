import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDueDateToTasks1741305600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tasks ADD COLUMN due_date TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tasks DROP COLUMN due_date`);
  }
}
