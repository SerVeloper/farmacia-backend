/**
 * HARNESS DE INTEGRACION POSTGRESQL AISLADO PARA EL NUCLEO DE LOTES/SUCURSAL
 * =========================================================================
 *
 * Que es y que NO es:
 *   - Es un arnes reproducible: levanta su PROPIO cluster PostgreSQL efimero,
 *     aplica la cadena REAL de migraciones del proyecto y ejercita los servicios
 *     REALES contra el driver REAL (pg) con el `EntityManager` REAL de TypeORM.
 *   - NO usa adaptadores de filas ni tuplas simuladas: si el servicio presupone
 *     una forma de fila que el driver no devuelve, el test falla (que es el punto).
 *   - NO toca ninguna base existente: cluster nuevo, base nueva, socket unix
 *     privado, puerto no default, sin TCP, todo dentro de un temporal disposable.
 *
 * Aislamiento (requisitos duros del harness):
 *   - Directorio: mkdtemp bajo /tmp/opencode (o el temporal del SO si no existe).
 *     NUNCA dentro del repositorio ni junto al .env del proyecto.
 *   - Puerto: no default y sobreescribible con LOT_CORE_PG_PORT.
 *   - `listen_addresses = ''` -> no escucha TCP; el unico canal es el socket unix.
 *   - pg_hba: `local ... trust` y `host ... reject`.
 *   - El cluster se detiene SIEMPRE (try/finally), incluso si un test revienta.
 *   - Preserva el contenido de toda base normal: no connects al 5432 ni al .env.
 *
 * Prerrequisitos: si se corre como root o faltan binarios, TODOS los tests se
 * marcan como omitidos con el motivo exacto. El harness no instala nada.
 *
 * Ejecutar: npm run test:lot-core:postgres
 */

import 'reflect-metadata';

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { VentasService } from '../src/modules/ventas/application/services/ventas.service';
import { CajasService } from '../src/modules/cajas/application/services/cajas.service';
import { Caja, CajaEstado } from '../src/modules/cajas/domain/entities/caja.entity';
import { CajaMovimiento } from '../src/modules/cajas/domain/entities/caja-movimiento.entity';
import { Venta } from '../src/modules/ventas/domain/entities/venta.entity';
import { VentaItem } from '../src/modules/ventas/domain/entities/venta-item.entity';
import { VentaItemLote } from '../src/modules/ventas/domain/entities/venta-item-lote.entity';
import { VentaPago, VentaMetodoPago } from '../src/modules/ventas/domain/entities/venta-pago.entity';
import { InventarioSucursal } from '../src/modules/ventas/domain/entities/inventario-sucursal.entity';
import { Producto } from '../src/modules/productos/domain/entities/producto.entity';
import { ProductosService } from '../src/modules/productos/application/services/productos.service';
import { Servicio } from '../src/modules/servicios/domain/entities/servicio.entity';
import { ServiciosService } from '../src/modules/servicios/application/services/servicios.service';
import { UsersService } from '../src/modules/users/application/services/users.service';
import { SucursalesService } from '../src/modules/sucursales/application/services/sucursales.service';
import { RoleCode } from '../src/modules/users/domain/entities/role.entity';
import { ExpiryAlertsService } from '../src/modules/lotes/application/services/expiry-alerts.service';

import {
  CorrelativosService,
  CorrelativoTipo,
  formatearNumeroCorrelativo,
} from '../src/common/correlativos/correlativos.service';

// Cadena base COMPLETA del proyecto, en orden de timestamp. Hardcodeada a mano
// (no glob) para que el harness sea determinista y no dependa de `dist`.
import { CreateCategoriasMarcasLotes1775151661067 } from '../src/migrations/1775151661067-CreateCategoriasMarcasLotes';
import { CreateProductosTable1775152421986 } from '../src/migrations/1775152421986-CreateProductosTable';
import { CreateUsersTable1775160000000 } from '../src/migrations/1775160000000-CreateUsersTable';
import { CreateSucursalesTable1775161000000 } from '../src/migrations/1775161000000-CreateSucursalesTable';
import { CreateRolesAndUsersRoles1775162000000 } from '../src/migrations/1775162000000-CreateRolesAndUsersRoles';
import { AddRoleDescriptions1775162100000 } from '../src/migrations/1775162100000-AddRoleDescriptions';
import { CreateAuthSessionAndPasswordResetTables1775163000000 } from '../src/migrations/1775163000000-CreateAuthSessionAndPasswordResetTables';
import { CreateCajasTables1775319000000 } from '../src/migrations/1775319000000-CreateCajasTables';
import { AddCajaPauseReopenFlow1775326000000 } from '../src/migrations/1775326000000-AddCajaPauseReopenFlow';
import { CreateVentasAndInventarioTables1775332000000 } from '../src/migrations/1775332000000-CreateVentasAndInventarioTables';
import { CreateComprasTables1775342000000 } from '../src/migrations/1775342000000-CreateComprasTables';
import { CreateUnidadesMedidaTable1775343000000 } from '../src/migrations/1775343000000-CreateUnidadesMedidaTable';
import { MakeCompraItemLoteOptional1775344000000 } from '../src/migrations/1775344000000-MakeCompraItemLoteOptional';
import { HardenLotBranchCore1775345000000 } from '../src/migrations/1775345000000-HardenLotBranchCore';

import { LotStockService } from '../src/modules/lotes/application/services/lot-stock.service';

// ---------------------------------------------------------------------------
// Prerrequisitos
// ---------------------------------------------------------------------------

const RUTOS_BINARIOS = [
  '/usr/bin',
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/local/pgsql/bin',
  '/opt/homebrew/opt/postgresql@18/bin',
];

const PUERTO_POR_DEFECTO = Number(process.env.LOT_CORE_PG_PORT ?? 55443);
const BASE_DATOS_PRINCIPAL = 'farmacia_lot_core_postgres';
const BASE_DATOS_LEGADA = 'farmacia_lot_core_legado';
const TIMEOUT_ARRANQUE_MS = 30_000;

interface Prerrequisitos {
  ok: boolean;
  motivos: string[];
  initdb: string | null;
  pgCtl: string | null;
  postgres: string | null;
  baseTemporal: string;
}

function resolverBinario(nombre: string): string | null {
  for (const directorio of RUTOS_BINARIOS) {
    const candidato = path.join(directorio, nombre);
    try {
      fs.accessSync(candidato, fs.constants.X_OK);
      return candidato;
    } catch {
      // siguiente directorio
    }
  }
  return null;
}

