import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'lotes_productos' })
export class Lote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'producto_id' })
  productoId: string;

  @Column({ length: 50 })
  numeroLote: string;

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
