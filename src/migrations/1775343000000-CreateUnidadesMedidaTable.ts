import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUnidadesMedidaTable1775343000000
  implements MigrationInterface
{
  name = 'CreateUnidadesMedidaTable1775343000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "unidades_medida" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "nombre" character varying(100) NOT NULL,
        "abreviatura" character varying(20) NOT NULL,
        "descripcion" text,
        "activo" boolean NOT NULL DEFAULT true,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unidades_medida_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_unidades_medida_nombre" UNIQUE ("nombre"),
        CONSTRAINT "UQ_unidades_medida_abreviatura" UNIQUE ("abreviatura")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "unidades_medida"');
  }
}
