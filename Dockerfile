# Imagen base oficial de Node.js 22 LTS
FROM node:22-alpine

# Directorio de trabajo en el contenedor
WORKDIR /app

# Instalar dependencias necesarias para compilar paquetes nativos si hiciera falta (bcrypt)
RUN apk add --no-cache python3 make g++

# Copiar archivos de dependencias del backend
COPY backend/package*.json ./backend/

# Instalar dependencias de producción en backend
WORKDIR /app/backend
RUN npm ci --omit=dev

# Volver a la raíz del proyecto
WORKDIR /app

# Copiar el frontend (todo lo que se publica vive en public/)
COPY public ./public

# Copiar el código del backend
COPY backend ./backend

# Exponer el puerto donde corre la aplicación
EXPOSE 3000

# Variable de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Comando para iniciar el servidor
CMD ["node", "backend/server.js"]
