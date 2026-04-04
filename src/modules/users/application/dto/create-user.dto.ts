import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { UserRole } from '../../domain/entities/user.entity';
import { RoleCode } from '../../domain/entities/role.entity';

export class CreateUserDto {
  @ApiProperty({ example: 'Administrador General' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @ApiProperty({ example: 'admin@farmacia.local' })
  @IsEmail()
  @MaxLength(180)
  email: string;

  @ApiProperty({ example: 'admin1234' })
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.CASHIER })
  @IsOptional()
  @IsEnum(UserRole)
  rol?: UserRole;

  @ApiPropertyOptional({
    description: 'Codigos de roles del usuario',
    enum: RoleCode,
    isArray: true,
    example: [RoleCode.VENDEDOR, RoleCode.CONTADOR],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(RoleCode, { each: true })
  rolesCodigos?: RoleCode[];

  @ApiPropertyOptional({
    description: 'UUID de sucursal (opcional para admin global)',
  })
  @IsOptional()
  @IsUUID()
  sucursalId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  rol?: UserRole;

  @ApiPropertyOptional({
    description: 'Codigos de roles del usuario',
    enum: RoleCode,
    isArray: true,
    example: [RoleCode.REGENTE],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(RoleCode, { each: true })
  rolesCodigos?: RoleCode[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sucursalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'nuevaClave123' })
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password: string;
}
