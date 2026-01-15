FROM node:22-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Generar el cliente de Prisma
RUN npx prisma generate

# Exponer el puerto que usa tu app
EXPOSE 6000

# Comando para correr migraciones y luego iniciar
CMD npx prisma db push && npm run dev
