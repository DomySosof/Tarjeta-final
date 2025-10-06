# Usa una imagen base de Node.js
FROM node:18-alpine

# Define el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia los archivos de configuración
COPY package*.json ./

# Instala las dependencias (Express y SQLite)
RUN npm install

# Copia todos los archivos de tu proyecto
# Nota: Esto incluye server.js y la carpeta public
COPY . .

# El puerto que Node.js expone
EXPOSE 3000

# Comando para iniciar la aplicación Node.js
CMD [ "npm", "start" ]