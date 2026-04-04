import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
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
}
