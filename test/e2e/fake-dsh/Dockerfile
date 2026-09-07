# test/e2e/fake-dsh/Dockerfile — 最小实例镜像：任意路径 200，供反代链路验证。
FROM node:24-alpine
COPY server.mjs /server.mjs
EXPOSE 3000
CMD ["node", "/server.mjs"]
