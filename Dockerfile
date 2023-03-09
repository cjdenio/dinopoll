FROM node:16-alpine

WORKDIR /usr/src/app

COPY . .

RUN yarn install

RUN node --version
RUN yarn tsc --version

RUN yarn build

CMD ["yarn", "start"]
