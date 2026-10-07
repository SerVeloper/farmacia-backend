import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Catálogo GLOBAL de servicios (ej. "Aplicación de Inyectable").
 *
 * Un servicio NO es un producto: sin lote, sin vencimiento, sin inventario
 * y sin margen/costo (solo precio de venta). Se vende como ítem independiente
 * (puede repetirse en la misma venta) y su anulación la resuelve el módulo
 * de ventas, no un borrado físico de este catálogo.
 */
@Entity({ name: 'servicios' })
export class Servicio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255, unique: true })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ name: 'precio_venta', type: 'decimal', precision: 12, scale: 2 })
  precioVenta: number;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
