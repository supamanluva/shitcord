# Backend Dockerfile
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o /shitcord-api ./cmd/server

# Runtime image
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /shitcord-api .
COPY .env.example .env

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8080

CMD ["./shitcord-api"]
