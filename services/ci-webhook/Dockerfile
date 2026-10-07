# services/ci-webhook — the GitHub-webhook listener that replaces
# GitHub Actions (permanently broken server-side for this repo) as the
# deploy trigger. Static binary, same minimal-footprint shape as
# services/core-go/Dockerfile.

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY services/ci-webhook/go.mod services/ci-webhook/go.sum ./
RUN go mod download
COPY services/ci-webhook/. .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/ci-webhook .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /out/ci-webhook /usr/local/bin/ci-webhook
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/ci-webhook"]
