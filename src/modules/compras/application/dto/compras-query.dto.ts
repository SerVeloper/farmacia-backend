import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ComprasQueryDto {
  @ApiPropertyOptional({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional({ example: '9f419744-3169-4ac2-a644-a70f9f0aa3a2' })
  @IsOptional()
  @IsUUID()
  proveedorId?: string;

  @ApiPropertyOptional({ example: 'CP-CBBA-20260404-0001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  numeroCompra?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  desde?: string;

  @ApiPropertyOptional({ example: '2026-04-30' })
  @IsOptional()
  @IsDateString()
  hasta?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class ComprasCatalogoQueryDto {
  @ApiPropertyOptional({ example: '98f90286-ec67-4d33-b5f3-e786f5cdb589' })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional({ example: 'amoxicilina' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
