import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';

import { User, UserRole } from '../../domain/entities/user.entity';
import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from '../dto/create-user.dto';
import {
  IUsersService,
  IUserWithoutPassword,
} from '../interfaces/users.service.interface';

@Injectable()
export class UsersService implements IUsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<IUserWithoutPassword> {
    const normalizedEmail = createUserDto.email.trim().toLowerCase();
    const emailInUse = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (emailInUse) {
      throw new BadRequestException('El email ya esta registrado');
    }

    const passwordHash = await bcrypt.hash(createUserDto.password, 10);
    const user = this.usersRepository.create({
      nombre: createUserDto.nombre.trim(),
      email: normalizedEmail,
      passwordHash,
      rol: createUserDto.rol ?? UserRole.CASHIER,
      sucursalId: createUserDto.sucursalId ?? null,
    });

    const saved = await this.usersRepository.save(user);
    this.logger.log(`Usuario creado: ${saved.id}`);
    return this.sanitizeUser(saved);
  }

  async findAll(): Promise<IUserWithoutPassword[]> {
    const users = await this.usersRepository.find({
      order: { fechaCreacion: 'DESC' },
    });

    return users.map((user) => this.sanitizeUser(user));
  }

  async findOne(id: string): Promise<IUserWithoutPassword> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    return this.sanitizeUser(user);
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<IUserWithoutPassword> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    if (updateUserDto.email) {
      const normalizedEmail = updateUserDto.email.trim().toLowerCase();
      const existingUser = await this.usersRepository.findOne({
        where: { email: normalizedEmail },
      });

      if (existingUser && existingUser.id !== id) {
        throw new BadRequestException('El email ya esta registrado');
      }

      user.email = normalizedEmail;
    }

    if (updateUserDto.nombre !== undefined) {
      user.nombre = updateUserDto.nombre.trim();
    }

    if (updateUserDto.rol !== undefined) {
      user.rol = updateUserDto.rol;
    }

    if (updateUserDto.sucursalId !== undefined) {
      user.sucursalId = updateUserDto.sucursalId;
    }

    if (updateUserDto.activo !== undefined) {
      user.activo = updateUserDto.activo;
    }

    const updated = await this.usersRepository.save(user);
    return this.sanitizeUser(updated);
  }

  async remove(id: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    user.activo = false;
    await this.usersRepository.save(user);
    this.logger.log(`Usuario desactivado: ${id}`);
  }

  async resetPassword(
    id: string,
    resetPasswordDto: ResetPasswordDto,
  ): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    user.passwordHash = await bcrypt.hash(resetPasswordDto.password, 10);
    await this.usersRepository.save(user);
    this.logger.log(`Password reseteado por admin para usuario: ${id}`);
  }

  async findByEmailForAuth(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();

    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizedEmail })
      .getOne();
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.usersRepository.update(id, { ultimoAcceso: new Date() });
  }

  async ensureAdminExists(
    defaultEmail: string,
    defaultPassword: string,
  ): Promise<void> {
    const email = defaultEmail.trim().toLowerCase();
    const adminExists = await this.usersRepository.findOne({
      where: { email },
    });

    if (adminExists) {
      return;
    }

    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const admin = this.usersRepository.create({
      nombre: 'Administrador Inicial',
      email,
      passwordHash,
      rol: UserRole.ADMIN,
      sucursalId: null,
      activo: true,
    });

    await this.usersRepository.save(admin);
    this.logger.warn(`Admin inicial creado con email ${email}`);
  }

  sanitizeUser(user: User): IUserWithoutPassword {
    const safeUser = { ...user } as Partial<User>;
    delete safeUser.passwordHash;
    return safeUser as IUserWithoutPassword;
  }

  isAdminRole(rol: UserRole): boolean {
    return rol === UserRole.ADMIN;
  }
}
