import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'compra_items' })
@Index(['compraId'])
export class CompraItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'compra_id', type: 'uuid' })
  compraId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'nombre_producto', type: 'varchar', length: 255 })
  nombreProducto: string;

  @Column({ name: 'codigo_producto', type: 'varchar', length: 50 })
  codigoProducto: string;

  @Column({ name: 'cantidad_compra', type: 'int' })
  cantidadCompra: number;

  @Column({ name: 'unidad_compra', type: 'varchar', length: 30 })
  unidadCompra: string;

  @Column({ type: 'int' })
  factor: number;

  @Column({ name: 'cantidad_unidades_ingreso', type: 'int' })
  cantidadUnidadesIngreso: number;

  @Column({
    name: 'costo_compra_unitario',
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  costoCompraUnitario: number;

  @Column({
    name: 'costo_unitario_resultante',
    type: 'decimal',
    precision: 12,
    scale: 4,
  })
  costoUnitarioResultante: number;

  @Column({ name: 'descuento_monto', type: 'decimal', precision: 12, scale: 2 })
  descuentoMonto: number;

  @Column({ type: 'varchar', length: 60, nullable: true })
  lote: string | null;

  @Column({ name: 'fecha_vencimiento', type: 'date', nullable: true })
  fechaVencimiento: Date | null;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  margen: number;

  @Column({ name: 'precio_venta', type: 'decimal', precision: 12, scale: 2 })
  precioVenta: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}
