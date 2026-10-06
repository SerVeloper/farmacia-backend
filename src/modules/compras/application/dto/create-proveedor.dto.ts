import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProveedorDto {
  @ApiProperty({ example: 'Distribuidora Salud Total' })
  @IsString()
  @MaxLength(180)
  nombre: string;

  @ApiPropertyOptional({ example: '1029384756' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nit?: string;

  @ApiPropertyOptional({ example: '77443322' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @ApiPropertyOptional({ example: 'Av. Heroínas 123' })
  @IsOptional()
  @IsString()
  direccion?: string;
}

export class UpdateProveedorDto {
  @ApiPropertyOptional({ example: 'Distribuidora Salud Total' })
  @IsOptional()
  @IsString()
  @MaxLength(180)
  nombre?: string;

  @ApiPropertyOptional({ example: '1029384756' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nit?: string;

  @ApiPropertyOptional({ example: '77443322' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @ApiPropertyOptional({ example: 'Av. Heroínas 123' })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
