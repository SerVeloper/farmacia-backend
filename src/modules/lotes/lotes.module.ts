import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Lote } from './domain/entities/lote.entity';
import { LotesController } from './presentation/controllers/lotes.controller';
import { LotesService } from './application/services/lotes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lote])],
  controllers: [LotesController],
  providers: [LotesService],
  exports: [LotesService],
})
export class LotesModule {}
