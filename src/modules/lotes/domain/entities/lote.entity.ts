import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'lotes_productos' })
@Index(
  'UQ_lotes_identidad',
  ['productoId', 'numeroLoteNormalizado', 'fechaVencimiento'],
  { unique: true },
)
export class Lote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'producto_id' })
  productoId: string;

  @Column({ length: 50 })
  numeroLote: string;

  @Column({ name: 'numero_lote_normalizado', length: 50 })
  numeroLoteNormalizado: string;

  @Column({ name: 'fecha_vencimiento', type: 'date' })
  fechaVencimiento: Date;

  @Column({ name: 'cantidad_inicial', type: 'int', default: 0 })
  cantidadInicial: number;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}
