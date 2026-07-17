-- Nomor WhatsApp user (untuk simulasi notifikasi — belum terhubung provider nyata).
ALTER TABLE "users" ADD COLUMN "phone" TEXT;

-- Log simulasi pengingat WhatsApp ke Checker selama window pengisian realisasi.
CREATE TABLE "whatsapp_logs" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT,
    "templateType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pendingCount" INTEGER NOT NULL DEFAULT 0,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_logs_pkey" PRIMARY KEY ("id")
);
