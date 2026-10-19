import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

export type PublicUser = Omit<User, 'password'>;

const omitPassword = { password: true } as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.UserCreateInput): Promise<PublicUser> {
    try {
      return await this.prisma.user.create({ data, omit: omitPassword });
    } catch (error) {
      this.handleError(error);
    }
  }

  findAll(): Promise<PublicUser[]> {
    return this.prisma.user.findMany({
      orderBy: { id: 'asc' },
      omit: omitPassword,
    });
  }

  async findOne(id: number): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      omit: omitPassword,
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  // Includes the password hash — only for credential checks, never return it from a controller.
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async update(id: number, dto: UpdateUserDto): Promise<PublicUser> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: dto,
        omit: omitPassword,
      });
    } catch (error) {
      this.handleError(error, id);
    }
  }

  async remove(id: number): Promise<PublicUser> {
    try {
      return await this.prisma.user.delete({
        where: { id },
        omit: omitPassword,
      });
    } catch (error) {
      this.handleError(error, id);
    }
  }

  private handleError(error: unknown, id?: number): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('Email is already in use');
      }
      if (error.code === 'P2025') {
        throw new NotFoundException(`User ${id} not found`);
      }
    }
    throw error;
  }
}
