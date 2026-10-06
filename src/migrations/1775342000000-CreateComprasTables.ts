import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateComprasTables1775342000000 implements MigrationInterface {
  name = 'CreateComprasTables1775342000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'compras_metodo_pago_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."compras_metodo_pago_enum" AS ENUM('efectivo', 'transferencia', 'mixto');
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
          WHERE t.typname = 'compras_tipo_comprobante_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."compras_tipo_comprobante_enum" AS ENUM('factura', 'nota_venta', 'recibo', 'otro');
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
          WHERE t.typname = 'compra_pagos_metodo_pago_enum' AND n.nspname = 'public'
        ) THEN
          CREATE TYPE "public"."compra_pagos_metodo_pago_enum" AS ENUM('efectivo', 'transferencia');
        END IF;
      END
      $$`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "proveedores" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nombre" character varying(180) NOT NULL,
        "nit" character varying(30),
        "telefono" character varying(30),
        "direccion" text,
        "activo" boolean NOT NULL DEFAULT true,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_proveedores_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_proveedores_nombre" UNIQUE ("nombre")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "compras" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "numero_compra" character varying(50) NOT NULL,
        "sucursal_id" uuid NOT NULL,
        "proveedor_id" uuid NOT NULL,
        "usuario_id" uuid NOT NULL,
        "metodo_pago" "public"."compras_metodo_pago_enum" NOT NULL,
        "tipo_comprobante" "public"."compras_tipo_comprobante_enum" NOT NULL,
        "numero_comprobante" character varying(80) NOT NULL,
        "subtotal" numeric(12,2) NOT NULL,
        "descuento_total" numeric(12,2) NOT NULL,
        "total" numeric(12,2) NOT NULL,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_compras_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_compras_numero" UNIQUE ("numero_compra"),
        CONSTRAINT "FK_compras_sucursal" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_compras_proveedor" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_compras_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_compras_sucursal_fecha" ON "compras" ("sucursal_id", "fecha_creacion")',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_compras_comprobante_proveedor" ON "compras" ("proveedor_id", "tipo_comprobante", "numero_comprobante")',
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "compra_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "compra_id" uuid NOT NULL,
        "producto_id" uuid NOT NULL,
        "nombre_producto" character varying(255) NOT NULL,
        "codigo_producto" character varying(50) NOT NULL,
        "cantidad_compra" integer NOT NULL,
        "unidad_compra" character varying(30) NOT NULL,
        "factor" integer NOT NULL,
        "cantidad_unidades_ingreso" integer NOT NULL,
        "costo_compra_unitario" numeric(12,2) NOT NULL,
        "costo_unitario_resultante" numeric(12,4) NOT NULL,
        "descuento_monto" numeric(12,2) NOT NULL,
        "lote" character varying(60) NOT NULL,
        "fecha_vencimiento" date NOT NULL,
        "margen" numeric(5,2) NOT NULL,
        "precio_venta" numeric(12,2) NOT NULL,
        "subtotal" numeric(12,2) NOT NULL,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_compra_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_compra_items_compra" FOREIGN KEY ("compra_id") REFERENCES "compras"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_compra_items_producto" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_compra_items_compra" ON "compra_items" ("compra_id")',
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "compra_pagos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "compra_id" uuid NOT NULL,
        "metodo_pago" "public"."compra_pagos_metodo_pago_enum" NOT NULL,
        "monto" numeric(12,2) NOT NULL,
        "referencia" character varying(140),
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_compra_pagos_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_compra_pagos_compra" FOREIGN KEY ("compra_id") REFERENCES "compras"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_compra_pagos_compra" ON "compra_pagos" ("compra_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_compra_pagos_compra"');
    await queryRunner.query('DROP TABLE IF EXISTS "compra_pagos"');

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_compra_items_compra"');
    await queryRunner.query('DROP TABLE IF EXISTS "compra_items"');

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_compras_comprobante_proveedor"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_compras_sucursal_fecha"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "compras"');

    await queryRunner.query('DROP TABLE IF EXISTS "proveedores"');

    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."compra_pagos_metodo_pago_enum"',
    );
    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."compras_tipo_comprobante_enum"',
    );
    await queryRunner.query(
      'DROP TYPE IF EXISTS "public"."compras_metodo_pago_enum"',
    );
  }
}
