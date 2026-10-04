FROM node:24-alpine
WORKDIR /app
COPY package.json city_query_site.html monitor-config.js ./
COPY backend ./backend
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
USER node
CMD ["node", "backend/server.mjs"]
