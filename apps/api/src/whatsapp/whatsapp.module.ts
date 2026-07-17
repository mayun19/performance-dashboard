import { Module } from '@nestjs/common';
import { WhatsappSimService } from './whatsapp.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [WhatsappSimService],
  exports: [WhatsappSimService],
})
export class WhatsappModule {}
