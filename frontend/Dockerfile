FROM nginx:1.27-alpine

COPY public /usr/share/nginx/html
COPY frontend/default.conf.template /etc/nginx/templates/default.conf.template
COPY frontend/40-generate-env.sh /docker-entrypoint.d/40-generate-env.sh

RUN chmod +x /docker-entrypoint.d/40-generate-env.sh

EXPOSE 8081
