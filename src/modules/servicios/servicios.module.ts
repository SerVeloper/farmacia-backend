import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Servicio } from './domain/entities/servicio.entity';
import { ServiciosController } from './presentation/controllers/servicios.controller';
import { ServiciosService } from './application/services/servicios.service';

@Module({
  imports: [TypeOrmModule.forFeature([Servicio])],
  controllers: [ServiciosController],
  providers: [ServiciosService],
  exports: [ServiciosService],
})
export class ServiciosModule {}
