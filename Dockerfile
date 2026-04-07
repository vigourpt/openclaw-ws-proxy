FROM node:20-alpine
WORKDIR /app
RUN npm install ws
COPY index.js .
EXPOSE 3002
ENV PORT=3002 GATEWAY_WS=ws://127.0.0.1:45397
CMD ["node", "index.js"]
