import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class VentasQueryDto {
  @ApiPropertyOptional({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional({ example: '4b8e4ca6-b73a-413d-a8db-11a79de9d155' })
  @IsOptional()
  @IsUUID()
  vendedorId?: string;

  @ApiPropertyOptional({ example: 'VT-CBBA-20260404-0001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroVenta?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  desde?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsDateString()
  hasta?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 15, default: 15 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class VentasCatalogoQueryDto {
  @ApiPropertyOptional({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional({ example: 'paracetamol' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
