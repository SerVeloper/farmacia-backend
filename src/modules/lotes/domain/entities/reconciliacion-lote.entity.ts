import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'reconciliacion_lote' })
@Index('IDX_reconciliacion_lote_sucursal_producto', [
  'sucursalId',
  'productoId',
])
export class ReconciliacionLote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sucursal_id', type: 'uuid' })
  sucursalId: string;

  @Column({ name: 'producto_id', type: 'uuid' })
  productoId: string;

  @Column({ name: 'lote_id', type: 'uuid', nullable: true })
  loteId: string | null;

  @Column({ name: 'cantidad_antes', type: 'int' })
  cantidadAntes: number;

  @Column({ name: 'cantidad_despues', type: 'int' })
  cantidadDespues: number;

  @Column({ type: 'text' })
  motivo: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}