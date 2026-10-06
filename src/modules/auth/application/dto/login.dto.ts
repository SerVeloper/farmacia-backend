import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@farmacia.local' })
  @IsEmail()
  @MaxLength(180)
  email: string;

  @ApiProperty({ example: 'admin1234' })
  @IsString()
  @MinLength(6)
  @MaxLength(100)
  password: string;

  @ApiProperty({
    example: false,
    required: false,
    description: 'Mantiene la sesion activa por 15 dias',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;

  @ApiProperty({
    required: false,
    example: '98f90286-ec67-4d33-b5f3-e786f5cdb589',
    description:
      'Sucursal activa para el inicio de sesion. Si no se envia para admin o contador, se asigna la primera sucursal activa',
  })
  @IsOptional()
  @IsUUID()
  sucursalActivaId?: string;
}
