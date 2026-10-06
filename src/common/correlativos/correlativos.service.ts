import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export enum CorrelativoTipo {
  COMPRA = 'compra',
  VENTA = 'venta',
  CAJA = 'caja',
}

const CORRELATIVOS_SQL = `INSERT INTO "correlativo_diario" ("fecha", "tipo", "sucursal_id", "secuencia")
VALUES ($1, $2, $3, GREATEST($4::integer + 1, 1))
ON CONFLICT ("fecha", "tipo", COALESCE("sucursal_id", '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET "secuencia" = GREATEST("correlativo_diario"."secuencia" + 1, $4::integer + 1), "fecha_actualizacion" = now()
RETURNING "secuencia"`;

/**
 * El historico se acota por el DIA EMBEBIDO EN EL NUMERO del documento, nunca por
 * `fecha_creacion`: un documento retroactivo (o un desfase de zona horaria entre el
 * prefijo local y el `now()` de la base) tiene fecha_creacion distinta del dia que
 * figura en su numero, y filtrar por esa columna reabria la secuencia desde 1 y
 * colisionaba contra el UNIQUE de `numero_venta` / `numero_compra` / `numero_caja`.
 *
 * Los patrones viajan como parametro ($2/$1) y se arman con el dia ya validado
 * (solo digitos), asi que no hay interpolacion de texto del caller en el SQL.
 */
const MAXIMO_HISTORICO_VENTA_SQL = `SELECT COALESCE(MAX(substring("numero_venta" from '-(\\d+)$')::integer), 0) AS "maximo_historico"
FROM "ventas"
WHERE "sucursal_id" = $1::uuid
  AND "numero_venta" LIKE $2`;

const MAXIMO_HISTORICO_COMPRA_SQL = `SELECT COALESCE(MAX(substring("numero_compra" from '-(\\d+)$')::integer), 0) AS "maximo_historico"
FROM "compras"
WHERE "sucursal_id" = $1::uuid
  AND "numero_compra" LIKE $2`;

const MAXIMO_HISTORICO_CAJA_SQL = `SELECT COALESCE(MAX(substring("numero_caja" from '-(\\d+)$')::integer), 0) AS "maximo_historico"
FROM "cajas"
WHERE "numero_caja" LIKE $1`;

const SUCURSAL_NULA = null;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CorrelativoOpciones {
  fecha?: Date | string;
  manager?: EntityManager;
}

interface PeriodoCorrelativo {
  /** Clave del contador en `correlativo_diario` (YYYY-MM-DD). */
  fecha: string;
  /** Dia embebido en el numero del documento (YYYYMMDD). */
  dia: string;
}

const FECHA_TEXTO_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

interface SecuenciaFila {
  secuencia: number | string;
}

interface MaximoHistoricoFila {
  maximo_historico: number | string | null;
}

export function formatearNumeroCorrelativo(
  prefijo: string,
  secuencia: number,
): string {
  return `${prefijo.replace(/-+$/, '')}-${String(secuencia).padStart(4, '0')}`;
}

