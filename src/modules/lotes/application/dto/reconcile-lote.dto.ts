import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AsignacionLoteDto {
  @ApiProperty({
    description: 'UUID del lote que pertenece al producto reconciliado',
    format: 'uuid',
  })
  @IsUUID()
  loteId: string;

  @ApiProperty({
    description: 'Cantidad fisica contada para el lote (0 permitida)',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  cantidad: number;
}

export class ReconcileLoteDto {
  @ApiPropertyOptional({
    description:
      'Sucursal a reconciliar. Si se omite se usa la sucursal del contexto activo',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiProperty({ description: 'Producto a reconciliar', format: 'uuid' })
  @IsUUID()
  productoId: string;

  @ApiProperty({
    type: [AsignacionLoteDto],
    description:
      'Distribucion completa de saldos por lote. La suma debe igualar stock_actual',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AsignacionLoteDto)
  asignaciones: AsignacionLoteDto[];

  @ApiProperty({ description: 'Motivo obligatorio de la conciliacion' })
  @IsString()
  @MinLength(5)
  motivo: string;
}
