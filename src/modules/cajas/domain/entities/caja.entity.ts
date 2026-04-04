import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CajaEstado {
  ABIERTA = 'abierta',
  CERRADA = 'cerrada',
}

@Entity({ name: 'cajas' })
@Index(['sucursalId', 'estado'])
@Index(['usuarioAperturaId', 'estado'])
export class Caja {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_caja', length: 40, unique: true })
  numeroCaja: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'usuario_apertura_id', type: 'uuid' })
  usuarioAperturaId: string;

  @Column({
    type: 'enum',
    enum: CajaEstado,
    default: CajaEstado.ABIERTA,
  })
  estado: CajaEstado;

  @Column({ name: 'fecha_apertura', type: 'timestamp' })
  fechaApertura: Date;

  @Column({ name: 'monto_apertura', type: 'decimal', precision: 12, scale: 2 })
  montoApertura: number;

  @Column({ name: 'fecha_cierre', type: 'timestamp', nullable: true })
  fechaCierre: Date | null;

  @Column({ name: 'usuario_cierre_id', type: 'uuid', nullable: true })
  usuarioCierreId: string | null;

  @Column({
    name: 'monto_cierre_esperado',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  montoCierreEsperado: number | null;

  @Column({
    name: 'monto_cierre_real',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  montoCierreReal: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  diferencia: number | null;

  @Column({ name: 'observacion_cierre', type: 'text', nullable: true })
  observacionCierre: string | null;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}
