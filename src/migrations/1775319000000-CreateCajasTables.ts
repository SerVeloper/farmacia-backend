import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCajasTables1775319000000 implements MigrationInterface {
  name = 'CreateCajasTables1775319000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'cajas_estado_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."cajas_estado_enum" AS ENUM('abierta', 'cerrada');
        END IF;
      END
      $$`,
    );
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'caja_movimientos_tipo_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."caja_movimientos_tipo_enum" AS ENUM(
            'apertura',
            'venta',
            'ingreso_manual',
            'egreso_manual',
            'cierre',
            'anulacion_venta'
          );
        END IF;
      END
      $$`,
    );
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'caja_movimientos_metodo_pago_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."caja_movimientos_metodo_pago_enum" AS ENUM('efectivo', 'transferencia', 'mixto');
        END IF;
      END
      $$`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cajas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "numero_caja" character varying(40) NOT NULL,
        "sucursal_id" uuid NOT NULL,
        "usuario_apertura_id" uuid NOT NULL,
        "estado" "public"."cajas_estado_enum" NOT NULL DEFAULT 'abierta',
        "fecha_apertura" TIMESTAMP NOT NULL,
        "monto_apertura" numeric(12,2) NOT NULL,
        "fecha_cierre" TIMESTAMP,
        "usuario_cierre_id" uuid,
        "monto_cierre_esperado" numeric(12,2),
        "monto_cierre_real" numeric(12,2),
        "diferencia" numeric(12,2),
        "observacion_cierre" text,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cajas_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cajas_numero" UNIQUE ("numero_caja"),
        CONSTRAINT "FK_cajas_sucursal" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cajas_usuario_apertura" FOREIGN KEY ("usuario_apertura_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cajas_usuario_cierre" FOREIGN KEY ("usuario_cierre_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_cajas_sucursal_estado" ON "cajas" ("sucursal_id", "estado")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_cajas_usuario_estado" ON "cajas" ("usuario_apertura_id", "estado")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cajas_abierta_usuario_sucursal" ON "cajas" ("sucursal_id", "usuario_apertura_id") WHERE "estado" = \'abierta\'',
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "caja_movimientos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "caja_id" uuid NOT NULL,
        "tipo" "public"."caja_movimientos_tipo_enum" NOT NULL,
        "metodo_pago" "public"."caja_movimientos_metodo_pago_enum",
        "numero_venta" character varying(40),
        "detalle" text,
        "monto" numeric(12,2) NOT NULL,
        "usuario_id" uuid NOT NULL,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_caja_movimientos_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_caja_movimientos_caja" FOREIGN KEY ("caja_id") REFERENCES "cajas"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_caja_movimientos_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_caja_movimientos_caja_tipo" ON "caja_movimientos" ("caja_id", "tipo")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_caja_movimientos_usuario_tipo" ON "caja_movimientos" ("usuario_id", "tipo")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_caja_movimientos_usuario_tipo"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_caja_movimientos_caja_tipo"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "caja_movimientos"');

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_cajas_abierta_usuario_sucursal"',
    );
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_cajas_usuario_estado"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_cajas_sucursal_estado"');
    await queryRunner.query('DROP TABLE IF EXISTS "cajas"');

    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."caja_movimientos_metodo_pago_enum"',
    );
    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."caja_movimientos_tipo_enum"',
    );
    await queryRunner.query('DROP TYPE IF EXISTS "public"."cajas_estado_enum"');
  }
}
