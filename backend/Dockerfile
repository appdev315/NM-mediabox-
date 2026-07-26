# Stage 1: Build Go microservice
FROM golang:1.24-alpine AS builder
WORKDIR /app

# Install ca-certificates and git if needed
RUN apk add --no-cache ca-certificates git

COPY go-scraper/go.mod go-scraper/go.sum ./
RUN go mod download

COPY go-scraper/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o go-server main.go

# Stage 2: Minimal runtime image (Alpine Linux)
FROM alpine:latest
WORKDIR /app

# Install SSL root certificates for outbound HTTPS requests
RUN apk --no-cache add ca-certificates tzdata

COPY --from=builder /app/go-server ./go-server

EXPOSE 7860
ENV PORT=7860

CMD ["./go-server"]
