import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVentasAndInventarioTables1775332000000
  implements MigrationInterface
{
  name = 'CreateVentasAndInventarioTables1775332000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'ventas_estado_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."ventas_estado_enum" AS ENUM('confirmada');
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
          WHERE t.typname = 'venta_pagos_metodo_pago_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."venta_pagos_metodo_pago_enum" AS ENUM('efectivo', 'transferencia');
        END IF;
      END
      $$`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "inventario_sucursal" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sucursal_id" uuid NOT NULL,
        "producto_id" uuid NOT NULL,
        "stock_actual" integer NOT NULL DEFAULT 0,
        "stock_minimo" integer NOT NULL DEFAULT 0,
        "stock_maximo" integer NOT NULL DEFAULT 0,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventario_sucursal_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_inventario_sucursal_sucursal" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_inventario_sucursal_producto" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_inventario_sucursal_producto" ON "inventario_sucursal" ("sucursal_id", "producto_id")',
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ventas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "numero_venta" character varying(50) NOT NULL,
        "sucursal_id" uuid NOT NULL,
        "caja_id" uuid NOT NULL,
        "vendedor_id" uuid NOT NULL,
        "subtotal" numeric(12,2) NOT NULL,
        "descuento_total" numeric(12,2) NOT NULL,
        "total" numeric(12,2) NOT NULL,
        "estado" "public"."ventas_estado_enum" NOT NULL DEFAULT 'confirmada',
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ventas_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ventas_numero" UNIQUE ("numero_venta"),
        CONSTRAINT "FK_ventas_sucursal" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ventas_caja" FOREIGN KEY ("caja_id") REFERENCES "cajas"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ventas_vendedor" FOREIGN KEY ("vendedor_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_ventas_sucursal_fecha" ON "ventas" ("sucursal_id", "fecha_creacion")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_ventas_vendedor_fecha" ON "ventas" ("vendedor_id", "fecha_creacion")',
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "venta_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "venta_id" uuid NOT NULL,
        "producto_id" uuid NOT NULL,
        "cantidad" integer NOT NULL,
        "precio_unitario" numeric(12,2) NOT NULL,
        "descuento_monto" numeric(12,2) NOT NULL DEFAULT 0,
        "subtotal" numeric(12,2) NOT NULL,
        "nombre_producto" character varying(255) NOT NULL,
        "codigo_producto" character varying(50) NOT NULL,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_venta_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_venta_items_venta" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_venta_items_producto" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_venta_items_venta" ON "venta_items" ("venta_id")',
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "venta_pagos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "venta_id" uuid NOT NULL,
        "metodo_pago" "public"."venta_pagos_metodo_pago_enum" NOT NULL,
        "monto" numeric(12,2) NOT NULL,
        "referencia" character varying(140),
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_venta_pagos_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_venta_pagos_venta" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_venta_pagos_venta" ON "venta_pagos" ("venta_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_venta_pagos_venta"');
    await queryRunner.query('DROP TABLE IF EXISTS "venta_pagos"');

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_venta_items_venta"');
    await queryRunner.query('DROP TABLE IF EXISTS "venta_items"');

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_ventas_vendedor_fecha"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_ventas_sucursal_fecha"');
    await queryRunner.query('DROP TABLE IF EXISTS "ventas"');

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_inventario_sucursal_producto"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "inventario_sucursal"');

    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."venta_pagos_metodo_pago_enum"',
    );
    await queryRunner.query('DROP TYPE IF EXISTS "public"."ventas_estado_enum"');
  }
}
