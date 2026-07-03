FROM golang:1.22-bookworm AS build
WORKDIR /src

COPY go.mod ./
COPY *.go ./

RUN go mod tidy && \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/node-core .

FROM gcr.io/distroless/static-debian12

COPY --from=build /out/node-core /node-core

EXPOSE 8080

ENTRYPOINT ["/node-core"]
