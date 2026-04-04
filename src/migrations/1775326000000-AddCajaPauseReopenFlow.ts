import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCajaPauseReopenFlow1775326000000
  implements MigrationInterface
{
  name = 'AddCajaPauseReopenFlow1775326000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TYPE \"public\".\"cajas_estado_enum\" ADD VALUE IF NOT EXISTS 'pausada'",
    );
    await queryRunner.query(
      "ALTER TYPE \"public\".\"caja_movimientos_tipo_enum\" ADD VALUE IF NOT EXISTS 'pausa'",
    );
    await queryRunner.query(
      "ALTER TYPE \"public\".\"caja_movimientos_tipo_enum\" ADD VALUE IF NOT EXISTS 'reapertura'",
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_cajas_abierta_usuario_sucursal"',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cajas_abierta_usuario_sucursal" ON "cajas" ("sucursal_id", "usuario_apertura_id") WHERE "estado" <> \'cerrada\'',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_cajas_abierta_usuario_sucursal"',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cajas_abierta_usuario_sucursal" ON "cajas" ("sucursal_id", "usuario_apertura_id") WHERE "estado" = \'abierta\'',
    );
  }
}