function baseTemporalValida(): { base: string | null; motivo: string | null } {
  const candidatos = ['/tmp/opencode', os.tmpdir()].filter(
    (valor, indice, lista) => lista.indexOf(valor) === indice,
  );
  for (const base of candidatos) {
    try {
      fs.mkdirSync(base, { recursive: true });
      fs.accessSync(base, fs.constants.W_OK);
      return { base, motivo: null };
    } catch {
      // siguiente candidato
    }
  }
  return {
    base: null,
    motivo: `no hay directorio temporal escribible (probados: ${candidatos.join(', ')})`,
  };
}

function evaluarPrerrequisitos(): Prerrequisitos {
  const motivos: string[] = [];
  const initdb = resolverBinario('initdb');
  const pgCtl = resolverBinario('pg_ctl');
  const postgres = resolverBinario('postgres');

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    motivos.push(
      'el proceso corre como root: PostgreSQL rechaza arrancar el cluster como root',
    );
  }

  for (const [nombre, ruta] of [
    ['initdb', initdb],
    ['pg_ctl', pgCtl],
    ['postgres', postgres],
  ] as const) {
    if (!ruta) {
      motivos.push(
        `binario "${nombre}" no encontrado en ${RUTOS_BINARIOS.join(', ')} (el harness no instala nada)`,
      );
    }
  }

  const { base, motivo: motivoBase } = baseTemporalValida();
  if (!base) {
    motivos.push(String(motivoBase));
  }

  return { ok: motivos.length === 0, motivos, initdb, pgCtl, postgres, baseTemporal: base ?? '' };
}

const prerrequisitos = evaluarPrerrequisitos();

const COLA_PRERREQUISITOS: string[] = prerrequisitos.motivos;

// ---------------------------------------------------------------------------
// Ciclo de vida del cluster aislado
// ---------------------------------------------------------------------------

class ClusterAislado {
  private iniciado = false;

  constructor(
    private readonly base: string,
    private readonly initdb: string,
    private readonly pgCtl: string,
    private readonly puerto: number,
  ) {}

  get directorioDatos(): string {
    return path.join(this.base, 'data');
  }

  get directorioSocket(): string {
    return path.join(this.base, 'socket');
  }

  get socket(): string {
    return this.directorioSocket;
  }

  iniciar(): void {
    fs.mkdirSync(this.directorioSocket, { recursive: true });

    this.ejecutar(this.initdb, [
      '-D',
      this.directorioDatos,
      '-U',
      usuarioActual(),
      '-A',
      'trust',
      '--encoding=UTF8',
      '--locale=C',
    ]);

    // Socket unix privado, puerto no default y CERO TCP.
    fs.appendFileSync(
      path.join(this.directorioDatos, 'postgresql.conf'),
      [
        '',
        `port = ${this.puerto}`,
        "listen_addresses = ''",
        `unix_socket_directories = '${this.directorioSocket}'`,
        'fsync = off',
        'full_page_writes = off',
        'synchronous_commit = off',
        'max_connections = 40',
        '',
      ].join('\n'),
    );

    // Canal local confiado, cualquier host rechazado.
    fs.writeFileSync(
      path.join(this.directorioDatos, 'pg_hba.conf'),
      [
        'local all all trust',
        'host all all 127.0.0.1/32 reject',
        'host all all ::1/128 reject',
        'host all all 0.0.0.0/0 reject',
        'host all all ::/0 reject',
        '',
      ].join('\n'),
    );

    this.ejecutar(this.pgCtl, [
      '-D',
      this.directorioDatos,
      '-l',
      path.join(this.base, 'postgres.log'),
      '-w',
      '-t',
      String(TIMEOUT_ARRANQUE_MS / 1000),
      'start',
    ]);

    this.iniciado = true;
  }

  detener(): void {
    if (!this.iniciado) {
      return;
    }
    this.ejecutar(this.pgCtl, ['-D', this.directorioDatos, '-m', 'fast', '-w', 'stop']);
    this.iniciado = false;
  }

  leerLog(): string {
    try {
      return fs.readFileSync(path.join(this.base, 'postgres.log'), 'utf8');
    } catch {
      return '(sin log)';
    }
  }

  private ejecutar(binario: string, argumentos: string[]): void {
    execFileSync(binario, argumentos, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
    });
  }
}

function usuarioActual(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? 'postgres';
  }
}

// ---------------------------------------------------------------------------
// Helpers de conexion
// ---------------------------------------------------------------------------

function crearDataSource(baseDatos: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host: cluster!.socket,
    port: puerto,
    username: usuarioActual(),
    database: baseDatos,
    synchronize: false,
    logging: false,
    entities: [path.join(__dirname, '../src/modules/**/domain/entities/*.entity.ts')],
    migrations: MIGRACIONES_BASE,
  });
}

async function crearBaseDeDatos(nombre: string): Promise<void> {
  const admin = crearDataSource('postgres');
  await admin.initialize();
  try {
    await admin.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await admin.destroy();
  }
}

const MIGRACIONES_BASE = [
  CreateCategoriasMarcasLotes1775151661067,
  CreateProductosTable1775152421986,
  CreateUsersTable1775160000000,
  CreateSucursalesTable1775161000000,
  CreateRolesAndUsersRoles1775162000000,
  AddRoleDescriptions1775162100000,
  CreateAuthSessionAndPasswordResetTables1775163000000,
  CreateCajasTables1775319000000,
  AddCajaPauseReopenFlow1775326000000,
  CreateVentasAndInventarioTables1775332000000,
  CreateComprasTables1775342000000,
  CreateUnidadesMedidaTable1775343000000,
  MakeCompraItemLoteOptional1775344000000,
];

// ---------------------------------------------------------------------------
// Estado compartido
// ---------------------------------------------------------------------------

jest.setTimeout(300_000);

const MIGRACION = new HardenLotBranchCore1775345000000();

let cluster: ClusterAislado | null = null;
let baseTemporal = '';
let puerto = PUERTO_POR_DEFECTO;
let ds: DataSource;
let stock: LotStockService;

const sucursalA = '11111111-1111-4111-8111-111111111111';
const sucursalB = '22222222-2222-4222-8222-222222222222';
const usuario = '33333333-3333-4333-8333-333333333333';

/** Fotografia del esquema legado, tomada ANTES de aplicar la migracion. */
interface FotografiaLegado {
  productoId: { dataType: string; udtName: string };
  columnasLotes: string[];
  numeroLote: { dataType: string; udtName: string; characterMaximumLength: number | null };
  columnasProductos: string[];
}

let legado: FotografiaLegado;

/** Detalle de catalogo post-migracion, para aserciones de quoting/casts. */
interface DetalleColumna {
  tableName: string;
  columnName: string;
  dataType: string;
  udtName: string;
  characterMaximumLength: number | null;
}

