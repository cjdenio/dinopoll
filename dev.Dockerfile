FROM node:15-alpine

WORKDIR /usr/src/app

COPY . .

RUN yarn install

CMD ["yarn", "dev"]