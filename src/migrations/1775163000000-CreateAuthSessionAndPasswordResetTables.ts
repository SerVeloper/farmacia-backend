import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSessionAndPasswordResetTables1775163000000
  implements MigrationInterface
{
  name = 'CreateAuthSessionAndPasswordResetTables1775163000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'password_reset_tokens_channel_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."password_reset_tokens_channel_enum" AS ENUM('auto', 'email', 'whatsapp');
        END IF;
      END
      $$`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "auth_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "refresh_token_hash" character varying(128) NOT NULL,
        "family_id" uuid NOT NULL,
        "parent_session_id" uuid,
        "replaced_by_session_id" uuid,
        "remember_me" boolean NOT NULL DEFAULT false,
        "expires_at" TIMESTAMP NOT NULL,
        "revoked_at" TIMESTAMP,
        "last_used_at" TIMESTAMP,
        "ip_address" character varying(45),
        "user_agent" character varying(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auth_sessions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_user_revoked" ON "auth_sessions" ("user_id", "revoked_at")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_auth_sessions_family" ON "auth_sessions" ("family_id")',
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "token_hash" character varying(128) NOT NULL,
        "identifier" character varying(180) NOT NULL,
        "channel" "public"."password_reset_tokens_channel_enum" NOT NULL DEFAULT 'auto',
        "expires_at" TIMESTAMP NOT NULL,
        "used_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_reset_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_password_reset_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_user_used" ON "password_reset_tokens" ("user_id", "used_at")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_hash" ON "password_reset_tokens" ("token_hash")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_password_reset_tokens_hash"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_password_reset_tokens_user_used"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "password_reset_tokens"');

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_auth_sessions_family"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_auth_sessions_user_revoked"');
    await queryRunner.query('DROP TABLE IF EXISTS "auth_sessions"');
    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."password_reset_tokens_channel_enum"',
    );
  }
}
