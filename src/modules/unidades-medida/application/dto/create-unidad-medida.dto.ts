import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateUnidadMedidaDto {
  @ApiProperty({ example: 'Caja' })
  @IsString()
  @MaxLength(100)
  nombre: string;

  @ApiProperty({ example: 'caja' })
  @IsString()
  @MaxLength(20)
  abreviatura: string;

  @ApiPropertyOptional({ example: 'Unidad para empaques de productos' })
  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class UpdateUnidadMedidaDto {
  @ApiPropertyOptional({ example: 'Frasco' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombre?: string;

  @ApiPropertyOptional({ example: 'fra' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  abreviatura?: string;

  @ApiPropertyOptional({ example: 'Unidad para presentacion liquida' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
