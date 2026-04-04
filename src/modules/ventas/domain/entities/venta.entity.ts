import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum VentaEstado {
  CONFIRMADA = 'confirmada',
}

@Entity({ name: 'ventas' })
@Index(['sucursalId', 'fechaCreacion'])
@Index(['vendedorId', 'fechaCreacion'])
export class Venta {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_venta', length: 50, unique: true })
  numeroVenta: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ name: 'vendedor_id', type: 'uuid' })
  vendedorId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @Column({ name: 'descuento_total', type: 'decimal', precision: 12, scale: 2 })
  descuentoTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;

  @Column({
    type: 'enum',
    enum: VentaEstado,
    default: VentaEstado.CONFIRMADA,
  })
  estado: VentaEstado;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}
