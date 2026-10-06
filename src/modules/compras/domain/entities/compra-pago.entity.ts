import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CompraPagoMetodo {
  EFECTIVO = 'efectivo',
  TRANSFERENCIA = 'transferencia',
}

@Entity({ name: 'compra_pagos' })
@Index(['compraId'])
export class CompraPago {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'compra_id', type: 'uuid' })
  compraId: string;

  @Column({
    name: 'metodo_pago',
    type: 'enum',
    enum: CompraPagoMetodo,
  })
  metodoPago: CompraPagoMetodo;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ type: 'varchar', length: 140, nullable: true })
  referencia: string | null;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}
