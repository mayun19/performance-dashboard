import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { User } from "@prisma/client";

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.COOKIE_SECURE === "true",
};

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } = await this.auth.login(
      dto.email,
      dto.password,
    );
    res.cookie("access_token", accessToken, {
      ...COOKIE_OPTS,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refresh_token", refreshToken, {
      ...COOKIE_OPTS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth",
    });
    return { user };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.["refresh_token"] as string | undefined;

    // Safety net: whatever AuthService.refresh() does internally (verify
    // JWT, look up a stored/hashed token, rotate it), a missing/invalid/
    // expired refresh token is an auth failure, never a server error. This
    // is what's most likely turning into your 500 today — find and fix the
    // actual throw inside AuthService.refresh() too; this is a backstop,
    // not a substitute for that.
    if (!token) {
      throw new UnauthorizedException();
    }

    let result;
    try {
      result = await this.auth.refresh(token);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Any other error (JWT verify error, Prisma error, etc.) still means
      // "this refresh attempt failed" from the client's point of view —
      // normalize it to 401 instead of letting it become a 500.
      throw new UnauthorizedException();
    }

    const { accessToken, refreshToken, user } = await this.auth.refresh(token);
    res.cookie("access_token", accessToken, {
      ...COOKIE_OPTS,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refresh_token", refreshToken, {
      ...COOKIE_OPTS,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/api/auth",
    });
    return { user };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.["refresh_token"] as string;
        if (token) {
      // Logging out with an already-invalid/expired token should still
      // succeed from the client's perspective — it's ending a session that,
      // one way or another, is now over. Don't let a lookup failure here
      // block the cookies from being cleared.
      try {
        await this.auth.logout(token);
      } catch {
        /* already invalid/expired — nothing left to revoke */
      }
    }
    res.clearCookie("access_token");
    res.clearCookie("refresh_token", { path: "/api/auth" });
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User) {
    return this.auth.sanitize(user);
  }
}
