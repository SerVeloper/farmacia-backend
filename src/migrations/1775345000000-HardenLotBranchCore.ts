import { MigrationInterface, QueryRunner } from 'typeorm';

const LOTE_INVALIDO_UUID =
  'SELECT l.id, l.producto_id FROM "lotes_productos" l WHERE l.producto_id IS NULL OR btrim(l.producto_id) = \'\'' +
  " OR l.producto_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' LIMIT 20";

const LOTE_HUERFANO =
  'SELECT l.id, l.producto_id FROM "lotes_productos" l LEFT JOIN "productos" p ON p.id = l.producto_id::uuid WHERE p.id IS NULL LIMIT 20';

const LOTE_INVALIDO =
  'SELECT l.id, l."numeroLote", l.fecha_vencimiento FROM "lotes_productos" l WHERE l."numeroLote" IS NULL OR btrim(l."numeroLote") = \'\'' +
  ' OR l.fecha_vencimiento IS NULL LIMIT 20';

const LOTE_COLISION =
  'SELECT l.producto_id::uuid AS producto_id, upper(btrim(l."numeroLote")) AS numero_normalizado, l.fecha_vencimiento, COUNT(*) AS total' +
  ' FROM "lotes_productos" l GROUP BY l.producto_id::uuid, upper(btrim(l."numeroLote")), l.fecha_vencimiento' +
  ' HAVING COUNT(*) > 1 LIMIT 20';

const TABLAS_NUEVAS = [
  'inventario_lote_sucursal',
  'venta_item_lotes',
  'reconciliacion_lote',
  'correlativo_diario',
];

const COLUMNAS_NUEVAS = {
  productos: ['es_medicamento'],
  lotes_productos: ['numero_lote_normalizado'],
};

const TABLAS_CON_INDICE = [
  'lotes_productos',
  'inventario_lote_sucursal',
  'venta_item_lotes',
  'reconciliacion_lote',
  'correlativo_diario',
];

const INDICES_NUEVOS = [
  'UQ_lotes_identidad',
  'UQ_inventario_lote_sucursal',
  'IDX_inventario_lote_sucursal_lote',
  'UQ_venta_item_lotes_item_lote',
  'IDX_venta_item_lotes_lote',
  'IDX_reconciliacion_lote_sucursal_producto',
  'UQ_correlativo_diario_fecha_tipo_sucursal',
];

/** Tablas que empiezan a recibir escrituras operativas apenas se migra. */
const TABLAS_OPERATIVAS = [
  'correlativo_diario',
  'venta_item_lotes',
  'inventario_lote_sucursal',
  'reconciliacion_lote',
];

export class HardenLotBranchCore1775345000000 implements MigrationInterface {
  name = 'HardenLotBranchCore1775345000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.validarEsquemaPreexistente(queryRunner);
    await this.validarLotesLegados(queryRunner);

