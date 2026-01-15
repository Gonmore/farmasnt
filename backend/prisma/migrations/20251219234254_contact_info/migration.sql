-- CreateTable
CREATE TABLE "ContactInfo" (
    "id" TEXT NOT NULL,
    "modalHeader" TEXT NOT NULL DEFAULT 'Contactos',
    "modalBody" TEXT NOT NULL DEFAULT 'Únete a este sistema o solicita el tuyo personalizado:
- 📧 contactos@supernovatel.com
- 💬 +591 65164773',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "ContactInfo_pkey" PRIMARY KEY ("id")
);
