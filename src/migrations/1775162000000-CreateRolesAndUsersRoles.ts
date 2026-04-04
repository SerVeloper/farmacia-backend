import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRolesAndUsersRoles1775162000000
  implements MigrationInterface
{
  name = 'CreateRolesAndUsersRoles1775162000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "codigo" character varying(50) NOT NULL,
        "nombre" character varying(120) NOT NULL,
        "activo" boolean NOT NULL DEFAULT true,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roles_codigo" UNIQUE ("codigo")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "users_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_users_roles" PRIMARY KEY ("user_id", "role_id")
      )`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE constraint_name = 'FK_users_roles_user'
            AND table_name = 'users_roles'
        ) THEN
          ALTER TABLE "users_roles"
          ADD CONSTRAINT "FK_users_roles_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$`,
    );

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.table_constraints
          WHERE constraint_name = 'FK_users_roles_role'
            AND table_name = 'users_roles'
        ) THEN
          ALTER TABLE "users_roles"
          ADD CONSTRAINT "FK_users_roles_role"
          FOREIGN KEY ("role_id") REFERENCES "roles"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END
      $$`,
    );

    await queryRunner.query(
      `INSERT INTO "roles" ("codigo", "nombre", "activo") VALUES
        ('administrador', 'Administrador', true),
        ('contador', 'Contador', true),
        ('regente', 'Regente', true),
        ('vendedor', 'Vendedor', true)
      ON CONFLICT ("codigo") DO UPDATE
      SET "nombre" = EXCLUDED."nombre",
          "activo" = true,
          "fecha_actualizacion" = now()`,
    );

    await queryRunner.query(
      `INSERT INTO "users_roles" ("user_id", "role_id")
      SELECT
        u."id" AS "user_id",
        r."id" AS "role_id"
      FROM "users" u
      JOIN "roles" r
        ON r."codigo" = CASE
          WHEN u."rol" = 'admin' THEN 'administrador'
          WHEN u."rol" = 'manager' THEN 'regente'
          WHEN u."rol" = 'cashier' THEN 'vendedor'
        END
      ON CONFLICT ("user_id", "role_id") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users_roles" DROP CONSTRAINT IF EXISTS "FK_users_roles_role"',
    );
    await queryRunner.query(
      'ALTER TABLE "users_roles" DROP CONSTRAINT IF EXISTS "FK_users_roles_user"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "users_roles"');
    await queryRunner.query('DROP TABLE IF EXISTS "roles"');
  }
}
