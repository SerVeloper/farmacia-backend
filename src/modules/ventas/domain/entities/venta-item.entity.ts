import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'venta_items' })
@Index(['ventaId'])
export class VentaItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'cantidad', type: 'int' })
  cantidad: number;

  @Column({ name: 'precio_unitario', type: 'decimal', precision: 12, scale: 2 })
  precioUnitario: number;

  @Column({ name: 'descuento_monto', type: 'decimal', precision: 12, scale: 2, default: 0 })
  descuentoMonto: number;

  @Column({ name: 'subtotal', type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @Column({ name: 'nombre_producto', type: 'varchar', length: 255 })
  nombreProducto: string;

  @Column({ name: 'codigo_producto', type: 'varchar', length: 50 })
  codigoProducto: string;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}
