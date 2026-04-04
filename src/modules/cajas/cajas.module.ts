import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { SucursalesModule } from '../sucursales/sucursales.module';
import { UsersModule } from '../users/users.module';
import { CajasService } from './application/services/cajas.service';
import { CajaMovimiento } from './domain/entities/caja-movimiento.entity';
import { Caja } from './domain/entities/caja.entity';
import { CajasController } from './presentation/controllers/cajas.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Caja, CajaMovimiento]),
    AuthModule,
    UsersModule,
    SucursalesModule,
  ],
  controllers: [CajasController],
  providers: [CajasService],
  exports: [CajasService],
})
export class CajasModule {}
