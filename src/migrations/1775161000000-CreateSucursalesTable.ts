import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSucursalesTable1775161000000 implements MigrationInterface {
  name = 'CreateSucursalesTable1775161000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "sucursales" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "codigo" character varying(20) NOT NULL,
        "nombre" character varying(120) NOT NULL,
        "direccion" text,
        "telefono" character varying(30),
        "activo" boolean NOT NULL DEFAULT true,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_sucursales_codigo" UNIQUE ("codigo"),
        CONSTRAINT "UQ_sucursales_nombre" UNIQUE ("nombre"),
        CONSTRAINT "PK_sucursales_id" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'users'
         ) AND NOT EXISTS (
           SELECT 1
           FROM information_schema.table_constraints
           WHERE constraint_name = 'FK_users_sucursal'
             AND table_name = 'users'
         ) THEN
           ALTER TABLE "users"
           ADD CONSTRAINT "FK_users_sucursal"
           FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id")
           ON DELETE SET NULL ON UPDATE NO ACTION;
         END IF;
       END
       $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" DROP CONSTRAINT "FK_users_sucursal"',
    );
    await queryRunner.query('DROP TABLE "sucursales"');
  }
}
