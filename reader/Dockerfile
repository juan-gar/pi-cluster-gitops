# Book reader: Vite-built UI + a static Go binary, on distroless.
#
# Contains CODE ONLY. Book text is uploaded at runtime into the /data volume
# and must never be COPY'd in here - this image is public on GHCR, like the
# repo. .dockerignore keeps books/ and data/ out of the build context too.

# The node and go stages run on the build machine's own architecture and
# cross-compile; only the tiny final stage is per-platform. That avoids
# building under QEMU, which is what makes arm64 builds on GitHub's amd64
# runners slow.
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS server
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /book-reader .

# distroless/static: no shell, no package manager; runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /book-reader /app/book-reader
COPY --from=web /web/dist /app/static
ENV READER_DATA_DIR=/data READER_STATIC_DIR=/app/static READER_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/app/book-reader"]
