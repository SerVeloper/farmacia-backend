import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'inventario_lote_sucursal' })
@Index('UQ_inventario_lote_sucursal', ['sucursalId', 'loteId'], {
  unique: true,
})
export class InventarioLoteSucursal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'lote_id', type: 'uuid' })
  loteId: string;

  @Column({ type: 'int', default: 0 })
  cantidad: number;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;

  @UpdateDateColumn({ name: 'fecha_actualizacion' })
  fechaActualizacion: Date;
}