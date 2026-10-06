import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Lote } from './domain/entities/lote.entity';
import { InventarioLoteSucursal } from './domain/entities/inventario-lote-sucursal.entity';
import { ReconciliacionLote } from './domain/entities/reconciliacion-lote.entity';
import { UsersModule } from '../users/users.module';
import { LotesController } from './presentation/controllers/lotes.controller';
import { LotesReconciliacionController } from './presentation/controllers/lotes-reconciliacion.controller';
import { LotesService } from './application/services/lotes.service';
import { LotStockService } from './application/services/lot-stock.service';
import { ExpiryAlertsService } from './application/services/expiry-alerts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lote,
      InventarioLoteSucursal,
      ReconciliacionLote,
    ]),
    UsersModule,
  ],
  controllers: [LotesController, LotesReconciliacionController],
  providers: [LotesService, LotStockService, ExpiryAlertsService],
  exports: [LotesService, LotStockService, ExpiryAlertsService],
})
export class LotesModule {}
