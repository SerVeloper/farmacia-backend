import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsUUID,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductoDto {
  @ApiProperty({
    example: 'Paracetamol 500mg',
    description: 'Nombre del producto',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nombre: string;

  @ApiPropertyOptional({
    example: '12345678-abcd',
    description: 'Código único (auto-generado si no se proporciona)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codigo?: string;

  @ApiPropertyOptional({ description: 'UUID de la categoría', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @ApiPropertyOptional({ description: 'UUID de la marca', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  marcaId?: string;

  @ApiPropertyOptional({
    example: 'Paracetamol',
    description: 'Principio activo',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  principioActivo?: string;

  @ApiPropertyOptional({ example: 'tableta', description: 'Unidad de medida' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unidad?: string;

  @ApiPropertyOptional({ example: 10, description: 'Precio de compra' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioCompra?: number;

  @ApiPropertyOptional({ example: 12, description: 'Precio de venta' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioVenta?: number;

  @ApiPropertyOptional({ example: 20, description: 'Margen de ganancia (%)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  margen?: number;

  @ApiPropertyOptional({ example: 10, description: 'Stock mínimo' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMinimo?: number;

  @ApiPropertyOptional({ example: 100, description: 'Stock máximo' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMaximo?: number;

  @ApiPropertyOptional({ example: false, description: 'Venta controlada' })
  @IsOptional()
  @IsBoolean()
  esControlado?: boolean;

  @ApiProperty({
    example: false,
    description:
      'Clasificacion explicita de medicamento (decision humana obligatoria). ' +
      'true habilita lote/vencimiento obligatorio en compras y FEFO en ventas; ' +
      'false mantiene el flujo sin lote. No se admite ausencia: no existe ' +
      'default implicito en el alta',
  })
  @IsBoolean()
  esMedicamento: boolean;

  @ApiPropertyOptional({
    example: 'Analgésico y antipirético',
    description: 'Descripción',
  })
  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class UpdateProductoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  codigo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  marcaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  principioActivo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unidad?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioCompra?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  precioVenta?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  margen?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMinimo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMaximo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  esControlado?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Reclasificacion explicita a medicamento. Si se omite no se modifica ' +
      'la clasificacion existente',
  })
  @IsOptional()
  @IsBoolean()
  esMedicamento?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
