import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewerToProjectRole1787356800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE project_role ADD VALUE IF NOT EXISTS 'viewer'`,
    );
  }

  public async down(): Promise<void> {
    // Removing an enum value requires recreating the type and every column
    // using it; not worth it for a down migration. No-op.
  }
}
