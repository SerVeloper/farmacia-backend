import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'venta_item_lotes' })
@Index('IDX_venta_item_lotes_lote', ['loteId'])
@Index('UQ_venta_item_lotes_item_lote', ['ventaItemId', 'loteId'], {
  unique: true,
})
export class VentaItemLote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'venta_item_id', type: 'uuid' })
  ventaItemId: string;

  @Column({ name: 'lote_id', type: 'uuid' })
  loteId: string;

  @Column({ type: 'int' })
  cantidad: number;

  @CreateDateColumn({ name: 'fecha_creacion' })
  fechaCreacion: Date;
}