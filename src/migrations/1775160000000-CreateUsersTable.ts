import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1775160000000 implements MigrationInterface {
  name = 'CreateUsersTable1775160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(
      `CREATE TYPE "public"."users_rol_enum" AS ENUM('admin', 'manager', 'cashier')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nombre" character varying(150) NOT NULL,
        "email" character varying(180) NOT NULL,
        "password_hash" character varying NOT NULL,
        "rol" "public"."users_rol_enum" NOT NULL DEFAULT 'cashier',
        "sucursal_id" uuid,
        "activo" boolean NOT NULL DEFAULT true,
        "ultimo_acceso" TIMESTAMP,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "users"');
    await queryRunner.query('DROP TYPE "public"."users_rol_enum"');
  }
}
