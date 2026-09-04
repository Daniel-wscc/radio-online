FROM node:20-alpine

WORKDIR /app

# better-sqlite3 是原生模組；Alpine 未提供預編譯檔時必須有 node-gyp 的編譯工具鏈。
RUN apk add --no-cache python3 make g++
# NAS 對 prebuild-install 的 GitHub 下載可能長時間無回應；直接從原始碼編譯較可靠。
ENV npm_config_build_from_source=true

# 先複製所有源代碼
COPY . ./

# 建立資料目錄並設定權限
RUN mkdir -p /app/data && \
    chown -R node:node /app

# 安裝所有必要的套件
RUN npm init -y && \
    npm install --foreground-scripts --no-audit --no-fund --save express@4.22.1 socket.io@4.8.1 cors@2.8.5 @socket.io/admin-ui@0.5.1 better-sqlite3@11.10.0 && \
    npm install --save-dev typescript@5.5.4 ts-node@10.9.2 nodemon@3.1.9 @types/node@22.12.0 @types/express@5.0.3 @types/cors@2.8.19 @types/better-sqlite3@7.6.13

# 建立 tsconfig.json
RUN echo '{\
  "compilerOptions": {\
    "module": "commonjs",\
    "esModuleInterop": true,\
    "allowSyntheticDefaultImports": true,\
    "target": "es6",\
    "moduleResolution": "node10",\
    "skipLibCheck": true,\
    "sourceMap": true,\
    "outDir": "."\
  },\
  "include": ["index.ts"],\
  "exclude": ["node_modules"]\
}' > tsconfig.json

# 編譯 TypeScript
RUN ./node_modules/.bin/tsc

# 設定使用者為 node
USER node

EXPOSE 1034

CMD ["/bin/sh", "-c", "./node_modules/.bin/tsc -p tsconfig.json --watch & ./node_modules/.bin/nodemon index.js"]
