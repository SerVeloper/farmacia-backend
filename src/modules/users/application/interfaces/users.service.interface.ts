import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from '../dto/create-user.dto';
import { User, UserRole } from '../../domain/entities/user.entity';

export type IUserWithoutPassword = Omit<User, 'passwordHash'>;

export interface IUsersService {
  create(createUserDto: CreateUserDto): Promise<IUserWithoutPassword>;
  findAll(): Promise<IUserWithoutPassword[]>;
  findOne(id: string): Promise<IUserWithoutPassword>;
  update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<IUserWithoutPassword>;
  remove(id: string): Promise<void>;
  resetPassword(id: string, resetPasswordDto: ResetPasswordDto): Promise<void>;
  findByEmailForAuth(email: string): Promise<User | null>;
  touchLastLogin(id: string): Promise<void>;
  ensureAdminExists(
    defaultEmail: string,
    defaultPassword: string,
  ): Promise<void>;
  sanitizeUser(user: User): IUserWithoutPassword;
  isAdminRole(rol: UserRole): boolean;
}
