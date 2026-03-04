.PHONY: dev build run seed clean

## Run with hot reload (requires: go install github.com/air-verse/air@latest)
dev:
	@if command -v air > /dev/null 2>&1; then \
		air; \
	else \
		echo "air not found — using go run (no hot reload)"; \
		go run ./cmd/api; \
	fi

## Build binary
build:
	go build -o bin/voxform ./cmd/api

## Run compiled binary
run: build
	./bin/voxform

## Download dependencies
deps:
	go mod download

## Tidy modules
tidy:
	go mod tidy

## Verify no build errors
check:
	go build ./...

## Clean build artifacts
clean:
	rm -rf bin/
