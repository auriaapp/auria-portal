# Serviço de conversão IFC->Fragments do Auria CDE (Cloud Run)
FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.mjs ./

# Heap do Node abaixo da memória do container (--memory no deploy), deixando
# folga para o web-ifc/wasm (memória "externa", fora do heap V8) e o SO.
# Ajuste junto com --memory se mudar o deploy (ver README.md).
ENV NODE_OPTIONS=--max-old-space-size=6144

EXPOSE 8080
CMD ["node", "server.mjs"]
