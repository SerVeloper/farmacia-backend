import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'proveedores' })
export class Proveedor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 180, unique: true })
  nombre: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  nit: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  telefono: string | null;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}
