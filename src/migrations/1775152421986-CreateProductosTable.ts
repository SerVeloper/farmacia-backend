import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProductosTable1775152421986 implements MigrationInterface {
    name = 'CreateProductosTable1775152421986'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "productos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "nombre" character varying(255) NOT NULL, "codigo" character varying(50) NOT NULL, "categoria_id" character varying, "marca_id" character varying, "principio_activo" character varying(255), "unidad" character varying(20) NOT NULL DEFAULT 'pieza', "precio_compra" numeric(10,2) NOT NULL DEFAULT '0', "precio_venta" numeric(10,2) NOT NULL DEFAULT '0', "margen" numeric(5,2) NOT NULL DEFAULT '20', "stock_minimo" integer NOT NULL DEFAULT '0', "stock_maximo" integer NOT NULL DEFAULT '0', "es_controlado" boolean NOT NULL DEFAULT false, "descripcion" text, "activo" boolean NOT NULL DEFAULT true, "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(), "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2da210b34325c2319d784a32d49" UNIQUE ("codigo"), CONSTRAINT "PK_04f604609a0949a7f3b43400766" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "productos"`);
    }

}
