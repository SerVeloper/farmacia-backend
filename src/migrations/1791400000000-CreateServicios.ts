import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Crea la tabla `servicios`, catálogo GLOBAL de servicios (ej. "Aplicación
 * de Inyectable").
 *
 * Reglas de dominio: SIN lote, SIN vencimiento, SIN inventario, SIN
 * margen/costo (solo precio de venta). Se escribe a mano (NO migration:generate)
 * porque la DB local está desalineada y el generador produce diffs no
 * relacionados.
 */
export class CreateServicios1791400000000 implements MigrationInterface {
  name = 'CreateServicios1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "servicios" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nombre" character varying(255) NOT NULL,
        "descripcion" text,
        "precio_venta" numeric(12,2) NOT NULL,
        "activo" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_servicios_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_servicios_nombre" UNIQUE ("nombre")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "servicios"');
  }
}