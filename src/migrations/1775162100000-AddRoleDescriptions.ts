import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleDescriptions1775162100000 implements MigrationInterface {
  name = 'AddRoleDescriptions1775162100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "descripcion" text',
    );

    await queryRunner.query(
      `UPDATE "roles" SET "descripcion" = CASE "codigo"
        WHEN 'administrador' THEN 'Puede gestionar todo el sistema.'
        WHEN 'contador' THEN 'Acceso de solo lectura a contabilidad, reportes e inventario.'
        WHEN 'regente' THEN 'Puede realizar compras, editar inventario y gestionar ventas.'
        WHEN 'vendedor' THEN 'Puede registrar y gestionar ventas.'
        ELSE "descripcion"
      END`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "roles" DROP COLUMN IF EXISTS "descripcion"',
    );
  }
}
