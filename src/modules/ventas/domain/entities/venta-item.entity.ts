import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Servicio } from '../../../servicios/domain/entities/servicio.entity';

@Entity({ name: 'venta_items' })
@Index(['ventaId'])
export class VentaItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  /**
   * Origen producto (con lote/stock, pasa por FEFO). Nullable: el item puede
   * ser un servicio (`servicioId`). Un item tiene EXACTAMENTE un origen,
   * validado por la constraint `CK_venta_items_exactamente_un_origen`.
   */
  @Column({ name: 'producto_id', type: 'uuid', nullable: true })
  productoId: string | null;

  @Column({ name: 'servicio_id', type: 'uuid', nullable: true })
  servicioId: string | null;

  /**
   * Servicio vendido (sin inventario). Relación opcional: solo existe cuando
   * `servicioId` no es null.
   */
  @ManyToOne(() => Servicio, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'servicio_id' })
  servicio?: Servicio;

  @Column({ name: 'cantidad', type: 'int' })
  cantidad: number;

  @Column({ name: 'precio_unitario', type: 'decimal', precision: 12, scale: 2 })
  precioUnitario: number;

  @Column({ name: 'descuento_monto', type: 'decimal', precision: 12, scale: 2, default: 0 })
  descuentoMonto: number;

  @Column({ name: 'subtotal', type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  /**
   * Nombre de DISPLAY único para ambos orígenes: para productos lleva
   * `producto.nombre` y para servicios `servicio.nombre`. El frontend no
   * necesita distinguir el origen para mostrar el texto.
   */
  @Column({ name: 'nombre_producto', type: 'varchar', length: 255 })
  nombreProducto: string;

  /**
   * Código del producto. Nullable: un servicio no tiene código.
   */
  @Column({ name: 'codigo_producto', type: 'varchar', length: 50, nullable: true })
  codigoProducto: string | null;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}