async function columnasDe(tabla: string): Promise<DetalleColumna[]> {
  return (await ds.query(
    `SELECT "table_name" AS "tableName", "column_name" AS "columnName",
            "data_type" AS "dataType", "udt_name" AS "udtName",
            "character_maximum_length"::integer AS "characterMaximumLength"
       FROM "information_schema"."columns"
      WHERE "table_schema" = current_schema() AND "table_name" = $1
      ORDER BY "column_name" ASC`,
    [tabla],
  )) as DetalleColumna[];
}

async function existeObjeto(tipo: 'table' | 'index', nombre: string): Promise<boolean> {
  const filas = await ds.query(
    tipo === 'table'
      ? `SELECT to_regclass(current_schema() || '.' || $1) IS NOT NULL AS ok`
      : `SELECT to_regclass(current_schema() || '.' || $1) IS NOT NULL AS ok`,
    [nombre],
  );
  return filas[0]?.ok === true;
}

async function aplicarMigracionEnTransaccion(dataSource: DataSource): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.startTransaction();
    await MIGRACION.up(queryRunner);
    await queryRunner.commitTransaction();
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw error;
  } finally {
    await queryRunner.release();
  }
}

async function crearProducto(codigo: string): Promise<string> {
  const filas = await ds.query(
    `INSERT INTO "productos" ("nombre", "codigo") VALUES ($1, $2) RETURNING "id"`,
    [`Producto ${codigo}`, `P-${codigo}`],
  );
  return filas[0].id as string;
}

async function nombreDeLote(id: string): Promise<string> {
  const filas = await ds.query(
    `SELECT "numero_lote_normalizado" FROM "lotes_productos" WHERE "id" = $1`,
    [id],
  );
  return filas[0].numero_lote_normalizado as string;
}

async function saldosDe(productoId: string): Promise<Record<string, number>> {
  const filas = await ds.query(
    `SELECT l."numero_lote_normalizado" AS lote, ils."cantidad"::integer AS cantidad
       FROM "inventario_lote_sucursal" ils
       INNER JOIN "lotes_productos" l ON l."id" = ils."lote_id"
      WHERE ils."sucursal_id" = ANY($1::uuid[]) AND l."producto_id" = $2
      ORDER BY l."numero_lote_normalizado" ASC`,
    [[sucursalA, sucursalB], productoId],
  );
  const mapa: Record<string, number> = {};
  for (const fila of filas) {
    mapa[`${fila.lote}`] = Number(fila.cantidad);
  }
  return mapa;
}

/**
 * `fecha_vencimiento` es `date`: el driver puede devolverla como string ISO o como
 * Date en UTC. El calendario es lo que el dominio garantiza, asi que se compara
 * el dia, no el tipo. Si el servicio devuelve un valor invalido, esto falla.
 */
function diaDe(fecha: Date | string): string {
  if (typeof fecha === 'string') {
    return fecha.slice(0, 10);
  }
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('fecha de vencimiento invalida recibida del servicio');
  }
  return fecha.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

if (COLA_PRERREQUISITOS.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `\n[test:lot-core:postgres] OMITIDO por prerrequisitos:\n - ${COLA_PRERREQUISITOS.join('\n - ')}\n`,
  );
}

const suite = prerrequisitos.ok ? describe : describe.skip;

