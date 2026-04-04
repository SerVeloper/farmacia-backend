import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CajaMovimientoTipo {
  APERTURA = 'apertura',
  VENTA = 'venta',
  INGRESO_MANUAL = 'ingreso_manual',
  EGRESO_MANUAL = 'egreso_manual',
  CIERRE = 'cierre',
  ANULACION_VENTA = 'anulacion_venta',
}

export enum CajaMetodoPago {
  EFECTIVO = 'efectivo',
  TRANSFERENCIA = 'transferencia',
  MIXTO = 'mixto',
}

@Entity({ name: 'caja_movimientos' })
@Index(['cajaId', 'tipo'])
@Index(['usuarioId', 'tipo'])
export class CajaMovimiento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({
    type: 'enum',
    enum: CajaMovimientoTipo,
  })
  tipo: CajaMovimientoTipo;

  @Column({
    name: 'metodo_pago',
    type: 'enum',
    enum: CajaMetodoPago,
    nullable: true,
  })
  metodoPago: CajaMetodoPago | null;

  @Column({
    name: 'numero_venta',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  numeroVenta: string | null;

  @Column({ type: 'text', nullable: true })
  detalle: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}
