import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Elimina el campo es_medicamento de productos.
 *
 * Contexto: el flag no distingue conductas (todo producto exige lote +
 * vencimiento en compras y se asigna FEFO en ventas). La entidad, DTOs,
 * servicios y specs ya no lo referencian. Esta migracion solo elimina la
 * columna que quedo huerfana.
 *
 * NOTA: migration:generate en esta DB produce diffs no relacionados
 * (categoria_id/marca_id uuid->varchar, NOT NULLs, FKs, indices), por lo que
 * esta migracion se escribe a mano con el unico cambio intencional.
 */
export class DropEsMedicamento1791329574256 implements MigrationInterface {
  name = 'DropEsMedicamento1791329574256';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "productos" DROP COLUMN "es_medicamento"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "productos" ADD "es_medicamento" boolean NOT NULL DEFAULT false`,
    );
  }
}
