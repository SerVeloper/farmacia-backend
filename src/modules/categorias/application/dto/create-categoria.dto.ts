import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoriaDto {
  @ApiProperty({ example: 'Analgésico', description: 'Nombre de la categoría' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nombre: string;

  @ApiPropertyOptional({
    example: 'Medicamentos para el dolor',
    description: 'Descripción de la categoría',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;
}

export class UpdateCategoriaDto {
  @ApiPropertyOptional({ example: 'Antiinflamatorio' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nombre?: string;

  @ApiPropertyOptional({ example: 'Medicamentos para reducir inflamación' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  descripcion?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
