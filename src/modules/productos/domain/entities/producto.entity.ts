import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'productos' })
export class Producto {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  nombre: string;

  @Column({ length: 50, unique: true })
  codigo: string;

  @Column({ name: 'categoria_id', nullable: true })
  categoriaId: string;

  @Column({ name: 'marca_id', nullable: true })
  marcaId: string;

  @Column({ name: 'principio_activo', length: 255, nullable: true })
  principioActivo: string;

  @Column({ length: 20, default: 'pieza' })
  unidad: string;

  @Column({
    name: 'precio_compra',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  precioCompra: number;

  @Column({
    name: 'precio_venta',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  precioVenta: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 20 })
  margen: number;

  @Column({ name: 'stock_minimo', type: 'int', default: 0 })
  stockMinimo: number;

  @Column({ name: 'stock_maximo', type: 'int', default: 0 })
  stockMaximo: number;

  @Column({ name: 'es_controlado', type: 'boolean', default: false })
  esControlado: boolean;

  @Column({ name: 'es_medicamento', type: 'boolean', default: false })
  esMedicamento: boolean;

  @Column({ type: 'text', nullable: true })
  descripcion: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}
