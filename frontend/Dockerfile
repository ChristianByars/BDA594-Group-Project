# Serves the static dashboard with nginx on port 80.
# Build from the repo root:  docker build -f frontend/Dockerfile -t crime-dashboard .
# Run:                       docker run --rm -p 8080:80 crime-dashboard   (then open http://localhost:8080)
FROM nginx:alpine

COPY frontend/ /usr/share/nginx/html/

EXPOSE 80
