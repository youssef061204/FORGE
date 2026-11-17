FROM node:24-alpine
WORKDIR /sandbox
COPY worker.mjs /sandbox/worker.mjs
COPY module-worker.mjs /sandbox/module-worker.mjs
USER node
CMD ["node", "--permission", "--allow-fs-read=/sandbox/worker.mjs", "--max-old-space-size=64", "--disable-proto=throw", "/sandbox/worker.mjs"]
