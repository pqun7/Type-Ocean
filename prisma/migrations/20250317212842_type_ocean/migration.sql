-- CreateEnum
CREATE TYPE "TextType" AS ENUM ('SHORT', 'MEDIUM', 'LONG');

-- CreateTable
CREATE TABLE "Texts" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "length" INTEGER NOT NULL,
    "type" "TextType" NOT NULL,

    CONSTRAINT "Texts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Texts_content_key" ON "Texts"("content");
