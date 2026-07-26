# Stage 1: Build Go microservice
FROM golang:alpine AS builder
WORKDIR /app

# Install ca-certificates and git if needed
RUN apk add --no-cache ca-certificates git

COPY go-scraper/go.mod go-scraper/go.sum ./
RUN go mod download

COPY go-scraper/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o go-server main.go

# Stage 2: Minimal runtime image (Alpine Linux)
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata

RUN adduser -D -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH
WORKDIR $HOME

COPY --from=builder --chown=user /app/go-server $HOME/go-server

EXPOSE 7860
ENV PORT=7860

CMD ["/home/user/go-server"]
