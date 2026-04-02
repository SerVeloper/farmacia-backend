import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Marca } from './domain/entities/marca.entity';
import { MarcasController } from './presentation/controllers/marcas.controller';
import { MarcasService } from './application/services/marcas.service';

@Module({
  imports: [TypeOrmModule.forFeature([Marca])],
  controllers: [MarcasController],
  providers: [MarcasService],
  exports: [MarcasService],
})
export class MarcasModule {}