suite('integracion PostgreSQL aislada: nucleo de lotes por sucursal', () => {
  beforeAll(async () => {
    baseTemporal = fs.mkdtempSync(path.join(prerrequisitos.baseTemporal, 'farmacia-lot-core-pg-'));
    puerto = PUERTO_POR_DEFECTO;

    cluster = new ClusterAislado(
      baseTemporal,
      prerrequisitos.initdb as string,
      prerrequisitos.pgCtl as string,
      puerto,
    );
    cluster.iniciar();

    try {
      await crearBaseDeDatos(BASE_DATOS_PRINCIPAL);
    } catch (error) {
      throw new Error(
        `No se pudo crear la base aislada ${BASE_DATOS_PRINCIPAL}: ${
          error instanceof Error ? error.message : String(error)
        }. Log del cluster:\n${cluster.leerLog()}`,
      );
    }

    ds = crearDataSource(BASE_DATOS_PRINCIPAL);
    await ds.initialize();

    // 1. Cadena base COMPLETA de migraciones (esquema legado exacto).
    //
    // DECLARACION HONESTA DE COBERTURA: la primera migracion de la cadena
    // (1775151661067 CreateCategoriasMarcasLotes) ya usa uuid_generate_v4() sin
    // crear la extension; solo las posteriores (1775160000000, 1775332000000,
    // 1775342000000) ejecutan CREATE EXTENSION IF NOT EXISTS "uuid-ossp". La base
    // real del proyecto ya la tiene instalada, asi que el harness la instala
    // antes de la cadena y lo dice en voz alta en vez de fingir que la cadena es
    // autocontenida.
    await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    const aplicadas = await ds.runMigrations({ transaction: 'all' });
    expect(aplicadas.length).toBe(MIGRACIONES_BASE.length);

    // 2. Fotografia del esquema legado antes de HardenLotBranchCore.
    const columnasLotes = await columnasDe('lotes_productos');
    const columnasProductos = await columnasDe('productos');
    const productoId = columnasLotes.find((c) => c.columnName === 'producto_id');
    const numeroLote = columnasLotes.find((c) => c.columnName === 'numeroLote');
    legado = {
      productoId: {
        dataType: productoId!.dataType,
        udtName: productoId!.udtName,
      },
      columnasLotes: columnasLotes.map((c) => c.columnName),
      numeroLote: {
        dataType: numeroLote!.dataType,
        udtName: numeroLote!.udtName,
        characterMaximumLength: numeroLote!.characterMaximumLength,
      },
      columnasProductos: columnasProductos.map((c) => c.columnName),
    };

    // 3. Fixtures con entidades/esquema REAL del proyecto.
    await ds.query(
      `INSERT INTO "sucursales" ("id", "codigo", "nombre") VALUES ($1, 'A', 'Sucursal A'), ($2, 'B', 'Sucursal B')`,
      [sucursalA, sucursalB],
    );
    await ds.query(
      `INSERT INTO "users" ("id", "nombre", "email", "password_hash", "sucursal_id")
       VALUES ($1, 'Usuario de pruebas', 'harness@farmacia.test', 'hash-de-pruebas', $2)`,
      [usuario, sucursalA],
    );

    // Lote legado: producto_id es character varying y "numeroLote" va con espacios.
    const productoLegado = await crearProducto('LEGADO');
    await ds.query(
      `INSERT INTO "lotes_productos" ("producto_id", "numeroLote", "fecha_vencimiento", "cantidad_inicial")
       VALUES ($1, '  lote-espacios  ', '2035-01-01', 10)`,
      [productoLegado],
    );

    // 4. Migracion bajo prueba, dentro de transaccion.
    await aplicarMigracionEnTransaccion(ds);

    stock = new LotStockService(ds);
  });

  afterAll(async () => {
    try {
      if (ds?.isInitialized) {
        await ds.destroy();
      }
    } catch {
      // cierre best-effort
    }
    // Si detener falla, propagar el error y conservar el directorio: nunca
    // borrar los archivos de un servidor que puede seguir ejecutandose.
    cluster?.detener();
    if (baseTemporal) {
      try {
        fs.rmSync(baseTemporal, { recursive: true, force: true });
      } catch {
        // el temporal ya no importa
      }
    }
  });

  // --- infraestructura del harness -----------------------------------------

  it('arranca un cluster aislado: socket unix privado, sin TCP, puerto no default', async () => {
    expect(fs.existsSync(path.join(cluster!.socket, `.s.PGSQL.${puerto}`))).toBe(true);
    expect(puerto).not.toBe(5432);

    const [{ listen_addresses: listen, unix_socket_directories: socketDir }] = await ds.query(
      `SELECT current_setting('listen_addresses') AS "listen_addresses",
              current_setting('unix_socket_directories') AS "unix_socket_directories"`,
    );
    expect(listen).toBe('');
    expect(socketDir).toBe(cluster!.socket);

    const [{ hba_file: hba }] = await ds.query(
      `SELECT "setting" AS "hba_file" FROM "pg_settings" WHERE "name" = 'hba_file'`,
    );
    const contenido = fs.readFileSync(hba, 'utf8');
    expect(contenido).toMatch(/^local\s+all\s+all\s+trust$/m);
    expect(contenido).toMatch(/^host\s+all\s+all\s+127\.0\.0\.1\/32\s+reject$/m);

    // Ningun puerto TCP escucha: el unico canal posible es el socket unix.
    await expect(
      new Client({ host: '127.0.0.1', port: puerto, database: BASE_DATOS_PRINCIPAL, user: usuarioActual(), connectionTimeoutMillis: 2000 }).connect(),
    ).rejects.toBeDefined();

    const [{ version: version }] = await ds.query(`SELECT version()`);
    expect(version).toMatch(/PostgreSQL/);
  });

  it('reproduce el esquema legado exacto que la migracion endurece', () => {
    // El esquema previo es el de la cadena real: producto_id varchar y
    // "numeroLote" entrecomillado con longitud 50.
    expect(legado.productoId.udtName).toBe('varchar');
    expect(legado.productoId.dataType).toBe('character varying');
    expect(legado.numeroLote.udtName).toBe('varchar');
    expect(legado.numeroLote.characterMaximumLength).toBe(50);
    expect(legado.columnasLotes).toContain('numeroLote');
    // El shim "numerolote" en minuscula nunca existio en el esquema real.
    expect(legado.columnasLotes).not.toContain('numerolote');
    expect(legado.columnasLotes).toContain('cantidad_inicial');
    expect(legado.columnasProductos).not.toContain('es_medicamento');
  });

  it('aplica la migracion: castea producto_id a uuid y crea el nucleo por lote', async () => {
    const columnasLotes = await columnasDe('lotes_productos');
    const productoId = columnasLotes.find((c) => c.columnName === 'producto_id');
    const numeroLote = columnasLotes.find((c) => c.columnName === 'numeroLote');
    const normalizado = columnasLotes.find((c) => c.columnName === 'numero_lote_normalizado');

    expect(productoId?.udtName).toBe('uuid');
    // El nombre entrecomillado sobrevive intacto: "numeroLote" != "numero_lote".
    expect(numeroLote?.udtName).toBe('varchar');
    expect(numeroLote?.characterMaximumLength).toBe(50);
    expect(normalizado?.udtName).toBe('varchar');

    for (const tabla of [
      'inventario_lote_sucursal',
      'venta_item_lotes',
      'reconciliacion_lote',
      'correlativo_diario',
    ]) {
      expect(await existeObjeto('table', tabla)).toBe(true);
    }
    for (const indice of [
      'UQ_lotes_identidad',
      'UQ_inventario_lote_sucursal',
      'IDX_inventario_lote_sucursal_lote',
      'UQ_venta_item_lotes_item_lote',
      'IDX_venta_item_lotes_lote',
      'IDX_reconciliacion_lote_sucursal_producto',
      'UQ_correlativo_diario_fecha_tipo_sucursal',
    ]) {
      const [fila] = await ds.query(
        `SELECT "indexname" FROM "pg_indexes"
          WHERE "schemaname" = current_schema() AND "indexname" = $1`,
        [indice],
      );
      expect(fila).toBeDefined();
    }

    // es_medicamento agregado con default: no rompe los productos preexistentes.
    expect(await existeObjeto('table', 'productos')).toBe(true);
    const [{ es_medicamento }] = await ds.query(
      `SELECT "es_medicamento" FROM "productos" WHERE "codigo" = 'P-LEGADO'`,
    );
    expect(es_medicamento).toBe(false);

    // Normalizacion: upper(btrim("numeroLote")) y fila intacta.
    const [lote] = await ds.query(
      `SELECT "numeroLote", "numero_lote_normalizado", "cantidad_inicial"::integer AS "cantidad_inicial"
         FROM "lotes_productos" WHERE "numero_lote_normalizado" = 'LOTE-ESPACIOS'`,
    );
    expect(lote.numeroLote).toBe('  lote-espacios  ');
    expect(lote.numero_lote_normalizado).toBe('LOTE-ESPACIOS');
    expect(Number(lote.cantidad_inicial)).toBe(10);

    // La migracion NO infiere saldos: el backfill seria inventar inventario.
    const [{ saldos }] = await ds.query(
      `SELECT COUNT(*)::integer AS saldos FROM "inventario_lote_sucursal"`,
    );
    expect(Number(saldos)).toBe(0);
    const [{ correlativos }] = await ds.query(
      `SELECT COUNT(*)::integer AS correlativos FROM "correlativo_diario"`,
    );
    expect(Number(correlativos)).toBe(0);
  });

  it('el CHECK de normalizacion rechaza un numeroLote inconsistente', async () => {
    // Inconsistencia real: upper(btrim("numeroLote")) = 'LOTE-CHK' != 'CHKA'.
    const producto = await crearProducto('CHK');
    await expect(
      ds.query(
        `INSERT INTO "lotes_productos" ("producto_id", "numeroLote", "numero_lote_normalizado", "fecha_vencimiento")
         VALUES ($1, '  lote-chk  ', 'CHKA', '2030-01-01')`,
        [producto],
      ),
    ).rejects.toThrow(/CHK_lotes_numero_normalizado/);

    // Par consistente: el mismo INSERT pasa y respeta el indice unico.
    await expect(
      ds.query(
        `INSERT INTO "lotes_productos" ("producto_id", "numeroLote", "numero_lote_normalizado", "fecha_vencimiento")
         VALUES ($1, '  lote-chk  ', 'LOTE-CHK', '2030-01-01')`,
        [producto],
      ),
    ).resolves.toBeDefined();
  });

  it('rechaza reaplicar la migracion si el esquema ya existe, sin DDL parcial', async () => {
    const antes = (await columnasDe('inventario_lote_sucursal')).length;
    await expect(aplicarMigracionEnTransaccion(ds)).rejects.toThrow(/ya existe con/);
    const despues = (await columnasDe('inventario_lote_sucursal')).length;
    expect(despues).toBe(antes);
    const [{ tipo }] = await ds.query(
      `SELECT "data_type" AS tipo FROM "information_schema"."columns"
        WHERE "table_name" = 'lotes_productos' AND "column_name" = 'producto_id'`,
    );
    expect(tipo).toBe('uuid');
  });

  // --- LotStockService contra el driver real -------------------------------

  it('creditPurchase acredita el saldo del lote con EntityManager real', async () => {
    const producto = await crearProducto('CREDITO');

    const resultado = await ds.transaction((em) =>
      stock.creditPurchase(em, {
        sucursalId: sucursalA,
        productoId: producto,
        numeroLote: '  compra-01 ',
        fechaVencimiento: '2031-03-15',
        cantidad: 7,
      }),
    );

    expect(resultado.loteId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(resultado.saldoId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(await nombreDeLote(resultado.loteId)).toBe('COMPRA-01');
    expect(await saldosDe(producto)).toEqual({ 'COMPRA-01': 7 });

    // Idempotente por identidad de lote: acumula en el mismo saldo.
    const segundo = await ds.transaction((em) =>
      stock.creditPurchase(em, {
        sucursalId: sucursalA,
        productoId: producto,
        numeroLote: 'compra-01',
        fechaVencimiento: '2031-03-15',
        cantidad: 3,
      }),
    );
    expect(segundo.saldoId).toBe(resultado.saldoId);
    expect(await saldosDe(producto)).toEqual({ 'COMPRA-01': 10 });
  });

  it('FEFO real: descuenta primero el lote vencido y reparte entre varios lotes', async () => {
    const producto = await crearProducto('FEFO');

    const lotes = await ds.transaction(async (em) => {
      const plan: Array<{ loteId: string; numeroLote: string }> = [];
      const lotesFixture: Array<[string, string, number]> = [
        ['vencido', '2020-01-01', 3],
        ['proximo', '2027-01-01', 5],
        ['posterior', '2030-01-01', 10],
      ];
      for (const [numeroLote, fechaVencimiento, cantidad] of lotesFixture) {
        const acreditado = await stock.creditPurchase(em, {
          sucursalId: sucursalA,
          productoId: producto,
          numeroLote,
          fechaVencimiento,
          cantidad,
        });
        plan.push({ loteId: acreditado.loteId, numeroLote: numeroLote.toUpperCase() });
      }
      return plan;
    });

    // El agregado es del llamador: se alinea con la suma de lotes.
    await ds.query(
      `INSERT INTO "inventario_sucursal" ("sucursal_id", "producto_id", "stock_actual")
       VALUES ($1, $2, 18)`,
      [sucursalA, producto],
    );

    const asignacion = await ds.transaction((em) =>
      stock.allocateSale(em, { sucursalId: sucursalA, productoId: producto, cantidad: 8 }),
    );

    expect(asignacion).toHaveLength(2);
    expect(asignacion[0].loteId).toBe(lotes[0].loteId);
    expect(Number(asignacion[0].cantidad)).toBe(3);
    expect(diaDe(asignacion[0].fechaVencimiento)).toBe('2020-01-01');
    expect(asignacion[1].loteId).toBe(lotes[1].loteId);
    expect(Number(asignacion[1].cantidad)).toBe(5);
    expect(diaDe(asignacion[1].fechaVencimiento)).toBe('2027-01-01');

    // El lote vencido se consumio: sigue forming parte del stock, no se excluye.
    expect(await saldosDe(producto)).toEqual({ VENCIDO: 0, PROXIMO: 0, POSTERIOR: 10 });
  });

  it('aisla por sucursal: los saldos de la otra sucursal no se tocan', async () => {
    const producto = await crearProducto('AISLAMIENTO');

    const acreditado = await ds.transaction((em) =>
      stock.creditPurchase(em, {
        sucursalId: sucursalA,
        productoId: producto,
        numeroLote: 'compartido',
        fechaVencimiento: '2028-01-01',
        cantidad: 10,
      }),
    );

    // La misma identidad de lote existe en la otra sucursal con otro saldo.
    await ds.query(
      `INSERT INTO "inventario_lote_sucursal" ("sucursal_id", "lote_id", "cantidad")
       VALUES ($1, $2, 50)`,
      [sucursalB, acreditado.loteId],
    );
    await ds.query(
      `INSERT INTO "inventario_sucursal" ("sucursal_id", "producto_id", "stock_actual")
       VALUES ($1, $2, 10), ($3, $2, 50)`,
      [sucursalA, producto, sucursalB],
    );

    await ds.transaction((em) =>
      stock.allocateSale(em, { sucursalId: sucursalA, productoId: producto, cantidad: 4 }),
    );

    const saldos = await ds.query(
      `SELECT "sucursal_id", "cantidad"::integer AS "cantidad"
         FROM "inventario_lote_sucursal" WHERE "lote_id" = $1
        ORDER BY "sucursal_id" ASC`,
      [acreditado.loteId],
    );
    expect(saldos).toEqual([
      { sucursal_id: sucursalA, cantidad: 6 },
      { sucursal_id: sucursalB, cantidad: 50 },
    ]);
  });

  it('falla con stock insuficiente y revierte la transaccion completa', async () => {
    const producto = await crearProducto('INSUFICIENTE');

    await ds.transaction(async (em) => {
      await stock.creditPurchase(em, {
        sucursalId: sucursalA,
        productoId: producto,
        numeroLote: 'escaso',
        fechaVencimiento: '2029-01-01',
        cantidad: 5,
      });
    });
    await ds.query(
      `INSERT INTO "inventario_sucursal" ("sucursal_id", "producto_id", "stock_actual")
       VALUES ($1, $2, 5)`,
      [sucursalA, producto],
    );

    const saldosAntes = await saldosDe(producto);

    await expect(
      ds.transaction(async (em) => {
        await stock.allocateSale(em, {
          sucursalId: sucursalA,
          productoId: producto,
          cantidad: 99,
        });
        // Si el servicio devolviera sin fallar, el rollback quedaria sin probar:
        await em.query(
          `INSERT INTO "reconciliacion_lote" ("sucursal_id", "producto_id", "cantidad_antes", "cantidad_despues", "motivo")
           VALUES ($1, $2, 0, 0, 'no deberia persistir')`,
          [sucursalA, producto],
        );
      }),
    ).rejects.toThrow(/Stock insuficiente/i);

    expect(await saldosDe(producto)).toEqual(saldosAntes);

    const [{ auditoria }] = await ds.query(
      `SELECT COUNT(*)::integer AS auditoria FROM "reconciliacion_lote" WHERE "producto_id" = $1`,
      [producto],
    );
    expect(Number(auditoria)).toBe(0);
  });

  it('detecta discrepancias y reconcilia con suma exacta, escribiendo auditoria', async () => {
    const producto = await crearProducto('RECONCILIACION');

    const lotes = await ds.transaction(async (em) => {
      const ids: string[] = [];
      const lotesFixture: Array<[string, string, number]> = [
        ['recon-a', '2026-06-01', 4],
        ['recon-b', '2027-06-01', 6],
        ['recon-c', '2028-06-01', 10],
      ];
      for (const [numeroLote, fechaVencimiento, cantidad] of lotesFixture) {
        const acreditado = await stock.creditPurchase(em, {
          sucursalId: sucursalA,
          productoId: producto,
          numeroLote,
          fechaVencimiento,
          cantidad,
        });
        ids.push(acreditado.loteId);
      }
      return ids;
    });

    await ds.query(
      `INSERT INTO "inventario_sucursal" ("sucursal_id", "producto_id", "stock_actual")
       VALUES ($1, $2, 12)`,
      [sucursalA, producto],
    );

    // Discrepancia: agregado 12 vs suma de lotes 20, diferencia = agregado - lotes.
    const discrepancias = await stock.readDiscrepancies(ds.manager, sucursalA, producto);
    expect(discrepancias).toHaveLength(1);
    expect(Number(discrepancias[0].stockActual)).toBe(12);
    expect(Number(discrepancias[0].totalLotes)).toBe(20);
    expect(Number(discrepancias[0].diferencia)).toBe(-8);

    const [{ auditoriaAntes }] = await ds.query(
      `SELECT COUNT(*)::integer AS "auditoriaAntes" FROM "reconciliacion_lote" WHERE "producto_id" = $1`,
      [producto],
    );
    expect(Number(auditoriaAntes)).toBe(0);

    // Reconciliacion valida: la suma debe igualar el agregado.
    const resultado = await stock.reconcileInTransaction({
      sucursalId: sucursalA,
      productoId: producto,
      asignaciones: [
        { loteId: lotes[0], cantidad: 2 },
        { loteId: lotes[1], cantidad: 3 },
        { loteId: lotes[2], cantidad: 7 },
      ],
      motivo: 'Conteo fisico con harness PostgreSQL',
      usuarioId: usuario,
    });

    expect(Number(resultado.totalLotes)).toBe(12);
    expect(Number(resultado.stockActual)).toBe(12);
    expect(resultado.ajustes).toHaveLength(3);
    expect(resultado.ajustes.map((a) => Number(a.cantidadDespues)).sort()).toEqual([2, 3, 7]);
    expect(await saldosDe(producto)).toEqual({ 'RECON-A': 2, 'RECON-B': 3, 'RECON-C': 7 });
    expect(await stock.readDiscrepancies(ds.manager, sucursalA, producto)).toHaveLength(0);

    const auditoria = await ds.query(
      `SELECT "lote_id", "cantidad_antes"::integer AS "cantidad_antes",
              "cantidad_despues"::integer AS "cantidad_despues", "motivo", "usuario_id"
         FROM "reconciliacion_lote" WHERE "producto_id" = $1 ORDER BY "lote_id" ASC`,
      [producto],
    );
    expect(auditoria).toHaveLength(3);
    expect(auditoria.map((f) => f.usuario_id)).toEqual([usuario, usuario, usuario]);
    expect(new Set(auditoria.map((f) => f.motivo))).toEqual(
      new Set(['Conteo fisico con harness PostgreSQL']),
    );

    // Suma incorrecta: revierte y NO deja auditoria nueva.
    const [{ auditoriaTras }] = await ds.query(
      `SELECT COUNT(*)::integer AS "auditoriaTras" FROM "reconciliacion_lote" WHERE "producto_id" = $1`,
      [producto],
    );
    await expect(
      stock.reconcileInTransaction({
        sucursalId: sucursalA,
        productoId: producto,
        asignaciones: [
          { loteId: lotes[0], cantidad: 2 },
          { loteId: lotes[1], cantidad: 3 },
          { loteId: lotes[2], cantidad: 6 },
        ],
        motivo: 'Debe revertir',
        usuarioId: usuario,
      }),
    ).rejects.toThrow(/no coincide/i);
    const [{ auditoriaFinal }] = await ds.query(
      `SELECT COUNT(*)::integer AS "auditoriaFinal" FROM "reconciliacion_lote" WHERE "producto_id" = $1`,
      [producto],
    );
    expect(Number(auditoriaFinal)).toBe(Number(auditoriaTras));

    // Distribucion incompleta: el saldo del lote no declarado impide cerrar.
    await expect(
      stock.reconcileInTransaction({
        sucursalId: sucursalA,
        productoId: producto,
        asignaciones: [
          { loteId: lotes[0], cantidad: 5 },
          { loteId: lotes[1], cantidad: 7 },
        ],
        motivo: 'Debe fallar por distribucion incompleta',
        usuarioId: usuario,
      }),
    ).rejects.toThrow(/Distribucion incompleta/i);
  });

  // Servicios reales, repositorios reales y transacciones independientes.
  // Solo la identidad de sesion se provee como fixture; no se simula el driver.
  function serviciosOperativos() {
    const usuarios = { findByIdForAuth: async (id: string) => ({ id, sucursalId: sucursalA }) } as unknown as UsersService;
    const sucursales = { findOne: async (id: string) => ({ id, codigo: id === sucursalA ? 'A' : 'B' }) } as unknown as SucursalesService;
    const productos = { findOne: (id: string) => ds.getRepository(Producto).findOneByOrFail({ id }) } as unknown as ProductosService;
    const servicios = { findOne: (id: string) => ds.getRepository(Servicio).findOneByOrFail({ id }) } as unknown as ServiciosService;
    const correlativos = new CorrelativosService(ds);
    const alertas = new ExpiryAlertsService(new ConfigService({ LOTES_ALERTA_PROXIMO_VENCIMIENTO_DIAS: 90 }));
    return {
      ventas: new VentasService(ds, ds.getRepository(Venta), ds.getRepository(VentaItem),
        ds.getRepository(VentaItemLote), ds.getRepository(VentaPago), ds.getRepository(InventarioSucursal),
        ds.getRepository(Caja), ds.getRepository(CajaMovimiento), productos, servicios, stock, correlativos,
        usuarios, sucursales, alertas),
      cajas: new CajasService(ds.getRepository(Caja), ds.getRepository(CajaMovimiento), ds,
        correlativos, sucursales, usuarios),
    };
  }

  async function prepararOperacion(codigo: string, cantidad: number) {
    await ds.query(`UPDATE cajas SET estado = 'cerrada' WHERE estado IN ('abierta', 'pausada')`);
    const productoId = await crearProducto(codigo);
    await ds.query(`UPDATE productos SET es_medicamento = true, precio_venta = 10 WHERE id = $1`, [productoId]);
    const lote = await ds.transaction((em) => stock.creditPurchase(em, {
      sucursalId: sucursalA, productoId, numeroLote: `VENCIDO-${codigo}`,
      fechaVencimiento: '2020-01-01', cantidad,
    }));
    await ds.query(`INSERT INTO inventario_sucursal (sucursal_id, producto_id, stock_actual) VALUES ($1,$2,$3)`,
      [sucursalA, productoId, cantidad]);
    const servicios = serviciosOperativos();
    const user = { id: usuario, roles: [RoleCode.VENDEDOR] };
    const caja = await servicios.cajas.open({ sucursalId: sucursalA, montoApertura: 100 }, user);
    return { productoId, loteId: lote.loteId, servicios, user, caja };
  }

  it('dos ventas reales desde cajas distintas no venden dos veces la ultima unidad', async () => {
    const op = await prepararOperacion('ULTIMA', 1);
    const usuario2 = '44444444-4444-4444-8444-444444444444';
    await ds.query(`INSERT INTO users (id,nombre,email,password_hash,sucursal_id) VALUES ($1,'Cajero 2','cajero2@farmacia.test','test',$2)`,
      [usuario2, sucursalA]);
    const user2 = { id: usuario2, roles: [RoleCode.VENDEDOR] };
    await op.servicios.cajas.open({ sucursalId: sucursalA, montoApertura: 100 }, user2);
    const dto = { sucursalId: sucursalA, items: [{ productoId: op.productoId, cantidad: 1 }],
      pagos: [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 10 }] };
    const resultados = await Promise.allSettled([
      op.servicios.ventas.create(dto, op.user), op.servicios.ventas.create(dto, user2),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazada.reason.getStatus()).toBe(409);
    const [saldo] = await ds.query(`SELECT cantidad FROM inventario_lote_sucursal WHERE sucursal_id=$1 AND lote_id=$2`, [sucursalA, op.loteId]);
    const [inv] = await ds.query(`SELECT stock_actual FROM inventario_sucursal WHERE sucursal_id=$1 AND producto_id=$2`, [sucursalA, op.productoId]);
    expect(Number(saldo.cantidad)).toBe(0);
    expect(Number(inv.stock_actual)).toBe(0);
    const [asignacion] = await ds.query(`SELECT SUM(cantidad)::integer AS cantidad FROM venta_item_lotes WHERE lote_id=$1`, [op.loteId]);
    expect(asignacion.cantidad).toBe(1);
  });

  it('venta mixta simultanea con cierre deja efectivo y movimientos consistentes', async () => {
    const op = await prepararOperacion('CIERRE', 1);
    const resultados = await Promise.allSettled([
      op.servicios.ventas.create({ sucursalId: sucursalA,
        items: [{ productoId: op.productoId, cantidad: 1 }],
        pagos: [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 4 },
          { metodoPago: VentaMetodoPago.TRANSFERENCIA, monto: 6 }] }, op.user),
      op.servicios.cajas.close(op.caja.id, { montoCierreReal: 100, observacion: 'Prueba concurrente' }, op.user),
    ]);
    expect(resultados[1].status).toBe('fulfilled');
    if (resultados[0].status === 'rejected') expect(resultados[0].reason.getStatus()).toBe(400);
    const cerrado = await ds.getRepository(Caja).findOneByOrFail({ id: op.caja.id });
    expect(cerrado.estado).toBe(CajaEstado.CERRADA);
    const [pagos] = await ds.query(`SELECT COALESCE(SUM(p.monto),0) AS efectivo FROM venta_pagos p JOIN ventas v ON v.id=p.venta_id WHERE v.caja_id=$1 AND p.metodo_pago='efectivo'`, [op.caja.id]);
    expect(Number(cerrado.montoCierreEsperado)).toBe(100 + Number(pagos.efectivo));
    expect(Number(pagos.efectivo)).toBe(resultados[0].status === 'fulfilled' ? 4 : 0);
  });

  it('rollback de una venta invalida restaura lotes y agregado sin pagos ni movimientos', async () => {
    const op = await prepararOperacion('ROLLBACK-VENTA', 2);
    await expect(op.servicios.ventas.create({ sucursalId: sucursalA,
      items: [{ productoId: op.productoId, cantidad: 1 }],
      pagos: [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 9 }] }, op.user)).rejects.toThrow(/suma de pagos/i);
    const [saldo] = await ds.query(`SELECT cantidad FROM inventario_lote_sucursal WHERE sucursal_id=$1 AND lote_id=$2`, [sucursalA, op.loteId]);
    const [inv] = await ds.query(`SELECT stock_actual FROM inventario_sucursal WHERE sucursal_id=$1 AND producto_id=$2`, [sucursalA, op.productoId]);
    expect(Number(saldo.cantidad)).toBe(2);
    expect(Number(inv.stock_actual)).toBe(2);
    expect(await ds.getRepository(Venta).countBy({ cajaId: op.caja.id })).toBe(0);
    const [mov] = await ds.query(`SELECT COUNT(*)::integer AS cantidad FROM caja_movimientos WHERE caja_id=$1 AND tipo='venta'`, [op.caja.id]);
    expect(mov.cantidad).toBe(0);
  });

  it('acreditaciones concurrentes conservan identidad unica y suma por sucursal', async () => {
    const productoId = await crearProducto('CREDITO-CONCURRENTE');
    await ds.query(`INSERT INTO inventario_sucursal (sucursal_id,producto_id,stock_actual) VALUES ($1,$2,0)`, [sucursalA, productoId]);
    const acreditar = (cantidad: number) => ds.transaction(async (em) => {
      await em.query(`SELECT id FROM productos WHERE id=$1 FOR UPDATE`, [productoId]);
      await em.query(`SELECT id FROM inventario_sucursal WHERE sucursal_id=$1 AND producto_id=$2 FOR UPDATE`, [sucursalA, productoId]);
      const lote = await stock.creditPurchase(em, { sucursalId: sucursalA, productoId,
        numeroLote: 'MISMA-IDENTIDAD', fechaVencimiento: '2020-01-01', cantidad });
      await em.query(`UPDATE inventario_sucursal SET stock_actual=stock_actual+$3 WHERE sucursal_id=$1 AND producto_id=$2`, [sucursalA, productoId, cantidad]);
      return lote;
    });
    const [primero, segundo] = await Promise.all([acreditar(3), acreditar(5)]);
    expect(primero.loteId).toBe(segundo.loteId);
    const [saldo] = await ds.query(`SELECT cantidad FROM inventario_lote_sucursal WHERE sucursal_id=$1 AND lote_id=$2`, [sucursalA, primero.loteId]);
    expect(Number(saldo.cantidad)).toBe(8);
    expect(await stock.readDiscrepancies(ds.manager, sucursalA, productoId)).toEqual([]);
  });

  // --- Correlativos ---------------------------------------------------------

  it('correlativo de caja global: concurrencia real con conexiones independientes y semilla historica', async () => {
    const dia = '2026-11-03';
    const diaCompacto = '20261103';

    // Semilla historica: el maximo se lee de cajas, no de fecha_creacion.
    await ds.query(
      `INSERT INTO "cajas" ("numero_caja", "sucursal_id", "usuario_apertura_id", "fecha_apertura", "monto_apertura", "estado")
       VALUES ($1, $2, $3, $4, 0, 'cerrada')`,
      [`CJ-${diaCompacto}-0027`, sucursalA, usuario, `${dia}T09:00:00`],
    );

    // Dos DataSource DISTINTOS = dos pools y conexiones independientes reales.
    const dsIzquierda = crearDataSource(BASE_DATOS_PRINCIPAL);
    const dsDerecha = crearDataSource(BASE_DATOS_PRINCIPAL);
    await dsIzquierda.initialize();
    await dsDerecha.initialize();

    try {
      // pg_backend_pid()::integer llega como numero: se comparan los backends reales.
      const [pidIzquierda] = await dsIzquierda.query(
        `SELECT pg_backend_pid()::integer AS "pid"`,
      );
      const [pidDerecha] = await dsDerecha.query(
        `SELECT pg_backend_pid()::integer AS "pid"`,
      );
      expect(Number(pidIzquierda.pid)).toBeGreaterThan(0);
      expect(Number(pidIzquierda.pid)).not.toBe(Number(pidDerecha.pid));

      const servicioIzquierda = new CorrelativosService(dsIzquierda);
      const servicioDerecha = new CorrelativosService(dsDerecha);

      const [secuenciaA, secuenciaB] = await Promise.all([
        servicioIzquierda.next(CorrelativoTipo.CAJA, sucursalA, { fecha: dia }),
        servicioDerecha.next(CorrelativoTipo.CAJA, sucursalB, { fecha: dia }),
      ]);

      expect(new Set([secuenciaA, secuenciaB]).size).toBe(2);
      expect(Math.min(secuenciaA, secuenciaB)).toBe(28);
      expect(Math.max(secuenciaA, secuenciaB)).toBe(29);
      // Que correlativo se lleve el 28 y cual el 29 es decidedor del planner:
      // se exige el conjunto, no un ordenwinner.
      expect(
        [secuenciaA, secuenciaB]
          .map((secuencia) => formatearNumeroCorrelativo(`CJ-${diaCompacto}`, secuencia))
          .sort(),
      ).toEqual([`CJ-${diaCompacto}-0028`, `CJ-${diaCompacto}-0029`]);

      // El contador de caja es GLOBAL: una sola fila, sin sucursal.
      const filas = await ds.query(
        `SELECT "fecha"::text AS fecha, "tipo", "sucursal_id", "secuencia"::integer AS "secuencia"
           FROM "correlativo_diario" WHERE "tipo" = 'caja' AND "fecha" = $1::date`,
        [dia],
      );
      expect(filas).toHaveLength(1);
      expect(filas[0].sucursal_id).toBeNull();
      expect(Number(filas[0].secuencia)).toBe(29);
    } finally {
      await dsIzquierda.destroy();
      await dsDerecha.destroy();
    }
  });

  // --- Preflight sobre esquema legado sucio (base separada) ----------------

  it('aborta sin DDL parcial cuando el lote legado tiene producto_id no UUID', async () => {
    await crearBaseDeDatos(BASE_DATOS_LEGADA);
    const dsLegado = crearDataSource(BASE_DATOS_LEGADA);
    await dsLegado.initialize();

    try {
      await dsLegado.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await dsLegado.runMigrations({ transaction: 'all' });

      await dsLegado.query(
        `INSERT INTO "productos" ("nombre", "codigo") VALUES ('Producto sucio', 'P-SUCIO')`,
      );
      await dsLegado.query(
        `INSERT INTO "lotes_productos" ("producto_id", "numeroLote", "fecha_vencimiento")
         VALUES ('no-es-uuid', 'SUCIO', '2030-01-01')`,
      );

      await expect(aplicarMigracionEnTransaccion(dsLegado)).rejects.toThrow(
        /producto_id no es un UUID valido/i,
      );

      // Sin DDL parcial: ninguna columna/tabla de la migracion quedo creada.
      const [{ columnas }] = await dsLegado.query(
        `SELECT COUNT(*)::integer AS columnas FROM "information_schema"."columns"
          WHERE "table_schema" = current_schema() AND (
            "column_name" IN ('es_medicamento', 'numero_lote_normalizado'))`,
      );
      expect(Number(columnas)).toBe(0);
      const [{ tablas }] = await dsLegado.query(
        `SELECT COUNT(*)::integer AS tablas FROM "information_schema"."tables"
          WHERE "table_schema" = current_schema()
            AND "table_name" = ANY($1::text[])`,
        [['inventario_lote_sucursal', 'venta_item_lotes', 'reconciliacion_lote', 'correlativo_diario']],
      );
      expect(Number(tablas)).toBe(0);

      // El lote legado sigue intacto: la migracion no fusiona ni borra datos.
      const [{ intactos }] = await dsLegado.query(
        `SELECT COUNT(*)::integer AS intactos FROM "lotes_productos"`,
      );
      expect(Number(intactos)).toBe(1);
    } finally {
      await dsLegado.destroy();
    }
  });
});
