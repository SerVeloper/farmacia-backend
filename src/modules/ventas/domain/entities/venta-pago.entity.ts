import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum VentaMetodoPago {
  EFECTIVO = 'efectivo',
  TRANSFERENCIA = 'transferencia',
}

@Entity({ name: 'venta_pagos' })
@Index(['ventaId'])
export class VentaPago {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({
    name: 'metodo_pago',
    type: 'enum',
    enum: VentaMetodoPago,
  })
  metodoPago: VentaMetodoPago;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ type: 'varchar', length: 140, nullable: true })
  referencia: string | null;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}
