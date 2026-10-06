import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  CompraTipoComprobante,
  CompraMetodoPago,
} from '../../domain/entities/compra.entity';
import { CompraPagoMetodo } from '../../domain/entities/compra-pago.entity';

export class QuickCreateProductoCompraDto {
  @ApiProperty({ example: 'Amoxicilina 500mg' })
  @IsString()
  @MaxLength(255)
  nombre: string;

  @ApiProperty({ example: 'Amoxicilina' })
  @IsString()
  @MaxLength(255)
  principioActivo: string;

  @ApiProperty({ example: 'e8a553dc-4da9-4e8b-8424-dce0d4fdcc53' })
  @IsUUID()
  marcaId: string;

  @ApiProperty({ example: 'd7e30dfa-cc70-4f2c-8aa6-8f2b9576f620' })
  @IsUUID()
  categoriaId: string;
}

export class CreateCompraItemDto {
  @ApiPropertyOptional({ example: 'b9ca8f60-df6d-4a6e-ab90-7a647dbf8e31' })
  @IsOptional()
  @IsUUID()
  productoId?: string;

  @ApiPropertyOptional({ type: QuickCreateProductoCompraDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuickCreateProductoCompraDto)
  productoNuevo?: QuickCreateProductoCompraDto;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(1)
  @Max(999999)
  cantidadCompra: number;

  @ApiProperty({ example: 'caja' })
  @IsString()
  @MaxLength(30)
  unidadCompra: string;

  @ApiProperty({ example: 12, description: 'Cantidad de unidades por compra' })
  @IsNumber()
  @Min(1)
  @Max(9999)
  factor: number;

  @ApiProperty({
    example: 120,
    description: 'Costo por unidad de compra (caja, blíster, etc.)',
  })
  @IsNumber()
  @Min(0.01)
  @Max(999999999)
  costoCompraUnitario: number;

  @ApiPropertyOptional({ example: 'LOTE-2026-AB01' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lote?: string;

  @ApiPropertyOptional({ example: '2027-05-20' })
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  descuentoMonto?: number;

  @ApiProperty({ example: 30, description: 'Margen en porcentaje' })
  @IsNumber()
  @Min(0)
  @Max(9999)
  margen: number;

  @ApiProperty({ example: 13, description: 'Precio de venta resultante' })
  @IsNumber()
  @Min(0.01)
  @Max(999999999)
  precioVenta: number;
}

export class CreateCompraPagoDto {
  @ApiProperty({ enum: CompraPagoMetodo, example: CompraPagoMetodo.EFECTIVO })
  @IsEnum(CompraPagoMetodo)
  metodoPago: CompraPagoMetodo;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0.01)
  @Max(999999999)
  monto: number;

  @ApiPropertyOptional({ example: 'TRX-0193822' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  referencia?: string;
}

export class CreateCompraDto {
  @ApiProperty({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsUUID()
  sucursalId: string;

  @ApiProperty({ example: '9f419744-3169-4ac2-a644-a70f9f0aa3a2' })
  @IsUUID()
  proveedorId: string;

  @ApiProperty({ enum: CompraMetodoPago, example: CompraMetodoPago.MIXTO })
  @IsEnum(CompraMetodoPago)
  metodoPago: CompraMetodoPago;

  @ApiProperty({
    enum: CompraTipoComprobante,
    example: CompraTipoComprobante.FACTURA,
  })
  @IsEnum(CompraTipoComprobante)
  tipoComprobante: CompraTipoComprobante;

  @ApiProperty({ example: 'F-00123' })
  @IsString()
  @MaxLength(80)
  numeroComprobante: string;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  descuentoGlobal?: number;

  @ApiProperty({ type: [CreateCompraItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompraItemDto)
  items: CreateCompraItemDto[];

  @ApiProperty({ type: [CreateCompraPagoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCompraPagoDto)
  pagos: CreateCompraPagoDto[];
}
