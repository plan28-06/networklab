# FROM node:18-alpine   ❌
FROM node:18-bullseye  

WORKDIR /app

COPY package*.json ./
RUN npm install

# Install QEMU tools
RUN apt-get update && apt-get install -y qemu-system-x86 qemu-utils

COPY . .

EXPOSE 5000
CMD ["npm", "start"]
