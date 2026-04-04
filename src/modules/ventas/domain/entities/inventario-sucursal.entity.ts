import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'inventario_sucursal' })
@Index(['sucursalId', 'productoId'], { unique: true })
export class InventarioSucursal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'stock_actual', type: 'int', default: 0 })
  stockActual: number;

  @Column({ name: 'stock_minimo', type: 'int', default: 0 })
  stockMinimo: number;

  @Column({ name: 'stock_maximo', type: 'int', default: 0 })
  stockMaximo: number;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}
