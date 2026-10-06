import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeCompraItemLoteOptional1775344000000
  implements MigrationInterface
{
  name = 'MakeCompraItemLoteOptional1775344000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "compra_items" ALTER COLUMN "lote" DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "compra_items" ALTER COLUMN "fecha_vencimiento" DROP NOT NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'UPDATE "compra_items" SET "lote" = COALESCE("lote", \'SIN-LOTE\')',
    );
    await queryRunner.query(
      'UPDATE "compra_items" SET "fecha_vencimiento" = COALESCE("fecha_vencimiento", CURRENT_DATE)',
    );
    await queryRunner.query(
      'ALTER TABLE "compra_items" ALTER COLUMN "lote" SET NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "compra_items" ALTER COLUMN "fecha_vencimiento" SET NOT NULL',
    );
  }
}
