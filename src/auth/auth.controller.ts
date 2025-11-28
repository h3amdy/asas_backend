import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OwnerLoginDto } from './dto/owner-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('owner/login')
  ownerLogin(@Body() dto: OwnerLoginDto) {
    return this.authService.loginOwner(dto);
  }
}
