import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CloseCajaDto {
  @ApiProperty({ example: 925.5, description: 'Monto contado al cierre' })
  @IsNumber()
  @Min(0)
  @Max(999999999)
  montoCierreReal: number;

  @ApiPropertyOptional({
    example: 'Diferencia por faltante de cambio en caja',
    description: 'Requerido cuando existe diferencia de cierre',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacion?: string;
}
