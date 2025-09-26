FROM node:20-alpine

WORKDIR /app

# 先複製所有源代碼
COPY . ./

# 建立資料目錄並設定權限
RUN mkdir -p /app/data && \
    chown -R node:node /app

# 安裝所有必要的套件
RUN npm init -y && \
    npm install --save express socket.io cors @socket.io/admin-ui better-sqlite3 && \
    npm install -g typescript && \
    npm install --save-dev @types/node @types/express @types/socket.io @types/cors ts-node && \
    npm install -g nodemon concurrently

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

# 設定使用者為 node
USER node

EXPOSE 1034

CMD ["/bin/sh", "-c", "tsc -p tsconfig.json --watch & nodemon index.js"] 
