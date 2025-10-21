import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1710752500000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1710752500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add indexes for frequently queried fields
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_status" ON "tasks" ("status")
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_priority" ON "tasks" ("priority")
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_user_id" ON "tasks" ("user_id")
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_created_at" ON "tasks" ("created_at")
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_due_date" ON "tasks" ("due_date")
        `);

    // Composite indexes for common query patterns
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_status_priority" ON "tasks" ("status", "priority")
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_user_status" ON "tasks" ("user_id", "status")
        `);

    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_status_due_date" ON "tasks" ("status", "due_date")
        `);

    // Partial index for overdue tasks (most common query)
    await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tasks_overdue" ON "tasks" ("due_date") 
            WHERE "status" != 'COMPLETED' AND "due_date" < NOW()
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop all indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_priority"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_due_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_status_priority"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_user_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_status_due_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_overdue"`);
  }
}
