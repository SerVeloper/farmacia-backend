import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Sucursal } from './domain/entities/sucursal.entity';
import { SucursalesService } from './application/services/sucursales.service';
import { SucursalesController } from './presentation/controllers/sucursales.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Sucursal])],
  controllers: [SucursalesController],
  providers: [SucursalesService],
  exports: [SucursalesService],
})
export class SucursalesModule {}
