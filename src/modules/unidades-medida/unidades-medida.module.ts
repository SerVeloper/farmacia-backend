import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UnidadMedida } from './domain/entities/unidad-medida.entity';
import { UnidadesMedidaService } from './application/services/unidades-medida.service';
import { UnidadesMedidaController } from './presentation/controllers/unidades-medida.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UnidadMedida])],
  controllers: [UnidadesMedidaController],
  providers: [UnidadesMedidaService],
  exports: [UnidadesMedidaService],
})
export class UnidadesMedidaModule {}
