FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node services ./services
COPY --chown=node:node apps/records-contracting/package.json ./apps/records-contracting/package.json
COPY --chown=node:node apps/records-contracting/src ./apps/records-contracting/src
COPY --chown=node:node apps/records-contracting/data ./apps/records-contracting/data
COPY --chown=node:node apps/records-contracting/public ./apps/records-contracting/public
RUN mkdir -p /state && chown node:node /state
USER node
ENV SERVICE_HOST=0.0.0.0
CMD ["node", "services/start.mjs"]
