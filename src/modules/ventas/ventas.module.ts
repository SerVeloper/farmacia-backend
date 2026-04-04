import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CajasModule } from '../cajas/cajas.module';
import { ProductosModule } from '../productos/productos.module';
import { SucursalesModule } from '../sucursales/sucursales.module';
import { UsersModule } from '../users/users.module';
import { VentasService } from './application/services/ventas.service';
import { InventarioSucursal } from './domain/entities/inventario-sucursal.entity';
import { VentaItem } from './domain/entities/venta-item.entity';
import { VentaPago } from './domain/entities/venta-pago.entity';
import { Venta } from './domain/entities/venta.entity';
import { VentasController } from './presentation/controllers/ventas.controller';
import { Caja } from '../cajas/domain/entities/caja.entity';
import { CajaMovimiento } from '../cajas/domain/entities/caja-movimiento.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Venta,
      VentaItem,
      VentaPago,
      InventarioSucursal,
      Caja,
      CajaMovimiento,
    ]),
    UsersModule,
    SucursalesModule,
    ProductosModule,
    CajasModule,
  ],
  controllers: [VentasController],
  providers: [VentasService],
  exports: [VentasService],
})
export class VentasModule {}
