import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServicioDto {
  @ApiProperty({
    example: 'Aplicación de Inyectable',
    description: 'Nombre único del servicio',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nombre: string;

  @ApiPropertyOptional({
    example: 'Aplicación intramuscular',
    description: 'Descripción del servicio',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiProperty({
    example: 5000,
    description: 'Precio de venta del servicio (sin margen ni costo)',
  })
  @IsNumber()
  @IsPositive()
  precioVenta: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Estado del servicio (default: true)',
  })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class UpdateServicioDto {
  @ApiPropertyOptional({ example: 'Aplicación de Inyectable' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nombre?: string;

  @ApiPropertyOptional({ example: 'Aplicación intramuscular' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 5500 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  precioVenta?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
