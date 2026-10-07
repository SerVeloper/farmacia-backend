import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Habilita la venta de servicios en `venta_items`: permite que un item apunte
 * a `servicios.id` (o a `productos.id`) con EXACTAMENTE un origen, y deja
 * `codigo_producto` nullable porque un servicio no tiene código.
 *
 * Debe correr DESPUÉS de `CreateServicios1791400000000` (timestamp mayor).
 * NO usa `migration:generate`: la DB local está desalineada y el generador
 * produciría diffs no relacionados.
 */
export class AddServicioToVentaItem1791400000001
  implements MigrationInterface {
  name = 'AddServicioToVentaItem1791400000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "venta_items" ALTER COLUMN "producto_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_items" ALTER COLUMN "codigo_producto" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_items" ADD COLUMN "servicio_id" uuid NULL REFERENCES "servicios"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_items" ADD CONSTRAINT "CK_venta_items_exactamente_un_origen" CHECK ((producto_id IS NOT NULL AND servicio_id IS NULL) OR (producto_id IS NULL AND servicio_id IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.validarRollbackSeguro(queryRunner);

    await queryRunner.query(
      `ALTER TABLE "venta_items" DROP CONSTRAINT IF EXISTS "CK_venta_items_exactamente_un_origen"`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_items" DROP COLUMN IF EXISTS "servicio_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_items" ALTER COLUMN "producto_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "venta_items" ALTER COLUMN "codigo_producto" SET NOT NULL`,
    );
  }

  /**
   * Revertir es destructivo sobre ventas que ya vendieron servicios (perderían
   * el origen del item y la constraint CHECK). Si hay filas con `servicio_id`,
   * se corta: la vía correcta para deshacer en producción es una migración
   * nueva. Adicionalmente, `SET NOT NULL` de `producto_id`/`codigo_producto`
   * fallaría igual con filas de servicio (Postgres lo impide a nivel DB).
   */
  private async validarRollbackSeguro(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const conServicios = (await queryRunner.query(
      `SELECT COUNT(*)::integer AS "total" FROM "venta_items" WHERE "servicio_id" IS NOT NULL`,
    )) as { total: number }[];

    const total = Number(conServicios?.[0]?.total ?? 0);

    if (total > 0) {
      throw new Error(
        `Rollback bloqueado: ${total} fila(s) de venta_items usan servicios. ` +
          `Revertir perdería el origen de esos items. Para volver atrás, crear ` +
          `una migración nueva que deshaga el cambio en vez de revertir esta.`,
      );
    }
  }
}