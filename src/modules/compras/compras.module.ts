import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CategoriasModule } from '../categorias/categorias.module';
import { LotesModule } from '../lotes/lotes.module';
import { MarcasModule } from '../marcas/marcas.module';
import { SucursalesModule } from '../sucursales/sucursales.module';
import { UsersModule } from '../users/users.module';
import { InventarioSucursal } from '../ventas/domain/entities/inventario-sucursal.entity';
import { Categoria } from '../categorias/domain/entities/categoria.entity';
import { Marca } from '../marcas/domain/entities/marca.entity';
import { Producto } from '../productos/domain/entities/producto.entity';
import { ComprasService } from './application/services/compras.service';
import { CompraItem } from './domain/entities/compra-item.entity';
import { CompraPago } from './domain/entities/compra-pago.entity';
import { Compra } from './domain/entities/compra.entity';
import { Proveedor } from './domain/entities/proveedor.entity';
import { ComprasController } from './presentation/controllers/compras.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Compra,
      CompraItem,
      CompraPago,
      Proveedor,
      InventarioSucursal,
      Producto,
      Categoria,
      Marca,
    ]),
    AuthModule,
    UsersModule,
    SucursalesModule,
    CategoriasModule,
    MarcasModule,
    LotesModule,
  ],
  controllers: [ComprasController],
  providers: [ComprasService],
  exports: [ComprasService],
})
export class ComprasModule {}
