import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokens1710752600000 implements MigrationInterface {
    name = 'AddRefreshTokens1710752600000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "refresh_tokens" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "token" varchar NOT NULL UNIQUE,
                "user_id" uuid NOT NULL,
                "expires_at" TIMESTAMP NOT NULL,
                "is_revoked" boolean NOT NULL DEFAULT false,
                "created_by_ip" varchar NOT NULL,
                "last_used_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "fk_refresh_token_user_id" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
            )
        `);

        // Add index for token lookup
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_token" ON "refresh_tokens" ("token")
        `);

        // Add index for user lookup
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")
        `);

        // Add index for cleanup of expired tokens
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_expires_at" ON "refresh_tokens" ("expires_at")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_expires_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_user_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_refresh_tokens_token"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    }
}
