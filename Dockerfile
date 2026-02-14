# Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Build backend
FROM golang:1.22-alpine AS backend-builder

WORKDIR /app
RUN apk add --no-cache gcc musl-dev

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .
RUN CGO_ENABLED=1 GOOS=linux go build -o /shitcord-api ./cmd/server

# Runtime
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app

COPY --from=backend-builder /shitcord-api .
COPY --from=frontend-builder /app/dist ./frontend-dist

RUN mkdir -p uploads

EXPOSE 8080
CMD ["./shitcord-api"]