    await this.agregarEsMedicamento(queryRunner);
    await this.endurecerIdentidadLote(queryRunner);
    await this.crearInventarioLoteSucursal(queryRunner);
    await this.crearVentaItemLotes(queryRunner);
    await this.crearReconciliacionLote(queryRunner);
    await this.crearCorrelativoDiario(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.validarRollbackSeguro(queryRunner);

    await queryRunner.query('DROP TABLE IF EXISTS "correlativo_diario"');
    await queryRunner.query('DROP TABLE IF EXISTS "reconciliacion_lote"');
    await queryRunner.query('DROP TABLE IF EXISTS "venta_item_lotes"');
    await queryRunner.query('DROP TABLE IF EXISTS "inventario_lote_sucursal"');

    await queryRunner.query('DROP INDEX IF EXISTS "UQ_lotes_identidad"');
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" DROP CONSTRAINT IF EXISTS "CHK_lotes_numero_normalizado"',
    );
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" DROP COLUMN IF EXISTS "numero_lote_normalizado"',
    );
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" DROP CONSTRAINT IF EXISTS "FK_lotes_productos_producto"',
    );
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" ALTER COLUMN "producto_id" TYPE character varying USING "producto_id"::text',
    );
    await queryRunner.query(
      'ALTER TABLE "productos" DROP COLUMN IF EXISTS "es_medicamento"',
    );
  }

  /**
   * Sin `IF NOT EXISTS`: si el objeto ya existe la migracion no puede afirmar que
   * su `down` lo revierte, y adoptar esquema ajeno termina en un rollback que
   * borra tablas de otro. Es mas honesto abortar y que un humano resuelva.
   */
  private async validarEsquemaPreexistente(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const tablas = (await queryRunner.query(
      `SELECT "table_name" FROM "information_schema"."tables" WHERE "table_schema" = current_schema() AND "table_name" = ANY($1::text[])`,
      [TABLAS_NUEVAS],
    )) as { table_name: string }[];

    const columnas = (await queryRunner.query(
      `SELECT "table_name", "column_name" FROM "information_schema"."columns" WHERE "table_schema" = current_schema() AND "table_name" = ANY($1::text[]) AND "column_name" = ANY($2::text[])`,
      [Object.keys(COLUMNAS_NUEVAS), Object.values(COLUMNAS_NUEVAS).flat()],
    )) as { table_name: string; column_name: string }[];

    const indices = (await queryRunner.query(
      `SELECT "tablename", "indexname" FROM "pg_indexes" WHERE "schemaname" = current_schema() AND "tablename" = ANY($1::text[]) AND "indexname" = ANY($2::text[])`,
      [TABLAS_CON_INDICE, INDICES_NUEVOS],
    )) as { tablename: string; indexname: string }[];

    const conflictos = [
      ...(tablas ?? []).map((fila) => `tabla "${fila.table_name}"`),
      ...(columnas ?? []).map(
        (fila) => `columna "${fila.table_name}.${fila.column_name}"`,
      ),
      ...(indices ?? []).map(
        (fila) => `indice "${fila.tablename}.${fila.indexname}"`,
      ),
    ];

    if (conflictos.length === 0) {
      return;
    }

    throw new Error(
      `Migracion abortada: el esquema ya existe con ${conflictos.length} objeto(s) ` +
        `que esta migracion crearia: ${conflictos.join(', ')}. No se usa ` +
        `IF NOT EXISTS porque el down solo puede revertir lo que el up creo: ` +
        `revertir borraria esquema preexisting ajeno. Resolver el conflicto ` +
        `manualmente y reintentar.`,
    );
  }

  /**
   * El rollback es destructivo sobre datos ya operados (correlativos emitidos,
   * saldos y asignaciones de lote). Si hay escrituras, se corta: la via correcta
   * para deshacer una migracion en produccion es una migracion nueva.
   */
  private async validarRollbackSeguro(queryRunner: QueryRunner): Promise<void> {
    const catalogo = (await queryRunner.query(
      `SELECT "table_name" FROM "information_schema"."tables" WHERE "table_schema" = current_schema() AND "table_name" = ANY($1::text[])`,
      [TABLAS_OPERATIVAS],
    )) as { table_name: string }[];

    const existentes = new Set((catalogo ?? []).map((fila) => fila.table_name));
    const conEscrituras: string[] = [];

    for (const tabla of TABLAS_OPERATIVAS) {
      if (!existentes.has(tabla)) {
        continue;
      }

      // Identificador seguro: recorre TABLAS_OPERATIVAS, nunca datos de entrada.
      const conteo = (await queryRunner.query(
        `SELECT COUNT(*)::integer AS "total" FROM "${tabla}"`,
      )) as { total: number }[];

      const total = Number(conteo?.[0]?.total ?? 0);

      if (total > 0) {
        conEscrituras.push(`${tabla} (${total} filas)`);
      }
    }

    if (conEscrituras.length === 0) {
      return;
    }

    throw new Error(
      `Rollback bloqueado: la migracion HardenLotBranchCore ya tiene escrituras ` +
        `operativas y su down las destruiria: ${conEscrituras.join(', ')}. ` +
        `Revertir perderia correlativos emitidos, saldos por sucursal y ` +
        `asignaciones de lote ya usados en la operacion. Para volver atras, ` +
        `crear una migracion nueva que deshaga el cambio en vez de revertir esta.`,
    );
  }

  private async validarLotesLegados(queryRunner: QueryRunner): Promise<void> {
    const invalidosUuid = (await queryRunner.query(LOTE_INVALIDO_UUID)) as {
      id: string;
      producto_id: string;
    }[];

    if (invalidosUuid.length > 0) {
      throw new Error(
        `Migracion abortada: producto_id no es un UUID valido en lotes_productos ` +
          `(${invalidosUuid.length}+ filas). Corregir estos datos manualmente y reintentar: ` +
          invalidosUuid
            .map((fila) => `[lote ${fila.id} -> ${fila.producto_id}]`)
            .join(', '),
      );
    }

    const huerfanos = (await queryRunner.query(LOTE_HUERFANO)) as {
      id: string;
      producto_id: string;
    }[];

    if (huerfanos.length > 0) {
      throw new Error(
        `Migracion abortada: lotes_productos referencia un producto inexistente ` +
          `(${huerfanos.length}+ filas). Corregir o regularizar la relacion antes de migrar: ` +
          huerfanos
            .map((fila) => `[lote ${fila.id} -> producto ${fila.producto_id}]`)
            .join(', '),
      );
    }

    const invalidos = (await queryRunner.query(LOTE_INVALIDO)) as {
      id: string;
      numeroLote: string;
      fecha_vencimiento: string;
    }[];

    if (invalidos.length > 0) {
      throw new Error(
        `Migracion abortada: numero de lote vacio o fecha de vencimiento nula en ` +
          `lotes_productos (${invalidos.length}+ filas). Completar los datos manualmente: ` +
          invalidos
            .map(
              (fila) =>
                `[lote ${fila.id} -> numero "${fila.numeroLote}", vencimiento ${fila.fecha_vencimiento}]`,
            )
            .join(', '),
      );
    }

    const colisiones = (await queryRunner.query(LOTE_COLISION)) as {
      producto_id: string;
      numero_normalizado: string;
      fecha_vencimiento: string;
      total: number;
    }[];

    if (colisiones.length > 0) {
      throw new Error(
        `Migracion abortada: colision de identidad triple (producto, numero de lote ` +
          `normalizado, fecha de vencimiento) al crear el indice unico ` +
          `UQ_lotes_identidad (${colisiones.length}+ grupos). La migracion no fusiona ni ` +
          `borra lotes: resolver manualmente cada grupo: ` +
          colisiones
            .map(
              (fila) =>
                `[producto ${fila.producto_id}, lote ${fila.numero_normalizado}, ` +
                `vencimiento ${fila.fecha_vencimiento}, filas ${fila.total}]`,
            )
            .join(', '),
      );
    }
  }

  private async agregarEsMedicamento(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "productos" ADD COLUMN "es_medicamento" boolean NOT NULL DEFAULT false',
    );
  }

  private async endurecerIdentidadLote(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" ADD COLUMN "numero_lote_normalizado" character varying(50)',
    );
    await queryRunner.query(
      'UPDATE "lotes_productos" SET "numero_lote_normalizado" = upper(btrim("numeroLote")) WHERE "numero_lote_normalizado" IS NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" ALTER COLUMN "numero_lote_normalizado" SET NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" ADD CONSTRAINT "CHK_lotes_numero_normalizado" CHECK ("numero_lote_normalizado" = upper(btrim("numeroLote")))',
    );
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" ALTER COLUMN "producto_id" TYPE uuid USING "producto_id"::uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "lotes_productos" ADD CONSTRAINT "FK_lotes_productos_producto" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_lotes_identidad" ON "lotes_productos" ("producto_id", "numero_lote_normalizado", "fecha_vencimiento")',
    );
  }

  private async crearInventarioLoteSucursal(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "inventario_lote_sucursal" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sucursal_id" uuid NOT NULL,
        "lote_id" uuid NOT NULL,
        "cantidad" integer NOT NULL DEFAULT 0,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventario_lote_sucursal_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_inventario_lote_sucursal_cantidad" CHECK ("cantidad" >= 0),
        CONSTRAINT "FK_inventario_lote_sucursal_sucursal" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_inventario_lote_sucursal_lote" FOREIGN KEY ("lote_id") REFERENCES "lotes_productos"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_inventario_lote_sucursal" ON "inventario_lote_sucursal" ("sucursal_id", "lote_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_inventario_lote_sucursal_lote" ON "inventario_lote_sucursal" ("lote_id")',
    );
  }

  private async crearVentaItemLotes(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "venta_item_lotes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "venta_item_id" uuid NOT NULL,
        "lote_id" uuid NOT NULL,
        "cantidad" integer NOT NULL,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_venta_item_lotes_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_venta_item_lotes_cantidad" CHECK ("cantidad" > 0),
        CONSTRAINT "FK_venta_item_lotes_venta_item" FOREIGN KEY ("venta_item_id") REFERENCES "venta_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_venta_item_lotes_lote" FOREIGN KEY ("lote_id") REFERENCES "lotes_productos"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_venta_item_lotes_item_lote" ON "venta_item_lotes" ("venta_item_id", "lote_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_venta_item_lotes_lote" ON "venta_item_lotes" ("lote_id")',
    );
  }

  private async crearReconciliacionLote(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "reconciliacion_lote" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sucursal_id" uuid NOT NULL,
        "producto_id" uuid NOT NULL,
        "lote_id" uuid,
        "cantidad_antes" integer NOT NULL,
        "cantidad_despues" integer NOT NULL,
        "motivo" text NOT NULL,
        "usuario_id" uuid,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliacion_lote_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reconciliacion_lote_sucursal" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reconciliacion_lote_producto" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reconciliacion_lote_lote" FOREIGN KEY ("lote_id") REFERENCES "lotes_productos"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reconciliacion_lote_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_reconciliacion_lote_sucursal_producto" ON "reconciliacion_lote" ("sucursal_id", "producto_id")',
    );
  }

  private async crearCorrelativoDiario(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "correlativo_diario" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fecha" date NOT NULL,
        "tipo" character varying(20) NOT NULL,
        "sucursal_id" uuid,
        "secuencia" integer NOT NULL DEFAULT 1,
        "fecha_creacion" TIMESTAMP NOT NULL DEFAULT now(),
        "fecha_actualizacion" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_correlativo_diario_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_correlativo_diario_tipo" CHECK ("tipo" IN ('compra', 'venta', 'caja')),
        CONSTRAINT "CHK_correlativo_diario_secuencia" CHECK ("secuencia" > 0),
        CONSTRAINT "CHK_correlativo_diario_caja_global" CHECK (("tipo" = 'caja' AND "sucursal_id" IS NULL) OR ("tipo" <> 'caja' AND "sucursal_id" IS NOT NULL)),
        CONSTRAINT "FK_correlativo_diario_sucursal" FOREIGN KEY ("sucursal_id") REFERENCES "sucursales"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_correlativo_diario_fecha_tipo_sucursal" ON "correlativo_diario" ("fecha", "tipo", COALESCE("sucursal_id", '00000000-0000-0000-0000-000000000000'::uuid))`,
    );
  }
}
