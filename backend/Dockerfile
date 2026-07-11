# Stage 1: Build Go microservice
FROM golang:1.21-alpine AS go-builder
WORKDIR /app
COPY go-scraper/go.mod go-scraper/go.sum ./
RUN go mod download
COPY go-scraper/ ./
RUN go build -o go-server main.go

# Stage 2: Setup Node.js backend
FROM node:20-slim
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install
RUN npm install pm2 -g

# Copy Go binary from stage 1
COPY --from=go-builder /app/go-server /app/go-server

# Copy the rest of the Node application
COPY . .

EXPOSE 7860
ENV PORT=7860

CMD ["pm2-runtime", "ecosystem.config.cjs"]
