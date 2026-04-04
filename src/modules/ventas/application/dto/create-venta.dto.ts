import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
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
import { Type } from 'class-transformer';

import { VentaMetodoPago } from '../../domain/entities/venta-pago.entity';

export class CreateVentaItemDto {
  @ApiProperty({ example: 'b9ca8f60-df6d-4a6e-ab90-7a647dbf8e31' })
  @IsUUID()
  productoId: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(1)
  @Max(9999)
  cantidad: number;

  @ApiPropertyOptional({ example: 1.5, description: 'Descuento manual en Bs' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  descuentoMonto?: number;
}

export class CreateVentaPagoDto {
  @ApiProperty({ enum: VentaMetodoPago, example: VentaMetodoPago.EFECTIVO })
  @IsEnum(VentaMetodoPago)
  metodoPago: VentaMetodoPago;

  @ApiProperty({ example: 100, description: 'Monto del pago en Bs' })
  @IsNumber()
  @Min(0.01)
  @Max(999999999)
  monto: number;

  @ApiPropertyOptional({ example: 'TRX-00012345' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  referencia?: string;
}

export class CreateVentaDto {
  @ApiProperty({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsUUID()
  sucursalId: string;

  @ApiPropertyOptional({ example: 5, description: 'Descuento global en Bs' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999999999)
  descuentoGlobal?: number;

  @ApiProperty({ type: [CreateVentaItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVentaItemDto)
  items: CreateVentaItemDto[];

  @ApiProperty({ type: [CreateVentaPagoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVentaPagoDto)
  pagos: CreateVentaPagoDto[];
}
