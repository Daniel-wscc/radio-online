FROM node:18-alpine

WORKDIR /app

COPY index.ts ./

# 安裝所有必要的套件
RUN npm init -y && \
    npm install express socket.io cors && \
    npm install -g typescript && \
    npm install -D @types/node @types/express @types/socket.io @types/cors

# 建立 tsconfig.json
RUN echo '{\
  "compilerOptions": {\
    "module": "commonjs",\
    "esModuleInterop": true,\
    "allowSyntheticDefaultImports": true,\
    "target": "es6",\
    "moduleResolution": "node",\
    "sourceMap": true,\
    "outDir": "."\
  },\
  "include": ["index.ts"],\
  "exclude": ["node_modules"]\
}' > tsconfig.json

# 編譯 TypeScript
RUN tsc

EXPOSE 1034

CMD ["node", "index.js"] 