@Injectable()
export class CorrelativosService {
  private readonly logger = new Logger(CorrelativosService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async next(
    tipo: CorrelativoTipo,
    sucursalId: string,
    opciones: CorrelativoOpciones = {},
  ): Promise<number> {
    this.validarTipo(tipo);
    this.validarSucursal(sucursalId);

    const periodo = this.resolverPeriodo(opciones.fecha);
    const maximoHistorico = await this.leerMaximoHistorico(
      tipo,
      sucursalId,
      periodo.dia,
      opciones.manager,
    );

    const parametros = [
      periodo.fecha,
      tipo,
      tipo === CorrelativoTipo.CAJA ? SUCURSAL_NULA : sucursalId,
      maximoHistorico,
    ];

    const filas = (
      opciones.manager
        ? await opciones.manager.query(CORRELATIVOS_SQL, parametros)
        : await this.consultarConQueryRunnerPropio(CORRELATIVOS_SQL, parametros)
    ) as SecuenciaFila[];

    const secuencia = Number(filas[0]?.secuencia);

    this.logger.log(
      `Correlativo generado: tipo=${tipo} sucursal=${tipo === CorrelativoTipo.CAJA ? 'global' : sucursalId} fecha=${periodo.fecha} dia=${periodo.dia} maximo_historico=${maximoHistorico} secuencia=${secuencia}`,
    );

    return secuencia;
  }

  private async leerMaximoHistorico(
    tipo: CorrelativoTipo,
    sucursalId: string,
    dia: string,
    manager?: EntityManager,
  ): Promise<number> {
    let sql: string;
    let parametros: unknown[];

    if (tipo === CorrelativoTipo.CAJA) {
      sql = MAXIMO_HISTORICO_CAJA_SQL;
      parametros = [this.patronHistorico(tipo, dia)];
    } else if (tipo === CorrelativoTipo.VENTA) {
      sql = MAXIMO_HISTORICO_VENTA_SQL;
      parametros = [sucursalId, this.patronHistorico(tipo, dia)];
    } else {
      sql = MAXIMO_HISTORICO_COMPRA_SQL;
      parametros = [sucursalId, this.patronHistorico(tipo, dia)];
    }

    const filas = (
      manager
        ? await manager.query(sql, parametros)
        : await this.consultarConQueryRunnerPropio(sql, parametros)
    ) as MaximoHistoricoFila[];

    const maximo = Number(filas[0]?.maximo_historico ?? 0);

    if (!Number.isFinite(maximo) || maximo < 0) {
      throw new BadRequestException(
        `No se pudo determinar el maximo historico del correlativo ${tipo} para el dia ${dia}`,
      );
    }

    return Math.floor(maximo);
  }

  private async consultarConQueryRunnerPropio(
    sql: string,
    parametros: unknown[],
  ): Promise<unknown[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      return (await queryRunner.query(sql, parametros)) as unknown[];
    } finally {
      await queryRunner.release();
    }
  }

  private validarTipo(tipo: CorrelativoTipo): void {
    if (!Object.values(CorrelativoTipo).includes(tipo)) {
      throw new BadRequestException(
        `Tipo de correlativo no soportado: ${tipo}. Valores validos: ${Object.values(
          CorrelativoTipo,
        ).join(', ')}`,
      );
    }
  }

  private validarSucursal(sucursalId: string): void {
    if (!UUID_REGEX.test(sucursalId)) {
      throw new BadRequestException(
        `sucursalId invalido para correlativo: ${sucursalId}`,
      );
    }
  }

  private patronHistorico(tipo: CorrelativoTipo, dia: string): string {
    if (tipo === CorrelativoTipo.CAJA) {
      return `CJ-${dia}-%`;
    }

    return tipo === CorrelativoTipo.VENTA ? `VT-%-${dia}-%` : `CP-%-${dia}-%`;
  }

  /**
   * El dia se resuelve SIEMPRE con los getters locales (getFullYear/getMonth/getDate),
   * que es exactamente lo que usan cajas/ventas/compras para armar el prefijo del
   * numero. Resolver el default en UTC desalinearia la clave `correlativo_diario`
   * del dia del documento en el tramo cercano a medianoche.
   */
  private resolverPeriodo(fecha?: Date | string): PeriodoCorrelativo {
    const instante = this.aInstante(fecha);
    const anio = instante.getFullYear();
    const mes = String(instante.getMonth() + 1).padStart(2, '0');
    const dia = String(instante.getDate()).padStart(2, '0');

    return { fecha: `${anio}-${mes}-${dia}`, dia: `${anio}${mes}${dia}` };
  }

  private aInstante(fecha?: Date | string): Date {
    if (fecha === undefined || fecha === null) {
      return new Date();
    }

    if (fecha instanceof Date) {
      if (Number.isNaN(fecha.getTime())) {
        throw new BadRequestException(
          `Fecha invalida para correlativo: ${String(fecha)}`,
        );
      }
      return fecha;
    }

    const texto = fecha.trim().slice(0, 10);
    const coincidencia = FECHA_TEXTO_REGEX.exec(texto);

    if (!coincidencia) {
      throw new BadRequestException(
        `Fecha invalida para correlativo: "${fecha}". Se espera YYYY-MM-DD`,
      );
    }

    const [, anio, mes, dia] = coincidencia;
    const instante = new Date(Number(anio), Number(mes) - 1, Number(dia));

    if (
      instante.getFullYear() !== Number(anio) ||
      instante.getMonth() !== Number(mes) - 1 ||
      instante.getDate() !== Number(dia)
    ) {
      throw new BadRequestException(
        `Fecha inexistente para correlativo: "${fecha}"`,
      );
    }

    return instante;
  }
}
