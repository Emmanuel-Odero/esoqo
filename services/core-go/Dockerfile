# services/core-go — Esoko's mobile REST API (Gin). Built as a static
# binary so the runtime image carries no Go toolchain, matching the
# minimal-footprint reasoning in docs/adr/0004-language-allocation.md.

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY services/core-go/go.mod services/core-go/go.sum ./
RUN go mod download
COPY services/core-go/. .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/core-go ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /out/core-go /usr/local/bin/core-go
EXPOSE 4100
ENTRYPOINT ["/usr/local/bin/core-go"]
