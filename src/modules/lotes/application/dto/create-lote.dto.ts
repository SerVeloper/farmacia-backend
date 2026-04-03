import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLoteDto {
  @ApiProperty({ description: 'UUID del producto', format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  productoId: string;

  @ApiProperty({ example: 'LOTE001', description: 'Número de lote' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  numeroLote: string;

  @ApiProperty({ example: '2025-12-31', description: 'Fecha de vencimiento' })
  @IsDateString()
  fechaVencimiento: string;

  @ApiProperty({ example: 100, description: 'Cantidad inicial' })
  @IsNumber()
  @Min(0)
  cantidadInicial: number;
}

export class UpdateLoteDto {
  @ApiPropertyOptional({ example: 'LOTE002' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroLote?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cantidadInicial?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
