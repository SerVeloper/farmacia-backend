import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CompraMetodoPago {
  EFECTIVO = 'efectivo',
  TRANSFERENCIA = 'transferencia',
  MIXTO = 'mixto',
}

export enum CompraTipoComprobante {
  FACTURA = 'factura',
  NOTA_VENTA = 'nota_venta',
  RECIBO = 'recibo',
  OTRO = 'otro',
}

@Entity({ name: 'compras' })
@Index(['sucursalId', 'fechaCreacion'])
export class Compra {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_compra', length: 50, unique: true })
  numeroCompra: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({
    name: 'metodo_pago',
    type: 'enum',
    enum: CompraMetodoPago,
  })
  metodoPago: CompraMetodoPago;

  @Column({
    name: 'tipo_comprobante',
    type: 'enum',
    enum: CompraTipoComprobante,
  })
  tipoComprobante: CompraTipoComprobante;

  @Column({ name: 'numero_comprobante', length: 80 })
  numeroComprobante: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @Column({ name: 'descuento_total', type: 'decimal', precision: 12, scale: 2 })
  descuentoTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}
